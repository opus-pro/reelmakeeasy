'use client'

import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import { BackdropPortal } from '@/components/BackdropPortal'
import { ProgressHalfRing } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { EditorOnboardingTour } from '../../OnboardingTour'
import EditBox from '../EditBox/EditBox'
import { useLongTakeHistoryKeyboard } from '../hooks/useLongTakeHistoryKeyboard'
import { useOwnerEditActions } from '../hooks/useOwnerEditActions'
import { useStorySequencer } from '../hooks/useStorySequencer'
import LongTakeHistoryToolbar from '../LongTakeHistoryToolbar'

import ClipStrip from './ClipStrip'
import {
  resolveActiveLipSyncPreviewTransition,
  resolveActiveTransitionId,
  resolveTransitionLipSyncPreviewEnabled,
} from './engine'
import StoryPlayerOverlay from './StoryPlayerOverlay'

export interface SequencerState {
  isPlaying: boolean
  totalMs: number
}

interface StorySequencerProps {
  className?: string
  lipSyncPreviewOverrides?: Record<string, boolean>
  onLipSyncPreviewChange?: (transitionId: string, enabled: boolean) => void
  onStateChange?: (state: SequencerState) => void
  projectId: string
  uploadedAudioUrl: null | string
  videoAspectRatio?: string
}

function shotLabelFor(activeKeyframeIndex: number): string {
  return activeKeyframeIndex < 0 ? '' : `Shot ${activeKeyframeIndex + 1}`
}

const StorySequencer: React.FC<StorySequencerProps> = ({
  className,
  lipSyncPreviewOverrides,
  onLipSyncPreviewChange,
  onStateChange,
  projectId,
  uploadedAudioUrl,
  videoAspectRatio,
}) => {
  const [localLipSyncPreviewOverrides, setLocalLipSyncPreviewOverrides] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    setLocalLipSyncPreviewOverrides({})
  }, [projectId])

  const effectiveLipSyncPreviewOverrides = lipSyncPreviewOverrides ?? localLipSyncPreviewOverrides

  const {
    activeTransitionSegment,
    activeKeyframeIndex,
    activeKeyframeSegment,
    audioRef,
    currentMs,
    hasInitializedStartPosition,
    isActiveTransitionReady,
    isBuffering,
    isPlaying,
    mountedTransitionIds,
    pause,
    play,
    preloadedTransitionIds,
    seek,
    totalMs,
    videoRefs,
    keyframeSegments,
    transitionSegments,
  } = useStorySequencer({ projectId, lipSyncPreviewOverrides: effectiveLipSyncPreviewOverrides })

  const [isEditing, setIsEditing] = useState(false)
  const [displayTransitionId, setDisplayTransitionId] = useState<null | string>(null)

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
  const currentState = useAtomValue(longtakeHistoryStore.currentStateAtom)
  const maskedKeyframeIdsFromStore = useAtomValue(longtakeHistoryStore.maskedKeyframeIdsAtom)
  const staleTransitionIds = useAtomValue(longtakeHistoryStore.staleTransitionIdsAtom)
  const activeTransitionId = resolveActiveTransitionId(activeTransitionSegment, currentMs)
  const isAnyTransitionRegenerating = regeneratingTransitionIds.size > 0
  const shouldShowInitialLoading =
    !hasInitializedStartPosition || (!displayTransitionId && !isActiveTransitionReady)
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
    const currentKeyframe = keyframeSegments[activeKeyframeIndex]
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
      bgKeyframeUrl: currentKeyframe?.keyframeUrl || '',
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

  if (!shouldShowInitialLoading && !videoLoadTrackedRef.current) {
    videoLoadTrackedRef.current = true
  }

  const showGeneratingOverlay = activeViewModel.isActiveTransitionRegenerating

  const handleEditingChange = useRefCallback((editing: boolean) => {
    setIsEditing(editing)
  })

  useEffect(() => {
    if (activeViewModel.isActiveTransitionStale && !isEditing && !isPlaying && !isBuffering) {
      handleEditingChange(true)
    }
  }, [
    activeViewModel.isActiveTransitionStale,
    isEditing,
    isPlaying,
    isBuffering,
    handleEditingChange,
  ])

  useEffect(() => {
    if (!activeTransitionSegment) {
      setDisplayTransitionId(null)
      return
    }

    if (isActiveTransitionReady) {
      setDisplayTransitionId(activeTransitionSegment.transitionId)
    }
  }, [activeTransitionSegment, isActiveTransitionReady])

  const handleUndo = useRefCallback(() => {
    undo()
  })

  const handleRedo = useRefCallback(() => {
    redo()
  })

  useLongTakeHistoryKeyboard({ disabled: isAnyTransitionRegenerating })

  useEffect(() => {
    onStateChange?.({ isPlaying, totalMs })
  }, [isPlaying, totalMs, onStateChange])

  const currentSec = currentMs / 1000
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
    if (isPlaying) {
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
      <BackdropPortal imageUrl={activeViewModel.bgKeyframeUrl} open={isEditing} />
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
      >
        <div
          className="relative h-full w-auto max-w-full flex-none rounded-xl overflow-hidden bg-fill-secondary"
          style={{ aspectRatio: videoAspectRatio }}
        >
          <audio
            className="hidden"
            preload="auto"
            ref={audioRef}
            src={uploadedAudioUrl ?? undefined}
          />
          {transitionSegments
            .filter((seg) => mountedTransitionIds.has(seg.transitionId))
            .map((seg) => {
              const isVisible = displayTransitionId === seg.transitionId
              return (
                <video
                  className={cn(
                    'absolute inset-0 size-full object-contain transition-opacity duration-150',
                    isVisible ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none',
                  )}
                  key={seg.videoUri}
                  muted
                  onContextMenu={(e) => e.preventDefault()}
                  playsInline
                  preload={preloadedTransitionIds.has(seg.transitionId) ? 'auto' : 'none'}
                  ref={videoRefs.get(seg.transitionId)}
                  src={seg.videoUri}
                />
              )
            })}

          {(isBuffering || shouldShowInitialLoading) && (
            <div className="absolute inset-0 z-30 grid place-content-center bg-transparent">
              <ProgressHalfRing className="size-8 animate-spin" />
            </div>
          )}
          {!shouldShowInitialLoading && (
            <StoryPlayerOverlay
              currentSec={currentSec}
              isPlaying={isPlaying}
              onPause={handlePause}
              onPlay={handlePlay}
              onSeek={handleSeek}
              persistSeekBar={showGeneratingOverlay}
              showGeneratingShimmer={showGeneratingOverlay}
              showPlayButton={!showGeneratingOverlay && !isBuffering}
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

export default memo(StorySequencer)
