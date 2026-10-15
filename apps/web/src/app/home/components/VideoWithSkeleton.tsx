import { cn } from '@shared/ui'
import { HTMLAttributes, useCallback, useEffect, useState } from 'react'

import { Loading } from '@/components/icons/core'
import { VideoPlayer, VideoPlayerProps, VideoPlayerRef } from '@/components/VideoPlayer'

export interface VideoWithSkeletonProps extends Partial<VideoPlayerProps> {
  className?: HTMLAttributes<HTMLDivElement>['className']
  fallbackVideoUrl?: string
  loadingOverlaySrc?: string
  onCanPlay?: () => void
  videoPlayerRef?: React.RefObject<null | VideoPlayerRef>
  videoUrl: string
}

export const VideoWithSkeleton: React.FC<VideoWithSkeletonProps> = ({
  className,
  fallbackVideoUrl,
  onLoadedMetadata,
  onCanPlay,
  onPlay,
  loadingOverlaySrc,
  videoUrl,
  videoPlayerRef,
  ...videoPlayerProps
}) => {
  const { primitiveVideoPlayerProps: callerPrimitiveProps, ...restVideoPlayerProps } =
    videoPlayerProps
  const [loading, setLoading] = useState(true)
  const [activeSrc, setActiveSrc] = useState(videoUrl)

  const handleLoadedMetadata = (duration: number) => {
    onLoadedMetadata?.(duration)
  }

  const handlePlay = () => {
    // A playing video is definitely loaded; clear loading as a fallback
    // in case canplay was missed (e.g. cached video race condition)
    setLoading(false)
    onPlay?.()
  }

  const handleError = useCallback(() => {
    if (fallbackVideoUrl && activeSrc !== fallbackVideoUrl) {
      setActiveSrc(fallbackVideoUrl)
    }
  }, [activeSrc, fallbackVideoUrl])

  useEffect(() => {
    setActiveSrc(videoUrl)
    setLoading(true)
  }, [videoUrl])

  return (
    <div className={cn('flex-1 relative rounded-lg overflow-hidden', className)}>
      <VideoPlayer
        autoPlay
        className={cn(
          'absolute inset-0 w-full h-full m-auto object-contain',
          loading && 'opacity-0',
        )}
        containerClassName="aspect-[9/16] max-h-full w-full object-cover select-none"
        loop={false}
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={handlePlay}
        primitiveVideoPlayerProps={{
          ...callerPrimitiveProps,
          onCanPlay: (e) => {
            setLoading(false)
            onCanPlay?.()
            callerPrimitiveProps?.onCanPlay?.(e)
          },
        }}
        ref={videoPlayerRef}
        showHoverPlayButton={false}
        // Keyboard off by default here (matches the prior hardcoded default);
        // callers that want it opt in via restVideoPlayerProps (e.g. focus mode).
        spacebarHandling="off"
        src={activeSrc}
        {...restVideoPlayerProps}
      />
      {loading &&
        (loadingOverlaySrc ? (
          <>
            <img
              alt=""
              className="absolute inset-0 z-10 size-full object-cover"
              src={loadingOverlaySrc}
            />
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              <Loading className="size-12 animate-spin text-white" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 z-10 bg-tertiary animate-pulse" />
        ))}
    </div>
  )
}
