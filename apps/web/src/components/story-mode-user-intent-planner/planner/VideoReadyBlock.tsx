'use client'
import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useLayoutEffect, useState } from 'react'

import { PlayCircle } from '@/components/icons/core'
import {
  getGateSurfaceAtom,
  getOnVideoThumbnailClickAtom,
  getProjectIdAtom,
} from '@/components/story-mode-user-intent-planner/state/atoms/planner'
import { usePlannerState } from '@/components/story-mode-user-intent-planner/state/planner-context'
import { BufferingSpinner, usePlaybackBuffering, VideoPlayer } from '@/components/VideoPlayer'

export function VideoReadyBlock({
  thumbnailUrl,
  videoUrl,
}: {
  thumbnailUrl?: null | string
  videoUrl: string
}) {
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined)
  const [isThumbnailFailed, setIsThumbnailFailed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const { bufferingHandlers, isBuffering, resetBuffering } = usePlaybackBuffering(
    isPlaying,
    videoUrl,
  )
  const state = usePlannerState()
  const onVideoThumbnailClick = useAtomValue(getOnVideoThumbnailClickAtom(state))
  const projectId = useAtomValue(getProjectIdAtom(state))
  const surface = useAtomValue(getGateSurfaceAtom(state))

  const handleThumbnailClick = useCallback(() => {
    onVideoThumbnailClick?.()
  }, [onVideoThumbnailClick, projectId, surface])

  useLayoutEffect(() => {
    setAspectRatio(undefined)
    setIsThumbnailFailed(false)
  }, [videoUrl, thumbnailUrl])

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    if (naturalWidth && naturalHeight) {
      setAspectRatio(`${naturalWidth}/${naturalHeight}`)
    }
  }, [])

  const handleImageError = useCallback(() => {
    setIsThumbnailFailed(true)
  }, [])

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = e.currentTarget
    if (videoWidth && videoHeight) {
      setAspectRatio(`${videoWidth}/${videoHeight}`)
    }
  }, [])

  const handleError = useCallback(() => {
    setAspectRatio((prev) => prev ?? '9/16')
  }, [])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
    resetBuffering()
  }, [resetBuffering])

  const handlePlay = useCallback(() => setIsPlaying(true), [])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base leading-[26px] tracking-[-0.12px] text-white">Your video is ready!</p>
      {thumbnailUrl && !isThumbnailFailed ? (
        <button
          className={cn(
            'relative w-[270px] max-w-full cursor-pointer overflow-hidden rounded-2xl',
            !aspectRatio && 'hidden',
          )}
          onClick={onVideoThumbnailClick ? handleThumbnailClick : undefined}
          style={{ aspectRatio }}
          type="button"
        >
          <img
            alt="Video thumbnail"
            className="size-full object-cover"
            onError={handleImageError}
            onLoad={handleImageLoad}
            src={thumbnailUrl}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/40">
            <PlayCircle className="size-12 text-primary drop-shadow-md" />
          </div>
        </button>
      ) : (
        <div
          className={cn(
            'relative w-[270px] max-w-full overflow-hidden rounded-[16px]',
            !aspectRatio && 'hidden',
          )}
          style={{ aspectRatio }}
        >
          <VideoPlayer
            className="size-full object-cover"
            containerClassName="size-full"
            onEnded={resetBuffering}
            onError={handleError}
            onPause={handlePause}
            onPlay={handlePlay}
            primitiveVideoPlayerProps={{
              ...bufferingHandlers,
              onLoadedMetadata: handleLoadedMetadata,
            }}
            showHoverPlayButton
            showPlayButtonWithPause
            src={videoUrl}
          />
          {isBuffering && <BufferingSpinner />}
        </div>
      )}
    </div>
  )
}
