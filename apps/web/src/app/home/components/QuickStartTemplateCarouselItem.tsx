'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { cn, useCarousel } from '@shared/ui'
import { useAtom } from 'jotai'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { dialogVideoMutedAtom, videoCardVolumeAtom } from '@/atom/ui'
import { VideoPlayerRef } from '@/components/VideoPlayer'
import VideoOverlayControls from '@/components/VideoPlayer/VideoOverlayControls'
import VisibilityComponent from '@/components/VisibilityComponent'

import { VideoWithSkeleton } from './VideoWithSkeleton'

const getAspectRatioClass = (aspectRatio: QuickStartTemplate['aspectRatio']) => {
  switch (aspectRatio) {
    case '1:1': {
      return 'aspect-[1/1]'
    }
    case '9:16': {
      return 'aspect-[9/16]'
    }
    case '16:9': {
      return 'aspect-[16/9]'
    }
    default: {
      return 'aspect-[9/16]'
    }
  }
}

export const QuickStartTemplateCarouselItem: React.FC<{
  idx: number
  isMobile?: boolean
  template: QuickStartTemplate
}> = ({ idx, isMobile, template }) => {
  const videoPlayerRef = useRef<VideoPlayerRef>(null)
  const [isMuted, setIsMuted] = useAtom(dialogVideoMutedAtom)
  const [volume, setVolume] = useAtom(videoCardVolumeAtom)
  const { selectedIndex } = useCarousel()
  const isSelected = selectedIndex === idx
  const aspectRatioClass = getAspectRatioClass(template.aspectRatio)
  const mobileVideoFrameClass = cn(
    'flex-none h-full max-h-[620px] max-w-[calc(100vw-2rem)] min-w-24 min-h-48 rounded-lg',
    aspectRatioClass,
  )
  const unavailableVideoFrameClass = cn(
    'flex-none h-full max-h-[620px] max-w-[calc(100vw-2rem)] min-w-24 min-h-48',
    aspectRatioClass,
  )
  const desktopVideoContainerClass = cn(
    'max-h-full w-full object-cover select-none',
    aspectRatioClass,
  )

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(!isMobile)

  // useLayoutEffect fires before paint, keeping play() inside Chrome's transient
  // activation window for unmuted autoplay on desktop.
  // Mobile skips play() here: calling play() before video data loads consumes
  // Chrome's user activation, causing async enforcement to stop the video ~500ms
  // later even though autoPlay already started it.
  useLayoutEffect(() => {
    if (isSelected) {
      videoPlayerRef.current?.setVolume(volume)
      if (!isMobile) {
        const playPromise = videoPlayerRef.current?.play()
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => undefined)
        }
      }
    } else {
      videoPlayerRef.current?.seek(0)
      videoPlayerRef.current?.pause()
    }
  }, [isSelected, isMobile, volume])

  // Mobile: play() via useEffect so autoPlay fires first on initial dialog open.
  // Also handles carousel navigation where the video is already loaded and the
  // swipe provides a fresh user gesture.
  useEffect(() => {
    if (!isMobile || !isSelected) {
      return
    }
    videoPlayerRef.current?.play()?.catch(() => setIsPlaying(false))
  }, [isMobile, isSelected])

  const handlePlay = useCallback(() => {
    videoPlayerRef.current?.play()?.catch(() => undefined)
  }, [])

  const handlePause = useCallback(() => {
    videoPlayerRef.current?.pause()
  }, [])

  const handleSeek = useCallback((time: number) => {
    videoPlayerRef.current?.seek(time)
  }, [])

  const handleMuteToggle = useCallback(() => {
    setIsMuted((m) => !m)
  }, [setIsMuted])

  return (
    <VisibilityComponent
      className={cn('flex justify-center w-full h-full px-1', isMobile && 'items-center')}
      toggle={false}
    >
      {(visible) =>
        (visible || isSelected) &&
        ((template.previewVideo ?? template.resultVideo) ? (
          <div
            className={cn(
              'relative cursor-default overflow-hidden rounded-lg',
              isMobile ? mobileVideoFrameClass : 'flex-1 self-center',
            )}
          >
            <VideoWithSkeleton
              autoPlay={!isMobile}
              className={cn('overflow-hidden', isMobile ? 'size-full rounded-lg' : 'rounded-lg')}
              containerClassName={
                isMobile ? 'size-full rounded-lg overflow-hidden' : desktopVideoContainerClass
              }
              fallbackVideoUrl={template.resultVideo}
              loadingOverlaySrc={template.thumbnail}
              muted={isMuted}
              onLoadedMetadata={(d) => setDuration(d)}
              onPlay={() => setIsPlaying(true)}
              preload={isSelected ? 'auto' : 'none'}
              primitiveVideoPlayerProps={{
                controlsList: 'nodownload',
                onPause: () => setIsPlaying(false),
                onTimeUpdate: (e) => setCurrentTime(e.currentTarget.currentTime),
                onVolumeChange: (e) => {
                  setIsMuted(e.currentTarget.muted)
                  setVolume(e.currentTarget.volume)
                },
              }}
              videoPlayerRef={videoPlayerRef}
              videoUrl={template.resultVideo ?? template.previewVideo}
            />
            <VideoOverlayControls
              currentTime={currentTime}
              duration={duration}
              forceControlsVisible={isMobile}
              isMuted={isMuted}
              isPlaying={isPlaying}
              onMuteToggle={handleMuteToggle}
              onPause={handlePause}
              onPlay={handlePlay}
              onSeek={handleSeek}
            />
          </div>
        ) : (
          <div
            className={cn(
              'flex items-center justify-center bg-tertiary rounded-sm',
              isMobile ? unavailableVideoFrameClass : 'rounded-lg flex-1 min-h-[200px]',
            )}
          >
            <span className="text-secondary text-sm">Video unavailable</span>
          </div>
        ))
      }
    </VisibilityComponent>
  )
}
