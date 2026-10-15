'use client'
import { useStore } from 'jotai'
import { useSearchParams } from 'next/navigation'
import React, { useEffect, useMemo, useRef } from 'react'

import {
  pendingActionChangeEvent,
  statusChangeEvent,
} from '@/components/story-mode-user-intent-planner/adapter/adapter-events'
import { useInitSession } from '@/components/story-mode-user-intent-planner/adapter/useInitSession'
import type { PlannerDialogButtonProps } from '@/components/story-mode-user-intent-planner/planner/PlannerDialogButton'
import {
  getGateSurfaceAtom,
  getIsVideoReadyAtom,
  getOnVideoThumbnailClickAtom,
  getOutputVideoAtom,
  getProjectIdAtom,
  getSubmitPendingAtom,
  getVideoAspectRatioAtom,
  getVideoThumbnailAtom,
} from '@/components/story-mode-user-intent-planner/state/atoms/planner'
import { getPlannerEvents } from '@/components/story-mode-user-intent-planner/state/events/planner-events'
import { createPlannerState } from '@/components/story-mode-user-intent-planner/state/planner-state'
import { StoryModeUserIntentPlannerDialog } from '@/components/story-mode-user-intent-planner/StoryModeUserIntentPlannerDialog'
import { useProjectAtom } from '@/hooks/useProjects'
import { useUipFastConfirmActive } from '@/hooks/useUipFastConfirmActive'

/**
 * Projects whose surface has been reported this page session. Module-scoped so it outlives
 * the component: the planner remounts within a visit (viewer handoff, project switch and
 * back) and each project is reported once.
 */
const trackedSurfaceProjectIds = new Set<string>()

export default function UipPlannerSection({
  headerButton,
  isVideoReady,
  onClose,
  onVideoThumbnailClick,
  outputVideoUrl,
  projectId,
  thumbnailUrl,
}: {
  headerButton?: Omit<PlannerDialogButtonProps, 'onClick'>
  isVideoReady?: boolean
  onClose?: () => void
  onVideoThumbnailClick?: () => void
  outputVideoUrl?: string
  projectId: string
  thumbnailUrl?: string
}) {
  const store = useStore()
  const searchParams = useSearchParams()
  const { projectInfo, refetchProjectInfo } = useProjectAtom()
  const { refetch: refetchUipFastConfirm } = useUipFastConfirmActive(projectId)
  const prevPendingActionRef = useRef<null | string | undefined>(undefined)
  const firstViewArmedRef = useRef(false)

  const plannerState = useMemo(() => createPlannerState(store), [store])

  useInitSession(plannerState, projectId)

  // Arriving from /home (firstView=1) means the user just submitted a message that
  // created this session. The message itself loads with the initial session fetch;
  // arm the submit flag once so "Thinking..." is ready to paint the moment that
  // message lands (the indicator stays gated on a message being present, so it
  // never floats above an empty timeline). session-sync clears it on handoff.
  useEffect(() => {
    if (!firstViewArmedRef.current && searchParams.get('firstView') === '1') {
      firstViewArmedRef.current = true
      plannerState.set(getSubmitPendingAtom, true)
    }
  }, [plannerState, searchParams])

  // Records which surface rendered. Both routes that can show a planner
  // (/projects/[projectId] and /story-mode/[projectId]) mount this component, so it is the
  // one place that reports it. Only the legacy dialog ships.
  const surface = 'legacy'
  useEffect(() => {
    if (trackedSurfaceProjectIds.has(projectId)) {
      return
    }
    trackedSurfaceProjectIds.add(projectId)
  }, [surface, projectId])

  // Published so the gates can label their own events with the same value this reports, which
  // is what lets the two join.
  useEffect(() => {
    plannerState.set(getGateSurfaceAtom, surface)
  }, [plannerState, surface])

  useEffect(() => {
    return getPlannerEvents(plannerState).subscribe(statusChangeEvent, ({ status }) => {
      if (status === 'completed') {
        void refetchProjectInfo()
      }
    })
  }, [plannerState, refetchProjectInfo])

  useEffect(() => {
    return getPlannerEvents(plannerState).subscribe(
      pendingActionChangeEvent,
      ({ pendingAction }) => {
        const prev = prevPendingActionRef.current
        prevPendingActionRef.current = pendingAction
        const isFastConfirmTransition = pendingAction === 'confirm_fast' || prev === 'confirm_fast'
        if (isFastConfirmTransition) {
          void refetchUipFastConfirm()
        }
      },
    )
  }, [plannerState, refetchUipFastConfirm])

  isVideoReady = Boolean(isVideoReady)

  useEffect(() => {
    plannerState.set(getIsVideoReadyAtom, isVideoReady)
    plannerState.set(getOutputVideoAtom, isVideoReady && outputVideoUrl ? outputVideoUrl : null)
    plannerState.set(getVideoThumbnailAtom, isVideoReady && thumbnailUrl ? thumbnailUrl : null)
  }, [plannerState, isVideoReady, outputVideoUrl, thumbnailUrl])

  // Not gated on isVideoReady: the canvas video section sizes its box from this, so it has to be
  // known while the video is still loading.
  useEffect(() => {
    plannerState.set(getVideoAspectRatioAtom, projectInfo?.longTakeRatio ?? null)
  }, [plannerState, projectInfo?.longTakeRatio])

  useEffect(() => {
    plannerState.set(getProjectIdAtom, projectId)
  }, [plannerState, projectId])

  useEffect(() => {
    // Wrap in arrow function so jotai treats it as an updater returning the callback,
    // not as the updater itself -- jotai calls any function passed to set() as (prev) => next.
    plannerState.set(getOnVideoThumbnailClickAtom, () => onVideoThumbnailClick ?? null)
  }, [plannerState, onVideoThumbnailClick])

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      onClose?.()
    }
  }

  return (
    <StoryModeUserIntentPlannerDialog
      headerButton={headerButton}
      onOpenChange={handleOpenChange}
      open
      plannerState={plannerState}
    />
  )
}
