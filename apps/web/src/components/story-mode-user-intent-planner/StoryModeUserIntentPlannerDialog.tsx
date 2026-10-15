'use client'

import { cn, Dialog } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { voiceoverSheetOpenAtom } from '@/atom/voiceover-sheet'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useIsMobile } from '@/util/browserUtils'

import { PlannerDialogButton, type PlannerDialogButtonProps } from './planner/PlannerDialogButton'
import { getActiveModalAtom } from './state/atoms/planner'
import type { PlannerState } from './state/planner-state'
import {
  StoryModeUserIntentPlanner,
  type StoryModeUserIntentPlannerProps,
} from './StoryModeUserIntentPlanner'

export interface StoryModeUserIntentPlannerDialogProps {
  className?: string
  headerButton?: Omit<PlannerDialogButtonProps, 'onClick'>
  onOpenChange: (open: boolean) => void
  open: boolean
  plannerClassName?: StoryModeUserIntentPlannerProps['className']
  plannerScrollContentClassName?: StoryModeUserIntentPlannerProps['scrollContentClassName']
  plannerState: PlannerState
}

export function StoryModeUserIntentPlannerDialog({
  className,
  headerButton,
  onOpenChange,
  open,
  plannerState,
  plannerClassName,
  plannerScrollContentClassName,
}: StoryModeUserIntentPlannerDialogProps) {
  const isMobile = useIsMobile()
  const voiceoverSheetOpen = useAtomValue(voiceoverSheetOpenAtom)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  useBodyScrollLock(open, { lockBody: true, lockHtml: true })

  // The X dismisses the topmost layer: a z-modal popup inside the planner
  // (e.g. the brand-create dialog) if one is open, otherwise the planner.
  // This legacy/below-md dialog only ever renders the brand-create modal --
  // a stale script/storyboard/voiceover kind can linger in shared plannerState
  // if the viewport crossed below md while one of those was open on desktop,
  // so any other kind is cleared but must not block the dialog from closing.
  const handleCloseClick = useCallback(() => {
    const activeModal = plannerState.get(getActiveModalAtom)
    if (activeModal?.kind === 'brand-create') {
      plannerState.set(getActiveModalAtom, null)
      return
    }
    if (activeModal) {
      plannerState.set(getActiveModalAtom, null)
    }
    onOpenChange(false)
  }, [onOpenChange, plannerState])

  return (
    <>
      <Dialog
        classNames={{
          content:
            'z-uip-dialog !left-0 !top-0 h-dvh !w-screen !max-w-none !-translate-x-0 !-translate-y-0 border-0 !border-none bg-transparent p-0 shadow-none',
        }}
        footer={null}
        header={null}
        ignoreInteractOutside
        modal={false}
        onOpenChange={onOpenChange}
        open={open}
        overlay={<div className="fixed inset-0 z-uip-overlay bg-black/80" />}
        showClose={false}
      >
        <div className={cn('relative h-full overflow-hidden', className)}>
          {isMobile ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-[linear-gradient(180deg,#1a1a1a_20%,rgba(26,26,26,0)_100%)]" />
          ) : null}
          <StoryModeUserIntentPlanner
            className={cn('h-full min-h-0 rounded-none', plannerClassName)}
            scrollContentClassName={cn('max-sm:pt-[60px]', plannerScrollContentClassName)}
            state={plannerState}
          />
        </div>
      </Dialog>
      {/* Portaled to <body> at modal-chrome so the X stays visible and
          clickable above z-modal popups inside the planner (e.g. the brand
          brief dialog), matching the Figma back-layer header.
          `mounted` short-circuits before JS evaluates `document.body`,
          which is undefined during SSR even in 'use client' components. */}
      {open && mounted && !voiceoverSheetOpen
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 top-0 z-modal-chrome flex justify-start px-4 pt-4 sm:px-6 sm:pt-6"
              onPointerDownCapture={(event) => {
                // Radix dismissable layers treat this press as an outside
                // interaction and would close the popup on pointerdown,
                // letting the click fall through to this button and close
                // the planner too. Stop it here so handleCloseClick sees
                // the popup still open and dismisses only that layer.
                event.stopPropagation()
              }}
            >
              <PlannerDialogButton
                appearance={isMobile ? 'solid' : 'translucent'}
                aria-label="Close planner"
                icon="close"
                variant="icon"
                {...headerButton}
                className={cn('pointer-events-auto', headerButton?.className)}
                onClick={handleCloseClick}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
