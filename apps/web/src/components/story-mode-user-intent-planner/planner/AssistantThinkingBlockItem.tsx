'use client'

import { cn } from '@shared/ui'
import { AgentStatusLine, useElapsedSec } from '@shared/ui/chat'
import { useAtomValue } from 'jotai'

import RiveCanvas from '@/components/animated/RiveCanvas'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { getRenderStateAtom, getSubmitPendingAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { RenderToolCallName, RenderToolCallState } from '../state-types'

import { useActiveStepAnchor } from './hooks/useActiveStepAnchor'

interface AssistantThinkingBlockItemProps {
  className?: string
  // The canvas-vs-legacy surface, threaded from the planner rather than re-derived. The caller's
  // decision is already latched and already resolved, so there is no loading window to hold the
  // revamped row back through.
  shouldUseCanvasStyle?: boolean
}

export function AssistantThinkingBlockItem({
  className,
  shouldUseCanvasStyle,
}: AssistantThinkingBlockItemProps) {
  const planner = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(planner))
  // Client-side "just submitted" flag -- paints the spinner the instant the user
  // sends, before the optimistic echo / session load / backend signal.
  const submitPending = useAtomValue(getSubmitPendingAtom(planner))

  // Extraction now head-starts during mode_confirmation and the
  // planner holds there until the bank is ready, so the loading status must
  // render in mode_confirmation too -- not just bootstrap_brand.
  const isBrandExtracting =
    (renderState.phase === 'mode_confirmation' || renderState.phase === 'bootstrap_brand') &&
    renderState.brandExtractionStatus === 'pending'

  // Only paint once the user's *just-submitted* message is the tail of the timeline,
  // not merely any older user message from a prior turn -- otherwise "Thinking..."
  // could render under the previous transcript before the new message lands, defeating
  // the message-first intent. Gated behind submitPending so blocks aren't
  // scanned when the flag is off. The message always shows first.
  const lastMessageBlock = submitPending
    ? renderState.blocks.findLast((block) => block.kind === 'message')
    : undefined
  const showFromSubmit = lastMessageBlock?.kind === 'message' && lastMessageBlock.role === 'user'

  if (
    (!renderState.isProcessing && !isBrandExtracting && !showFromSubmit) ||
    renderState.quickOptions.length
  ) {
    return null
  }

  const label =
    buildRunningToolCallLabel(renderState.toolCallStates) ?? buildFallbackLabel(isBrandExtracting)

  if (shouldUseCanvasStyle) {
    return <RevampedThinkingLine className={className} label={label} />
  }

  return (
    <div className={cn('flex items-start gap-1', className)}>
      <RiveCanvas
        autoplay
        className="size-6 shrink-0 brightness-0 invert opacity-50"
        showLoadingSkeleton={false}
        src={getPublicCdnUrl('agent/rive/ai_icon.riv')}
        stateMachines="State Machine"
      />
      <ThinkingLabelText label={label} />
    </div>
  )
}

/**
 * The revamped thinking row: icon + elapsed + label.
 * Anchors to when `label` last changed, so each sub-step gets its own clock.
 */
function RevampedThinkingLine({ className, label }: { className?: string; label: string }) {
  const anchorMs = useActiveStepAnchor(label)
  const elapsedSec = useElapsedSec(anchorMs * 1000)
  return (
    <div className={cn('flex items-start gap-1', className)}>
      <AgentStatusLine elapsedSec={elapsedSec} label={label} />
    </div>
  )
}

/**
 * Collects tools from all running tool calls, deduplicates labels,
 * and joins into a single sentence: "Doing A, doing B and doing C..."
 */
function buildFallbackLabel(isBrandExtracting: boolean): string {
  if (isBrandExtracting) {
    return 'Learning about your brand, this will take about 2 minutes...'
  }
  return 'Thinking...'
}

function buildRunningToolCallLabel(toolCallStates: RenderToolCallState[]): null | string {
  const allTools = toolCallStates
    .filter((item) => item.status === 'running')
    .flatMap((item) => item.tools)

  // dedup mapped labels; unknown tools are silently skipped
  const labelSet = new Set(allTools.map((tool) => TOOL_CALL_LABEL_MAP[tool] || ''))
  labelSet.delete('')
  const labels = Array.from(labelSet)

  if (!labels.length) {
    return null
  }
  const sentence =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  // capitalize first letter of the joined sentence
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}...`
}

function ThinkingLabelText({ label }: { label: string }) {
  return (
    <span
      className="shimmer-text text-glow-sm animate-shimmer text-base font-normal leading-6.5 tracking-[-0.12px]"
      style={FONT_FEATURE_SETTINGS}
    >
      {label}
    </span>
  )
}

export const TOOL_CALL_LABEL_MAP: Record<RenderToolCallName, string> = {
  anchor_vs_batch: 'generating custom assets and drafting your storyboard',
  describe_uploaded_images: 'analyzing your uploaded images',
  generate_anchor_assets: 'generating custom assets',
  generate_brand_styling: 'applying your brand style',
  generate_explainer_script: 'drafting your transcript',
  generate_explainer_visual_script: 'drafting your storyboard',
  generate_intent_context: 'understanding your intent',
  plan_asset_assignment: 'planning asset assignment',
  select_auto_style: 'choosing your visual style',
}
