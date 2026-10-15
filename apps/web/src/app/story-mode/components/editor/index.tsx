'use client'

import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import HardwareAccelerationBanner from '@/app/projects/[projectId]/editor/components/HardwareAccelerationBanner'
import { renderMainEngineStore } from '@/app/projects/[projectId]/editor/render-engine-sdk/render-main-engine.store'
import { useRenderMainEngine } from '@/app/projects/[projectId]/editor/render-engine-sdk/use-render-main-engine'
import { useLiveMusicVolume } from '@/app/story-mode/hook/useMusicToggle'
import { longtakeHistoryStore, renderSettingsAtom } from '@/atom/longtake-history.store'
import { BackdropPortal } from '@/components/BackdropPortal'
import { ProgressHalfRing } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'

import EditBox from '../LongTakeViewer/EditBox/EditBox'
import { useLongTakeHistoryKeyboard } from '../LongTakeViewer/hooks/useLongTakeHistoryKeyboard'
import { useOwnerEditActions } from '../LongTakeViewer/hooks/useOwnerEditActions'
import LongTakeHistoryToolbar from '../LongTakeViewer/LongTakeHistoryToolbar'
import ClipStrip from '../LongTakeViewer/StorySequencer/ClipStrip'
import {
  resolveActiveLipSyncPreviewTransition,
  resolveActiveTransitionId,
  resolveTransitionLipSyncPreviewEnabled,
} from '../LongTakeViewer/StorySequencer/engine'
import type { SequencerState } from '../LongTakeViewer/StorySequencer/StorySequencer'
import { EditorOnboardingTour } from '../OnboardingTour'

import { type LoopPreviewMedia, useLoopSfxBedPlayback } from './render/loopPreview'
import { useBgmBedPlayback } from './render/useBgmBedPlayback'
import { EnginePlayerOverlay } from './EnginePlayerOverlay'
import {
  StoryRenderPlanBuilder,
  useCanvasFit,
  useEnginePlayback,
  useStoryPreviewPlan,
} from './render'

const CANVAS_ID = 'story-render-canvas'

interface StorySequencerV2Props {
  /** The bed's measured bed-to-voice gain (dB): the live level follows the export mix. */
  bgmGainDb?: null | number
  /** The background-music bed, played under the voice-over when `musicEnabled`. */
  bgmUrl?: null | string
  bgmVolume?: null | number
  className?: string
  lipSyncPreviewOverrides?: Record<string, boolean>
  /** A loop short's preview media (`loopPreviewMedia`): its joined clips, its clip sound
   *  beside the engine, on a loop, as the chat plays it. While the clips in the state aren't
   *  them (an edit not rendered yet), those play one by one, with no clip sound. */
  loop?: LoopPreviewMedia | null
  musicEnabled?: boolean
  onLipSyncPreviewChange?: (transitionId: string, enabled: boolean) => void
  onStateChange?: (state: SequencerState) => void
  projectId: string
  videoAspectRatio?: string
  voiceOverUrl?: null | string
}

function shotLabelFor(activeKeyframeIndex: number): string {
  return activeKeyframeIndex < 0 ? '' : `Shot ${activeKeyframeIndex + 1}`
}

