'use client'

import { TranscriptData } from '@shared/types/agent/transcript'
import type { LongTakeEditorState, LongTakeEditorStateResponse } from '@shared/types/api/long-take'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'

import { useDraftSaveConflictToast } from '@/app/story-mode/hook/useDraftSaveConflictToast'
import type { StoryKeyframeSegment, StoryTransitionSegment } from '@/app/story-mode/long-take.types'
import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import { useApi } from '@/hooks/useApi'

import {
  buildSegments,
  getSegmentAt,
  getTotalDurationMs,
} from '../../LongTakeViewer/StorySequencer/engine'

export interface UseStorySegmentsResult {
  activeKeyframeIndex: number
  activeKeyframeSegment: null | StoryKeyframeSegment
  activeTransitionSegment: null | StoryTransitionSegment
  currentState: LongTakeEditorState | undefined
  keyframeSegments: StoryKeyframeSegment[]
  totalMs: number
  transcript: TranscriptData | undefined
  transitionSegments: StoryTransitionSegment[]
}

/**
 * Data-only hook: derives segments and active indices from the LongTake editor
 * state + current playback time. No HTML element refs, no playback logic.
 *
 * Extracted from useStorySequencer so both V1 (HTML5 video) and V2 (canvas)
 * renderers can share segment computation.
 *
 * When audioDurationMs is 0 (e.g. V2 canvas path has no <audio> element),
 * the total duration is derived from the last transition's endMs.
 */
export function useStorySegments(
  projectId: string,
  currentMs: number,
  audioDurationMs: number,
  options?: { lipSyncPreviewOverrides?: Record<string, boolean> },
): UseStorySegmentsResult {
  const { fetchApiDomain } = useApi()

  const { data: serverState } = useQuery<LongTakeEditorState>({
    queryKey: ['long-take-state', projectId],
    queryFn: async () => {
      const res = await fetchApiDomain<LongTakeEditorStateResponse>(
        `/api/long-take-videos/${projectId}/state`,
      )
      if (!res.ok) {
        throw new Error(res.error || 'Failed to fetch state')
      }
      return res.data.data
    },
  })

  useDraftSaveConflictToast()

  // Initialize history store on first server state load
  const initializeHistory = useSetAtom(longtakeHistoryStore.initializeHistoryAtom)
  const historyInitializedRef = useRef(false)
  useEffect(() => {
    if (!serverState || historyInitializedRef.current) {
      return
    }
    historyInitializedRef.current = true
    initializeHistory({ currentState: serverState, fetchApiDomain, projectId })
  }, [serverState, projectId, initializeHistory, fetchApiDomain])

  // Flush any debounced draft save on unmount so the trailing edit is not lost.
  useEffect(() => () => longtakeHistoryStore.flushPendingDraftSave(), [])

  // Working state from history store, fallback to server state. The store holds one
  // project at a time (the last initialized), so it only counts when it is this one's:
  // another player on the page (the agent page's chat card and storyboard) may have
  // loaded a different project.
  const atomState = useAtomValue(longtakeHistoryStore.currentStateAtom)
  const atomProjectId = useAtomValue(longtakeHistoryStore.editedProjectIdAtom)
  const currentState = (atomProjectId === projectId ? atomState : null) ?? serverState

  const keyframeMap = useMemo(() => {
    const map: Record<string, { keyframeUrl: string; thumbnailUrl?: string }> = {}
    for (const kf of currentState?.keyframes ?? []) {
      map[kf.shotId] = { keyframeUrl: kf.keyframeUrl, thumbnailUrl: kf.thumbnailUrl ?? undefined }
    }
    return map
  }, [currentState?.keyframes])

  // When audioDurationMs is 0 (V2 canvas path), derive from last transition's endMs
  const effectiveAudioDurationMs = useMemo(() => {
    if (audioDurationMs > 0) {
      return audioDurationMs
    }
    const transitions = currentState?.transitions ?? []
    if (transitions.length === 0) {
      return 0
    }
    return Math.max(...transitions.map((t) => t.endMs))
  }, [audioDurationMs, currentState?.transitions])

  const segments = useMemo(
    () =>
      buildSegments(currentState?.transitions ?? [], keyframeMap, effectiveAudioDurationMs, {
        lipSyncPreviewOverrides: options?.lipSyncPreviewOverrides,
      }),
    [
      currentState?.transitions,
      keyframeMap,
      effectiveAudioDurationMs,
      options?.lipSyncPreviewOverrides,
    ],
  )

  const totalMs = effectiveAudioDurationMs || getTotalDurationMs(segments)

  const transitionSegments = useMemo(
    () => segments.filter((s): s is StoryTransitionSegment => s.kind === 'transition'),
    [segments],
  )

  const keyframeSegments = useMemo(
    () => segments.filter((s): s is StoryKeyframeSegment => s.kind === 'keyframe'),
    [segments],
  )

  const [activeTransitionSegment] = useMemo(
    () => getSegmentAt(transitionSegments, currentMs),
    [transitionSegments, currentMs],
  )

  const [activeKeyframeSegment, activeKeyframeIndex] = useMemo(
    () => getSegmentAt(keyframeSegments, currentMs),
    [keyframeSegments, currentMs],
  )

  return {
    activeKeyframeIndex,
    activeKeyframeSegment,
    activeTransitionSegment,
    transcript: currentState?.transcript,
    currentState,
    keyframeSegments,
    totalMs,
    transitionSegments,
  }
}
