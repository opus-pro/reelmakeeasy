import type { Content } from '@reelmakeeasy/common/llm'
import type { LongTakeHumanPresence } from '@reelmakeeasy/common/long-take/types'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

import {
  buildLongTakeAnchorContents,
  getLongTakeKeyframeAnchorParams,
  type LongTakeAnchorMeta,
} from './anchor-meta'
import { buildLongTakeKeyframePrompt, type LongTakeKeyframeGlobalContext } from './storage'

/**
 * Per-shot prompt assembly for long-take keyframe generation.
 *
 * Centralizes the per-shot anchor inspection + keyframe prompt build for the
 * `generateLongTakeKeyframe` activity so the per-shot plumbing lives in one
 * place. `promptRoute` threads through to the routed-prompt builder.
 * `improvedVisualScriptEnabled` is still accepted for caller compatibility,
 * but USER_FILE Prop keyframe prompts intentionally match the legacy/gate-off
 * anchor behavior.
 */
export function buildLongTakeKeyframeShotInputs(opts: {
  anchorLookup: Map<string, LongTakeAnchorMeta>
  basePrompt: string
  globalContext: LongTakeKeyframeGlobalContext | null
  humanPresence?: LongTakeHumanPresence
  improvedVisualScriptEnabled: boolean
  keyframePromptReworkEnabled?: boolean
  promptRoute?: LongTakePromptRoute
  styleName?: string
  styleText?: string
  usedAssetIds?: string[]
}): {
  promptPayload: ReturnType<typeof buildLongTakeKeyframePrompt>
  shotContents: Content[]
} {
  const shotContents = opts.usedAssetIds?.length
    ? buildLongTakeAnchorContents(opts.usedAssetIds, opts.anchorLookup)
    : []
  const promptPayload = buildLongTakeKeyframePrompt({
    basePrompt: opts.basePrompt,
    globalContext: opts.globalContext,
    humanPresence: opts.humanPresence,
    keyframePromptReworkEnabled: opts.keyframePromptReworkEnabled,
    promptRoute: opts.promptRoute,
    styleName: opts.styleName,
    styleText: opts.styleText,
    ...getLongTakeKeyframeAnchorParams(
      opts.usedAssetIds,
      opts.anchorLookup,
      shotContents.length > 0,
    ),
  })
  return { promptPayload, shotContents }
}