const StorySequencerV2: React.FC<StorySequencerV2Props> = ({
  className,
  lipSyncPreviewOverrides,
  onLipSyncPreviewChange,
  onStateChange,
  projectId,
  videoAspectRatio,
  bgmGainDb,
  bgmUrl,
  bgmVolume,
  loop = null,
  musicEnabled = false,
  voiceOverUrl,
}) => {
  const aspectRatio = videoAspectRatio ?? '9 / 16'
  const { width: canvasWidth, height: canvasHeight } = useMemo(
    () => StoryRenderPlanBuilder.parseAspectRatio(aspectRatio),
    [aspectRatio],
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const displaySize = useCanvasFit(containerRef, canvasWidth, canvasHeight)

  const engineCurrentMs = useAtomValue(renderMainEngineStore.currentTime)
  const [localLipSyncPreviewOverrides, setLocalLipSyncPreviewOverrides] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    setLocalLipSyncPreviewOverrides({})
  }, [projectId])

  const effectiveLipSyncPreviewOverrides = lipSyncPreviewOverrides ?? localLipSyncPreviewOverrides

  const captionEnabled = useAtomValue(renderSettingsAtom).captionEnabled.latest
  const {
    activeTransitionSegment,
    activeKeyframeIndex,
    activeKeyframeSegment,
    currentState,
    keyframeSegments,
    playsLoopClips,
    renderPlan,
    totalMs,
  } = useStoryPreviewPlan(projectId, {
    aspectRatio,
    captionEnabled,
    currentMs: engineCurrentMs,
    lipSyncPreviewOverrides: effectiveLipSyncPreviewOverrides,
    loopClipsUrl: loop?.clipsUrl ?? null,
    voiceOverUrl,
  })

  const {
    playbackCompleted,
    readyForPlay: engineIsReady,
    hardwareAccelerationUnavailable,
  } = useRenderMainEngine({
    videoCanvasId: CANVAS_ID,
    renderPlan: renderPlan ?? undefined,
  })

  const engineActions = useAtomValue(renderMainEngineStore.engineActions)
  const engineIsBuffering = useAtomValue(renderMainEngineStore.videoLoading)
  const {
    isPlaying: engineIsPlaying,
    pause,
    play,
    seek,
  } = useEnginePlayback({ engineActions, loop: !!loop, playbackCompleted })

  // The music bed plays beside the engine (a DOM audio element on the engine's clock): the
  // shipped engine does not audibly mix a second audio track. The toggle and the level
  // apply at once; the export bake remains the source of truth for the final mix.
  // The level the slider is on (the live one while it moves), else the saved one.
  const liveMusicVolume = useLiveMusicVolume(projectId, bgmVolume)
  useBgmBedPlayback({
    bedGainDb: bgmGainDb,
    enabled: musicEnabled,
    engineMs: engineCurrentMs,
    playing: engineIsPlaying && !engineIsBuffering,
    url: musicEnabled ? bgmUrl : null,
    volume: liveMusicVolume,
  })
  // A loop's clip sound, the same way, while the plan plays the clips it was made from.
  useLoopSfxBedPlayback({
    engineMs: engineCurrentMs,
    loop: playsLoopClips ? loop : null,
    playing: engineIsPlaying && !engineIsBuffering,
    totalMs,
  })

  const [isEditing, setIsEditing] = useState(false)

  const {
    activeTransitionProgress,
    handleRegenerateTransition,
    isRegeneratingTransition,
    regeneratingTransitionIds,
  } = useOwnerEditActions(projectId, activeTransitionSegment)

  const canUndo = useAtomValue(longtakeHistoryStore.canUndoAtom)
  const canRedo = useAtomValue(longtakeHistoryStore.canRedoAtom)
  const undo = useSetAtom(longtakeHistoryStore.undoAtom)
  const redo = useSetAtom(longtakeHistoryStore.redoAtom)
  const videoLoadTrackedRef = useRef(false)

  useEffect(() => {
    if (!engineIsReady || videoLoadTrackedRef.current) {
      return
    }
    videoLoadTrackedRef.current = true
  }, [engineIsReady])

  const maskedKeyframeIdsFromStore = useAtomValue(longtakeHistoryStore.maskedKeyframeIdsAtom)
  const staleTransitionIds = useAtomValue(longtakeHistoryStore.staleTransitionIdsAtom)
  const activeTransitionId = resolveActiveTransitionId(activeTransitionSegment, engineCurrentMs)
  const isAnyTransitionRegenerating = regeneratingTransitionIds.size > 0
  const activeLipSyncPreview = useMemo(() => {
    const transition = resolveActiveLipSyncPreviewTransition({
      activeShotId: activeKeyframeSegment?.shotId,
      activeTransitionId,
      transitions: currentState?.transitions ?? [],
    })
    if (!transition) {
      return null
    }

    return {
      enabled: resolveTransitionLipSyncPreviewEnabled(transition, effectiveLipSyncPreviewOverrides),
      transitionId: transition.transitionId,
    }
  }, [
    activeKeyframeSegment?.shotId,
    activeTransitionId,
    currentState?.transitions,
    effectiveLipSyncPreviewOverrides,
  ])

  const activeTransitionKeyframeId = useMemo(() => {
    if (!activeTransitionId) {
      return activeKeyframeSegment?.shotId ?? null
    }
    return (
      currentState?.transitions.find((transition) => transition.transitionId === activeTransitionId)
        ?.fromShotId ??
      activeKeyframeSegment?.shotId ??
      null
    )
  }, [activeKeyframeSegment?.shotId, activeTransitionId, currentState?.transitions])

  const activeViewModel = useMemo(() => {
    const isEndClamped = activeKeyframeIndex >= keyframeSegments.length - 1
    const nextKeyframe =
      keyframeSegments[Math.min(activeKeyframeIndex + 1, keyframeSegments.length - 1)]
    const startShotLabel = shotLabelFor(activeKeyframeIndex)

    const isActiveTransitionStale =
      !!activeTransitionSegment && staleTransitionIds.has(activeTransitionSegment.transitionId)
    const isActiveTransitionRegenerating = Boolean(
      activeTransitionSegment && isRegeneratingTransition,
    )

    let maskedKeyframeIds = new Set<string>()
    if (regeneratingTransitionIds.size > 0) {
      maskedKeyframeIds = new Set(maskedKeyframeIdsFromStore)
      if (isActiveTransitionRegenerating && activeTransitionKeyframeId) {
        maskedKeyframeIds.add(activeTransitionKeyframeId)
      }
    }

    return {
      endFrameUrl: nextKeyframe?.keyframeUrl || '',
      endKeyframeId: nextKeyframe?.shotId || '',
      endShotLabel: isEndClamped ? startShotLabel : `Shot ${activeKeyframeIndex + 2}`,
      endThumbnailUrl: nextKeyframe?.thumbnailUrl || '',
      isActiveTransitionRegenerating,
      isActiveTransitionStale,
      maskedKeyframeIds,
      startFrameUrl: activeKeyframeSegment?.keyframeUrl || '',
      startKeyframeId: activeKeyframeSegment?.shotId || '',
      startShotLabel,
      startThumbnailUrl: activeKeyframeSegment?.thumbnailUrl || '',
    }
  }, [
    activeKeyframeIndex,
    activeKeyframeSegment,
    activeTransitionSegment,
    activeTransitionKeyframeId,
    isRegeneratingTransition,
    keyframeSegments,
    maskedKeyframeIdsFromStore,
    staleTransitionIds,
    regeneratingTransitionIds,
  ])

  const showGeneratingOverlay = activeViewModel.isActiveTransitionRegenerating

  const handleEditingChange = useRefCallback((editing: boolean) => {
    setIsEditing(editing)
  })

  useEffect(() => {
    if (activeViewModel.isActiveTransitionStale && !isEditing && !engineIsPlaying) {
      handleEditingChange(true)
    }
  }, [activeViewModel.isActiveTransitionStale, engineIsPlaying, handleEditingChange, isEditing])

  const handleUndo = useRefCallback(() => {
    undo()
  })

  const handleRedo = useRefCallback(() => {
    redo()
  })

  useLongTakeHistoryKeyboard({ disabled: isAnyTransitionRegenerating })

  useEffect(() => {
    onStateChange?.({ isPlaying: engineIsPlaying, totalMs })
  }, [engineIsPlaying, totalMs, onStateChange])

  const totalSec = totalMs / 1000

  const handlePause = useRefCallback(() => {
    pause()
  })

  const handlePlay = useRefCallback(() => {
    play()
  })

  const handleSeek = useRefCallback((sec: number) => {
    seek(sec * 1000)
  })

  const handleClipSeek = useRefCallback((ms: number, shotId: string) => {
    seek(ms)
  })

  const pauseIfPlaying = useRefCallback(() => {
    if (engineIsPlaying) {
      pause()
    }
  })

  const handleLipSyncPreviewChange = useRefCallback((transitionId: string, enabled: boolean) => {
    onLipSyncPreviewChange?.(transitionId, enabled)
    if (lipSyncPreviewOverrides !== undefined) {
      return
    }
    setLocalLipSyncPreviewOverrides((prev) => {
      if (prev[transitionId] === enabled) {
        return prev
      }
      return { ...prev, [transitionId]: enabled }
    })
  })

  const editBoxElement = (
    <EditBox
      displayLabel={shotLabelFor(activeKeyframeIndex)}
      endFrameUrl={activeViewModel.endFrameUrl}
      endKeyframeId={activeViewModel.endKeyframeId}
      endShotLabel={activeViewModel.endShotLabel}
      endThumbnailUrl={activeViewModel.endThumbnailUrl}
      isEditing={isEditing}
      isRegenerating={isAnyTransitionRegenerating}
      keyframeIndex={activeKeyframeIndex}
      lipSyncPreview={activeLipSyncPreview}
      onEditingChange={handleEditingChange}
      onLipSyncPreviewChange={handleLipSyncPreviewChange}
      onRegenerate={handleRegenerateTransition}
      onUserInteraction={pauseIfPlaying}
      projectId={projectId}
      startFrameUrl={activeViewModel.startFrameUrl}
      startKeyframeId={activeViewModel.startKeyframeId}
      startShotLabel={activeViewModel.startShotLabel}
      startThumbnailUrl={activeViewModel.startThumbnailUrl}
      transitionId={activeTransitionId ?? null}
    />
  )

  return (
    <div
      className={cn(
        'flex flex-1 self-stretch min-w-0 min-h-0 h-full flex-col items-center',
        className,
      )}
    >
      <BackdropPortal imageUrl={keyframeSegments[0]?.keyframeUrl ?? ''} open={isEditing} />

      <div
        className={cn(
          'relative w-full flex-shrink-0 overflow-hidden transition-[height,margin-bottom] duration-500 ease-in-out-soft',
          isEditing ? 'pointer-events-auto mb-4 h-9.5' : 'pointer-events-none mb-0 h-0',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex h-full w-full min-h-0 items-center gap-2 transition-[opacity,transform] duration-500 ease-in-out-soft',
            isEditing ? 'translate-y-0 opacity-100' : '-translate-y-1.5 opacity-0',
          )}
        >
          <ClipStrip
            activeIndex={activeKeyframeIndex}
            maskedKeyframeIds={activeViewModel.maskedKeyframeIds}
            onSeek={handleClipSeek}
            segments={keyframeSegments}
            visible={isEditing}
          />
          <LongTakeHistoryToolbar
            canRedo={canRedo && !isAnyTransitionRegenerating}
            canUndo={canUndo && !isAnyTransitionRegenerating}
            className="relative z-10 shrink-0"
            onRedo={handleRedo}
            onUndo={handleUndo}
          />
        </div>
      </div>

      <div
        className={cn(
          'flex flex-1 min-h-0 w-full items-center justify-center overflow-hidden transition-[transform,opacity,margin-bottom] duration-500 ease-in-out-soft',
          isEditing ? 'translate-y-0 opacity-100 mb-0' : 'translate-y-0.5 opacity-100 mb-6',
        )}
        ref={containerRef}
      >
        <div
          className="relative flex-none overflow-hidden rounded-xl bg-fill-secondary"
          style={displaySize ?? undefined}
        >
          <canvas
            className="block"
            height={canvasHeight}
            id={CANVAS_ID}
            onContextMenu={(e) => e.preventDefault()}
            style={displaySize ?? undefined}
            width={canvasWidth}
          />

          {(engineIsBuffering || !engineIsReady) && !hardwareAccelerationUnavailable && (
            <div className="absolute inset-0 z-30 grid place-content-center bg-transparent">
              <ProgressHalfRing className="size-8 animate-spin" />
            </div>
          )}
          <HardwareAccelerationBanner
            hardwareAccelerationUnavailable={hardwareAccelerationUnavailable}
          />
          {engineIsReady && (
            <EnginePlayerOverlay
              currentTimeAtom={renderMainEngineStore.currentTime}
              isPlaying={engineIsPlaying}
              onPause={handlePause}
              onPlay={handlePlay}
              onSeek={handleSeek}
              persistSeekBar={showGeneratingOverlay}
              showGeneratingShimmer={showGeneratingOverlay}
              showPlayButton={!showGeneratingOverlay && !engineIsBuffering}
              statusText={showGeneratingOverlay ? activeTransitionProgress?.statusText : undefined}
              totalSec={totalSec}
            />
          )}
        </div>
      </div>

      <EditorOnboardingTour isEditing={isEditing} />
      {editBoxElement}
    </div>
  )
}

export default memo(StorySequencerV2)
