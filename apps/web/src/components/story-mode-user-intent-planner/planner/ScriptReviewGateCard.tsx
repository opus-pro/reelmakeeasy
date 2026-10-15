'use client'

import { useAtomValue } from 'jotai'

import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { useNullableAtomValue } from '@/lib/jotai-atom-utils'
import { useIsMobile } from '@/util/browserUtils'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import {
  cancelScriptReviewGate,
  confirmScriptReviewGate,
  refreshSession,
} from '../state/actions/flow-actions'
import { getIsConfirmingScriptReviewGateAtom, getRenderStateAtom } from '../state/atoms/planner'
import { getCanSubmitScriptTranscriptDraftAtom } from '../state/computed/script-transcript'
import { usePlannerState } from '../state/planner-context'
import type { RenderScriptReviewGate } from '../state-types'

import { CountdownBannerCard } from './CountdownBannerCard'

export function ScriptReviewGateCard({ gate }: { gate?: RenderScriptReviewGate }) {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const scriptReviewGate = gate ?? renderState.scriptReviewGate

  if (!scriptReviewGate || scriptReviewGate.visible === false) {
    return null
  }

  return <ScriptReviewGateCardContent gate={scriptReviewGate} />
}

function ScriptReviewGateCardContent({ gate }: { gate: RenderScriptReviewGate }) {
  const state = usePlannerState()
  const isMobile = useIsMobile()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const storyModeUserLimits = useStoryModeUserLimits()
  const isConfirming = useAtomValue(getIsConfirmingScriptReviewGateAtom(state))
  const baselineScriptText = renderState.latest.script?.text ?? ''
  const isAudioMode = renderState.latest.script?.audioSource === 'user_audio'
  const canSubmitTranscriptDraft =
    useNullableAtomValue(
      isAudioMode
        ? null
        : getCanSubmitScriptTranscriptDraftAtom(state)(baselineScriptText)(
            storyModeUserLimits.absoluteMaxScriptWords,
          ),
    ) ?? true

  const isCreateVideoDisabled = isConfirming || !canSubmitTranscriptDraft

  const cancelAction = (
    <button
      className="inline-flex h-9.5 items-center justify-center rounded-full bg-white/10 px-2.5 text-sm font-medium leading-[17px] text-white transition hover:bg-white/15 max-sm:w-full"
      data-testid="uip-review-gate-cancel"
      onClick={() => {
        void cancelScriptReviewGate(state)
      }}
      style={FONT_FEATURE_SETTINGS}
      type="button"
    >
      Cancel
    </button>
  )

  const createVideoAction = (
    <span className={isMobile ? 'inline-flex w-full' : 'inline-flex'}>
      <button
        className="inline-flex h-9.5 items-center justify-center gap-2 rounded-full bg-white px-2.5 text-sm font-medium leading-[17px] text-black transition hover:bg-white/90 disabled:bg-white/10 disabled:text-white/25 disabled:hover:bg-white/10 max-sm:w-full"
        data-dd-action="uip-create-video-button"
        data-testid="uip-review-gate-confirm"
        disabled={isCreateVideoDisabled}
        onClick={() => {
          void confirmScriptReviewGate(state)
        }}
        style={FONT_FEATURE_SETTINGS}
        type="button"
      >
        Create video now
      </button>
    </span>
  )

  const toolActions = isMobile
    ? [createVideoAction, cancelAction]
    : [cancelAction, createVideoAction]

  return (
    <CountdownBannerCard
      countdownShowAt={gate.countdownShowAt}
      deadlineAt={gate.deadlineAt}
      hideCountdown={gate.hideCountdown}
      onDeadlineReached={() => {
        void refreshSession(state)
      }}
      right={
        <div className={isMobile ? 'flex w-full flex-col gap-3' : 'flex items-center gap-2'}>
          {toolActions.map((action, index) => (
            <div key={index}>{action}</div>
          ))}
        </div>
      }
      title="Ready to roll, start creating video now?"
      withTools
    />
  )
}
