'use client'

import { cn } from '@shared/ui'
import { ComposerOptionsHint } from '@shared/ui/chat'
import { useAtomValue } from 'jotai'

import { projectIdAtom } from '@/atom/project'
import { Warning } from '@/components/icons/core'
import { useRemix } from '@/hooks/useRemix'

import { AutoLockGateCard } from './AutoLockGateCard'
import { BrandReviewGateCard, BrandReviewGateProcessingNote } from './BrandReviewGateCard'
import { MessageBoxV2 } from './MessageBoxV2'
import { GLASS_PANEL_SURFACE, OPAQUE_PANEL_SURFACE } from './panel-surface'
import { QueuedMessagesCard } from './QueuedMessagesCard'
import { QuickQuestionCard } from './QuickQuestionCard'
import { ScriptReviewGateCard } from './ScriptReviewGateCard'
import { useBottomPanelState } from './useBottomPanelState'

export function BottomPanel({
  shouldHideArtifacts,
  shouldUseCanvasStyle,
}: {
  shouldHideArtifacts?: boolean
  shouldUseCanvasStyle?: boolean
}) {
  const { isActive, isLocked, isMobile, isQuickQuestionMode, isVideoReady, phase, status } =
    useBottomPanelState()
  const opaqueSurface = Boolean(shouldUseCanvasStyle)

  if (status === 'completed') {
    if (isVideoReady) {
      return null
    }
    return <GeneratingMessageBox opaqueSurface={opaqueSurface} />
  }

  if (status === 'cancelled' || status === 'timed_out') {
    const submessage =
      status === 'timed_out'
        ? 'It looks like you stepped away...'
        : 'Your project has been cancelled.'
    return <CancelledProjectCard opaqueSurface={opaqueSurface} submessage={submessage} />
  }

  if (!isActive) {
    return null
  }

  const panelContent = (
    <>
      {isQuickQuestionMode ? null : <QueuedMessagesCard opaqueSurface={opaqueSurface} />}
      {!shouldHideArtifacts && (
        <>
          <AutoLockGateCard />
          <BrandReviewGateCard />
          <ScriptReviewGateCard />
        </>
      )}
      {!isLocked &&
        (isQuickQuestionMode ? (
          <QuickQuestionCard shouldUseCanvasStyle={shouldUseCanvasStyle} />
        ) : (
          <MessageBoxV2
            opaqueSurface={opaqueSurface}
            shouldUseCanvasStyle={shouldUseCanvasStyle}
            showAssetStrip={!isMobile && (phase === 'bootstrap_visual' || phase === 'refinement')}
          />
        ))}
      {/* The composer tips row. Scoped to the canvas, the only
          surface it was designed against -- shouldUseCanvasStyle is what tells the shared planner
          it is inside one, and the canvas surface itself already carries the uid_revamp gate and
          the lg viewport, so below lg the legacy dialog never grows a row it has no
          layout for. */}
      {shouldUseCanvasStyle && !isMobile && !isLocked && (
        <p className="text-center text-xs text-secondary" data-testid="uip-composer-tips">
          {isQuickQuestionMode ? (
            <ComposerOptionsHint />
          ) : (
            'Ask the agent to help you with anything'
          )}
        </p>
      )}
    </>
  )

  return (
    <div className="flex flex-col" data-testid="uip-bottom-panel">
      <div className="flex flex-col gap-2">{panelContent}</div>
      <BrandReviewGateProcessingNote />
    </div>
  )
}

// useRemix calls useQuickStartNavigation which calls useSearchParams, so it must
// only mount on the cancel/timeout path to avoid suspending the planner in
// contexts where navigation hooks are unavailable (e.g. the admin mock harness).
function CancelCard({
  isPreparing,
  opaqueSurface,
  submessage,
  onRegenerate,
}: {
  isPreparing: boolean
  onRegenerate: () => void
  opaqueSurface?: boolean
  submessage: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between overflow-visible rounded-[24px] border-[0.5px] border-white/10 p-2',
        opaqueSurface ? OPAQUE_PANEL_SURFACE : GLASS_PANEL_SURFACE,
      )}
      data-testid="uip-cancel-card"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 p-2">
        <Warning aria-hidden="true" className="size-6 shrink-0 text-red-500" />
        <div className="flex flex-col gap-0">
          <p className="text-base font-medium leading-5 text-white">Project canceled.</p>
          <p className="text-sm leading-[22px] text-white/50">{submessage}</p>
        </div>
      </div>
      <button
        aria-label="Regenerate"
        className="inline-flex h-[38px] shrink-0 items-center justify-center rounded-full bg-white px-3 text-sm font-medium text-black disabled:opacity-60"
        disabled={isPreparing}
        onClick={onRegenerate}
        type="button"
      >
        {isPreparing ? (
          <>
            <span className="sr-only">Regenerate</span>
            <div
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-black/30 border-t-black"
            />
          </>
        ) : (
          'Regenerate'
        )}
      </button>
    </div>
  )
}

function CancelledProjectCard({
  opaqueSurface,
  submessage,
}: {
  opaqueSurface?: boolean
  submessage: string
}) {
  const projectId = useAtomValue(projectIdAtom)
  const { handleRemix, isPreparingRemix } = useRemix(projectId)
  return (
    <CancelCard
      isPreparing={isPreparingRemix}
      onRegenerate={handleRemix}
      opaqueSurface={opaqueSurface}
      submessage={submessage}
    />
  )
}

function GeneratingMessageBox({ opaqueSurface }: { opaqueSurface?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between overflow-visible rounded-[27px] border-[0.5px] border-white/10 p-2',
        opaqueSurface ? OPAQUE_PANEL_SURFACE : GLASS_PANEL_SURFACE,
      )}
      data-testid="uip-composer-v2-generating"
    >
      <div className="min-w-0 flex-1 px-3 py-2 text-sm text-white/60">Generating...</div>
      <div className="inline-flex h-[38px] min-w-[38px] items-center justify-center self-end rounded-full bg-[rgba(255,255,255,0.1)] opacity-60">
        <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    </div>
  )
}
