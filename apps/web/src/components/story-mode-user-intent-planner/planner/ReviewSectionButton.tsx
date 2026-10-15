'use client'

import type { ActiveModalKind } from '@reelmakeeasy/common/uip/active-modal-kind'
import { useSetAtom } from 'jotai'
import type { ButtonHTMLAttributes } from 'react'

import { Eye } from '@/components/icons/core'

import { getActiveModalAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'

import { GateButton } from './GateButton'

// Editable section modals the Review button can open. Excludes brand-create (needs
// a `mode`, not just `kind`) and video (no edit pane).
type ReviewModalKind = Exclude<ActiveModalKind, 'brand-create' | 'video'>

// Left button of a confirm gate: scrolls to the reviewed section and opens its edit
// modal via the same setActiveModal path the section's own Edit button uses. Fails closed (no-op)
// when the section is unmounted, so it never surfaces an edit pane detached from its section.
// `modalKind` is required: a scroll alone is imperceptible in an already-visible
// section, so a gate whose section has no edit modal omits this button.
export function ReviewSectionButton({
  modalKind,
  sectionId,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  modalKind: ReviewModalKind
  sectionId: string
}) {
  const state = usePlannerState()
  const setActiveModal = useSetAtom(getActiveModalAtom(state))

  const handleReview = () => {
    // Fail closed: with no mounted section to review, don't open the modal either --
    // it would surface an edit pane detached from its (absent) section.
    const section = document.getElementById(sectionId)
    if (!section) {
      return
    }
    section.scrollIntoView({ behavior: 'smooth' })
    setActiveModal({ kind: modalKind })
  }

  return (
    <GateButton
      {...props}
      icon={<Eye aria-hidden className="size-4.5" />}
      onClick={handleReview}
      variant="tonal"
    >
      Review
    </GateButton>
  )
}
