'use client'

import type { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { useMemo } from 'react'

import type { StorySegment } from '@/app/story-mode/long-take.types'
import { useLiveCaptionStyle } from '@/components/captions/useCaptionSettings'
import { useVideoScript } from '@/hooks/useVideoScript'

import { loopClipsMatchState } from './loopPreview'
import useRenderPlan from './useRenderPlan'
import { useStorySegments, type UseStorySegmentsResult } from './useStorySegments'

export interface UseStoryPreviewPlanOptions {
  aspectRatio: string
  /** Whether the preview draws captions (the editor's `renderSettingsAtom` choice). */
  captionEnabled: boolean
  /** The engine's playhead: only picks the active segments, the plan doesn't depend on it. */
  currentMs: number
  lipSyncPreviewOverrides?: Record<string, boolean>
  /**
   * A loop short's joined clips (`loopPreviewMedia`), played muted in place of its clips one
   * by one while they are the clips in its state: the picture its delivered file and its clip
   * sound bed are made from.
   */
  loopClipsUrl?: null | string
  voiceOverUrl?: null | string
}

export type UseStoryPreviewPlanResult = UseStorySegmentsResult & {
  /**
   * The plan can't be built: building it threw, or the video's state, once read, has no
   * clips to play. A player can show the rendered file instead.
   */
  planFailed: boolean
  /**
   * The plan plays the loop's joined clips (`loopClipsUrl`): they are the clips in its state
   * (`loopClipsMatchState`). Its clip sound bed, made from them, plays beside it only then;
   * otherwise the plan plays the clips in the state one by one, as for any other video.
   */
  playsLoopClips: boolean
  renderPlan: null | RenderPlan
}

// Nothing to build a plan from yet.
const NO_SEGMENTS: StorySegment[] = []

/**
 * Everything the editor's live preview plays, from a project id: its segments
 * (`useStorySegments`), merged in time order, plus the video script, the caption
 * choice and the caption look the user is choosing (`useLiveCaptionStyle`), turned into
 * the engine's RenderPlan (`useRenderPlan`). Shared by the editor (`StorySequencerV2`)
 * and the agent page's preview, so both play the same plan. A loop short plays its joined
 * clips (`loopClipsUrl`) under its voice-over, captions and fact stamps while they are the
 * clips in its state (`playsLoopClips`); both players then play its clip sound beside the
 * engine (`useLoopSfxBedPlayback`).
 */
export function useStoryPreviewPlan(
  projectId: string,
  {
    aspectRatio,
    captionEnabled,
    currentMs,
    lipSyncPreviewOverrides,
    loopClipsUrl,
    voiceOverUrl,
  }: UseStoryPreviewPlanOptions,
): UseStoryPreviewPlanResult {
  const segments = useStorySegments(projectId, currentMs, 0, { lipSyncPreviewOverrides })
  const { currentState, keyframeSegments, totalMs, transcript, transitionSegments } = segments

  const allSegments = useMemo(() => {
    if (transitionSegments.length === 0 && keyframeSegments.length === 0) {
      return []
    }
    return [...keyframeSegments, ...transitionSegments].sort((a, b) => a.startMs - b.startMs)
  }, [transitionSegments, keyframeSegments])

  const { data: videoScript, isLoading: scriptLoading } = useVideoScript(projectId)
  // A loop's joined clips, while the clips in the state (the editor's, edits included) are the
  // ones they were joined from: otherwise the clip strip would show one clip, and the canvas and
  // the bed made from the joined clips another. Until the video script that says which clips
  // they are is read, the plan waits, so the clips one by one don't start loading first.
  const transitions = currentState?.transitions
  const playsLoopClips = useMemo(
    () => !!loopClipsUrl && loopClipsMatchState(transitions, videoScript),
    [loopClipsUrl, transitions, videoScript],
  )
  const loopClipsUnknown = !!loopClipsUrl && !videoScript && scriptLoading
  // Captions and a loop's fact stamps wait for the saved look to be read, so a loop doesn't
  // flash Classic, or stamps in the default highlight, first.
  const caption = useLiveCaptionStyle(projectId)
  // The music bed is NOT in this plan: the shipped engine does not audibly mix a second
  // audio track, so the players play the bed as a DOM audio element clock-synced to the
  // engine (`useBgmBedPlayback`); the export bake remains the source of truth.
  const { failed, renderPlan } = useRenderPlan({
    allSegments: loopClipsUnknown ? NO_SEGMENTS : allSegments,
    aspectRatio,
    captionEnabled: captionEnabled && caption.settled,
    captionKind: caption.kind,
    captionStyle: caption.settings,
    factsReady: caption.settled,
    loopClipsUrl: playsLoopClips ? loopClipsUrl : null,
    totalMs,
    transcript,
    videoScript,
    voiceOverUrl,
  })
  // Read, with nothing to build a plan from: it would never be built.
  const nothingToPlay = !!currentState && (allSegments.length === 0 || totalMs === 0)

  return { ...segments, planFailed: failed || nothingToPlay, playsLoopClips, renderPlan }
}
