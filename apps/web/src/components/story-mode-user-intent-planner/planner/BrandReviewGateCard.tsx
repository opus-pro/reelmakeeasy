'use client'

import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'

import { CheckMark, Select } from '@/components/icons/core'

import { FONT_FEATURE_SETTINGS, type GateVariant } from '../defaults'
import { confirmBrandReview } from '../state/actions/flow-actions'
import { getBrandBriefSubmittedAtom, getRenderStateAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { RenderBrandReviewGate } from '../state-types'

import { ConfirmBannerCard } from './ConfirmBannerCard'
import { ConfirmPanel } from './ConfirmPanel'
import { GateButton } from './GateButton'
import { GateDecorativeImage } from './GateDecorativeImage'

// Shown for a reused/saved brief, which auto-continues after the deadline.
// Rendered below the composer (not in the gate) to mirror the
// script-review processing note's placement and copy.
const PROCESSING_NOTE = 'Your project will continue processing 5 minutes after you leave this page.'

// Edits to a reused saved brief are project-only and never written back to the
// library brief. Sits above the gate, replacing the in-card note.
// Asset categories are the one exception: re-categorizing an asset
// here is a correction to the brand itself, so the confirm writes the new bucket
// back to the saved brief. Everything else stays project-only, so say so rather
// than promise the brief is untouched.
const SAVED_BRIEF_NOTE =
  "Changes here won't affect your saved brand brief, except asset categories, which are saved to it."

interface GateView {
  buttonLabel: string
  icon: ReactNode
  title: string
}

const PRIMARY_BUTTON_CLASS =
  'h-9 rounded-full bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90'
const TONAL_BUTTON_CLASS =
  'h-9 rounded-full bg-white/10 px-4 text-sm font-medium text-white transition hover:bg-white/20'

export function BrandReviewGateCard({
  gate,
  variant = 'legacy',
}: {
  gate?: RenderBrandReviewGate
  variant?: GateVariant
}) {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const brandReviewGate = gate ?? renderState.brandReviewGate

  // brandReviewGate.visible is gated to a stable chat state in session-sync
  // (no pending quick question, in-flight turn, queued messages, or answer->ack
  // gap), mirroring the script-review and auto-lock gates.
  if (!brandReviewGate?.visible) {
    return null
  }

  return (
    <BrandReviewGateCardContent
      attachedVia={brandReviewGate.attachedVia}
      fromSavedBrief={brandReviewGate.fromSavedBrief}
      variant={variant}
    />
  )
}

// One button styled per variant: canvas -> shared GateButton primitive; legacy
// -> the exact inline markup used today (byte-identical). `tone` maps to the
// primary/tonal faces used by the gate CTAs.
function BrandGateButton({
  children,
  icon,
  tone,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  // Leading icon, canvas only -- the legacy pill has no icon slot.
  icon?: ReactNode
  tone: 'primary' | 'tonal'
  variant: GateVariant
}) {
  if (variant === 'canvas') {
    return (
      <GateButton icon={icon} variant={tone} {...props}>
        {children}
      </GateButton>
    )
  }
  return (
    <button
      className={tone === 'primary' ? PRIMARY_BUTTON_CLASS : TONAL_BUTTON_CLASS}
      style={FONT_FEATURE_SETTINGS}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

// The auto-continue note is rendered separately below the composer, so a saved
// brief no longer needs to thread autoContinueEnabled through here.
function BrandReviewGateCardContent({
  attachedVia,
  fromSavedBrief,
  variant,
}: {
  attachedVia: 'auto_detect' | 'explicit'
  fromSavedBrief: boolean
  variant: GateVariant
}) {
  const state = usePlannerState()
  const setSubmitted = useSetAtom(getBrandBriefSubmittedAtom(state))
  const [isConfirming, setIsConfirming] = useState(false)

  const handleConfirm = async () => {
    if (isConfirming) {
      return
    }
    setIsConfirming(true)
    // The saved-brand feature is off in ReelMakeEasy, so the confirm never saves the
    // brief to the library.
    const ok = await confirmBrandReview(state, { save: false })
    if (ok) {
      setSubmitted(true)
    } else {
      setIsConfirming(false)
    }
  }

  if (isConfirming) {
    return null
  }

  const view = resolveGateView(fromSavedBrief, attachedVia)
  const isCanvas = variant === 'canvas'
  const Panel = isCanvas ? ConfirmPanel : ConfirmBannerCard

  const gate = (
    <Panel
      dataTestId="uip-brand-review-gate-card"
      // Canvas wears the redesigned decorative text card;
      // legacy keeps the inline status icon.
      icon={isCanvas ? <GateDecorativeImage variant="text" /> : view.icon}
      right={
        // Buttons go in as direct siblings so the shell's action row can size
        // them -- ConfirmPanel stretches its children to full width below lg.
        <>
          <BrandGateButton
            data-testid="uip-brand-review-confirm"
            icon={isCanvas ? <Select aria-hidden className="size-4.5" /> : undefined}
            onClick={() => {
              void handleConfirm()
            }}
            tone="primary"
            variant={variant}
          >
            {view.buttonLabel}
          </BrandGateButton>
        </>
      }
      title={view.title}
    />
  )

  if (!fromSavedBrief) {
    return gate
  }

  // Saved brief: the project-only disclaimer is a header bar fused to the top
  // of the gate inside one frosted container, so it reads as
  // part of the gate instead of floating over the card content behind it.
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden border-[0.5px] border-white/10 bg-[#121212]/80 backdrop-blur-2xl',
        // Match the inner panel radius: 20px in canvas, original 24px in legacy.
        variant === 'canvas' ? 'rounded-2xl' : 'rounded-3xl',
      )}
    >
      <p
        className="px-4 py-3 text-sm font-medium leading-[17px] text-white"
        data-testid="uip-brand-review-saved-disclaimer"
        style={FONT_FEATURE_SETTINGS}
      >
        {SAVED_BRIEF_NOTE}
      </p>
      {gate}
    </div>
  )
}

// The auto-continue note for a reused saved brief. Rendered below the composer
// (BottomPanel), separately from the gate card, to match the script-review
// processing note's placement.
export function BrandReviewGateProcessingNote() {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const gate = renderState.brandReviewGate

  // Only a reused saved brief auto-continues; and the note is false in
  // manual-approve mode -- the gate waits for the user -- so show it
  // only when the gate is up, the brief is saved, and auto-continue is on.
  if (!gate?.visible || !gate.fromSavedBrief || renderState.autoContinueEnabled === false) {
    return null
  }

  return (
    <p
      className="mt-2 px-8 text-center text-xs leading-[19px] font-normal text-white/50"
      data-testid="uip-brand-review-processing-note"
      style={FONT_FEATURE_SETTINGS}
    >
      {PROCESSING_NOTE}
    </p>
  )
}

// Maps the gate to its confirm-card face: saved brief -> plain Continue, else
// Continue with the brand brief (the saved-brand feature is off in ReelMakeEasy).
function resolveGateView(
  fromSavedBrief: boolean,
  attachedVia: 'auto_detect' | 'explicit',
): GateView {
  const checkIcon = <CheckMark className="size-5 text-green-400" />

  // A saved brief is already in the library: just continue.
  // Only claim the user "selected" it when they explicitly picked it.
  // An auto-detected brief was matched from the prompt and never chosen, so say so
  // instead of misattributing the choice to the user.
  if (fromSavedBrief) {
    return {
      buttonLabel: 'Continue',
      icon: checkIcon,
      title:
        attachedVia === 'auto_detect'
          ? "Here's a brand brief that matches your prompt. Continue?"
          : "Here's the brand brief you selected. Continue?",
    }
  }
  return { buttonLabel: 'Continue', icon: checkIcon, title: 'Continue with the brand brief?' }
}
