'use client'

import { useAtomValue } from 'jotai'
import { useState } from 'react'

import { Select } from '@/components/icons/core'

import { FONT_FEATURE_SETTINGS, type GateVariant } from '../defaults'
import { confirmAutoLockGate, refreshSession } from '../state/actions/flow-actions'
import { getRenderStateAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { PlannerState } from '../state/planner-state'
import type { RenderAutoLockGate, StoryboardsBlock } from '../state-types'

import { useDeadlineCountdown } from './hooks/useDeadlineCountdown'
import { ConfirmPanel } from './ConfirmPanel'
import { CountdownBannerCard } from './CountdownBannerCard'
import { GateButton } from './GateButton'
import { GateDecorativeImage } from './GateDecorativeImage'
import { ReviewSectionButton } from './ReviewSectionButton'

export function AutoLockGateCard({
  gate,
  variant = 'legacy',
}: {
  gate?: RenderAutoLockGate
  variant?: GateVariant
}) {
  const state = usePlannerState()
  const { autoLockGate: liveGate, blocks } = useAtomValue(getRenderStateAtom(state))
  const autoLockGate = gate ?? liveGate
  // A plan with no shots renders nothing to approve, so confirming it would lock an empty
  // storyboard into the render.
  const latestStoryboard = blocks.findLast(
    (block): block is StoryboardsBlock => block.kind === 'storyboards',
  )
  const isStoryboardEmpty = latestStoryboard != null && latestStoryboard.shots.length === 0
  const [isSubmitting, setIsSubmitting] = useState(false)
  if (!autoLockGate || autoLockGate.visible === false) {
    return null
  }
  const handleConfirm = () => {
    setIsSubmitting(true)
    void confirmAutoLockGate(state).finally(() => setIsSubmitting(false))
  }

  // Canvas wears the new ConfirmPanel styling but keeps the original copy and the
  // single "Looks good, create" confirm, with no visible countdown. Legacy keeps
  // the CountdownBannerCard with its inline countdown.
  if (variant === 'canvas') {
    return (
      <AutoLockGateCanvasCard
        autoLockGate={autoLockGate}
        isConfirmDisabled={isSubmitting || isStoryboardEmpty}
        onConfirm={handleConfirm}
        state={state}
      />
    )
  }

  return (
    <CountdownBannerCard
      countdownShowAt={autoLockGate.countdownShowAt}
      deadlineAt={autoLockGate.deadlineAt}
      hideCountdown={autoLockGate.hideCountdown}
      hideIcon
      onDeadlineReached={() => {
        void refreshSession(state)
      }}
      right={
        <button
          className="inline-flex h-9.5 items-center justify-center rounded-full bg-white px-2.5 text-sm font-medium leading-[17px] text-black transition hover:bg-white/90 disabled:bg-white/10 disabled:text-white/25 disabled:hover:bg-white/10"
          data-testid="uip-refinement-lock-skip"
          disabled={isSubmitting || isStoryboardEmpty}
          onClick={handleConfirm}
          style={FONT_FEATURE_SETTINGS}
          type="button"
        >
          Looks good, create
        </button>
      }
      title="Review and approve your storyboard to make sure everything looks right."
      variant={variant}
    />
  )
}

function AutoLockGateCanvasCard({
  autoLockGate,
  isConfirmDisabled,
  onConfirm,
  state,
}: {
  autoLockGate: RenderAutoLockGate
  isConfirmDisabled: boolean
  onConfirm: () => void
  state: PlannerState
}) {
  // Timer still runs so auto-confirm fires at the deadline; countdown
  // text stays hidden. Hide the panel at zero (parity with CountdownBannerCard)
  // so an expired gate can't be clicked if the session refresh lags or fails.
  const secondsRemaining = useDeadlineCountdown(autoLockGate.deadlineAt, () => {
    void refreshSession(state)
  })

  if (secondsRemaining !== null && secondsRemaining <= 0) {
    return null
  }

  return (
    <ConfirmPanel
      dataTestId="uip-refinement-lock-card"
      icon={<GateDecorativeImage variant="text" />}
      right={
        <>
          <ReviewSectionButton
            data-testid="uip-refinement-lock-review"
            modalKind="storyboard"
            sectionId="storyboard"
          />
          <GateButton
            data-testid="uip-refinement-lock-skip"
            disabled={isConfirmDisabled}
            icon={<Select aria-hidden className="size-4.5" />}
            onClick={onConfirm}
            variant="primary"
          >
            Looks good, create
          </GateButton>
        </>
      }
      title="Review and approve your storyboard to make sure everything looks right."
    />
  )
}
