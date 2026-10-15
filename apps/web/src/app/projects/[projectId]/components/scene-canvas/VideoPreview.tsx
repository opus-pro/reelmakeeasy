import { cn } from '@shared/ui'
import { useAtom } from 'jotai'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { VideoPlayerButton, VideoPlayerRef } from '@/components/VideoPlayer'
import VideoController, { ShotSegment } from '@/components/VideoPlayer/VideoController'
import { useSceneData } from '@/contexts/SceneDataContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectAtom } from '@/hooks/useProjects'
import { useIsMobile } from '@/util/browserUtils'
import { formatSecondsToTime } from '@/util/time-utils'

import { useShotItems } from '../../hooks/useShotItems'

import ScenePreview from './ScenePreview'
import StoryboardPanel from './StoryboardPanel'

export interface VideoPreviewRef {
  pause: () => void
  togglePlay: () => void
}

interface VideoPreviewProps {
  className?: string
  enableEdit?: boolean
  onEditShot?: (shotId: string) => void
}

const MOBILE_HIDE_MS = 3000

const VideoPreview = forwardRef<VideoPreviewRef, VideoPreviewProps>(
  ({ className, enableEdit, onEditShot }, ref) => {
    const { sceneList, isLoading } = useSceneData()

    const [isPlaying, setIsPlaying] = useState(false)
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [isMuted, setIsMuted] = useState(false)
    const [videoLoaded, setVideoLoaded] = useState(false)
    const playerRef = useRef<null | VideoPlayerRef>(null)

    const { projectInfo } = useProjectAtom()
    const isMobile = useIsMobile()
    const [isEditorMode, setIsEditorMode] = useAtom(isEditorModeAtom)
    const [showVideoControl, setShowVideoControl] = useState(true)
    const hideTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

    const ready = useMemo(() => {
      return !isLoading && sceneList.length > 0
    }, [isLoading, sceneList])

    const previewMode = useMemo(() => {
      return !projectInfo?.resultVideo
    }, [projectInfo])

    const { shotItems } = useShotItems({
      isLoading,
      projectId: projectInfo?.id,
      sceneList,
    })

    const currentShot = useMemo(() => {
      if (!shotItems || shotItems.length === 0 || currentTime < 0) {
        return null
      }
      let activeShotItem = shotItems.find(
        (item) => currentTime >= item.timeRange.start && currentTime < item.timeRange.end,
      )
      if (!activeShotItem) {
        const lastShotItem = shotItems[shotItems.length - 1]
        if (currentTime >= lastShotItem.timeRange.end) {
          activeShotItem = lastShotItem
        }
      }
      if (!activeShotItem) {
        return null
      }
      const scene = sceneList.find((s) => s.id === activeShotItem.sceneId)
      if (!scene) {
        return null
      }
      const shot = scene.shots?.find((s) => s.id === activeShotItem.id)
      if (!shot) {
        return null
      }
      return { shot, scene }
    }, [shotItems, sceneList, currentTime])

    const shotSegments = useMemo<ShotSegment[] | undefined>(() => {
      if (previewMode || !shotItems || shotItems.length === 0) {
        return undefined
      }
      return shotItems.map((item) => ({
        id: item.id,
        timeRange: item.timeRange,
        thumbnailUrl: item.thumbnailUrl,
        fallbackThumbnailUrl: item.sceneThumbnailUrl,
      }))
    }, [previewMode, shotItems])

    useEffect(() => {
      if (!shotSegments || shotSegments.length === 0) {
        return
      }
      const urls = new Set<string>()
      shotSegments.forEach((shot) => {
        if (shot.thumbnailUrl) {
          urls.add(shot.thumbnailUrl)
        }
        if (shot.fallbackThumbnailUrl && shot.fallbackThumbnailUrl !== shot.thumbnailUrl) {
          urls.add(shot.fallbackThumbnailUrl)
        }
      })
      if (urls.size === 0) {
        return
      }
      const images: HTMLImageElement[] = []
      urls.forEach((url) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.decoding = 'async'
        img.src = url
        images.push(img)
      })
      return () => {
        images.forEach((img) => {
          img.src = ''
        })
      }
    }, [shotSegments])

    const storyboardData = useMemo(() => {
      if (currentShot) {
        const { shot } = currentShot
        const scriptText = shot.script
        const motionDescription = shot.description
        const durationStr = shot.timeRange
          ? `${formatSecondsToTime(shot.timeRange.start)} - ${formatSecondsToTime(shot.timeRange.end)}`
          : undefined
        return { scriptText, motionDescription, duration: durationStr }
      }

      return null
    }, [currentShot])

    const handleEditShot = useRefCallback(() => {
      if (!currentShot?.shot.id) {
        return
      }
      setIsEditorMode(true)
      onEditShot?.(currentShot.shot.id)
    })

    const handleVideoLoaded = useCallback((duration: number) => {
      setDuration(duration)
      setVideoLoaded(true)
    }, [])

    useEffect(() => {
      if (videoLoaded && isEditorMode && playerRef.current) {
        playerRef.current?.pause()
      }
    }, [videoLoaded, isEditorMode])

    const handleVideoTimeUpdate = useRefCallback((currentTime: number, _duration: number) => {
      setCurrentTime(currentTime)
    })

    const playVideo = useRefCallback(() => {
      playerRef.current?.play()
    })

    const pauseVideo = useRefCallback(() => {
      playerRef.current?.pause()
    })

    const handleVideoPlayEvent = useRefCallback(() => {
      setIsPlaying(true)
    })

    const handleVideoPauseEvent = useRefCallback(() => {
      setIsPlaying(false)
    })

    const togglePlay = useRefCallback(() => {
      if (isPlaying) {
        pauseVideo()
      } else {
        playVideo()
      }
    })

    useImperativeHandle(ref, () => ({
      pause: pauseVideo,
      togglePlay,
    }))

    const handleVideoSeek = useRefCallback((time: number) => {
      setCurrentTime(time)
      playerRef.current?.seek(time)
    })

    const handleMuteToggle = useRefCallback(() => {
      const newMuted = !isMuted
      setIsMuted(newMuted)
      playerRef.current?.setMuted(newMuted)
    })

    const clearHideTimer = useRefCallback(() => {
      if (!hideTimerRef.current) {
        return
      }
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    })

    const showControlsAndMaybeAutoHide = useRefCallback(() => {
      setShowVideoControl(true)
      clearHideTimer()
      if (!isMobile || !isPlaying) {
        return
      }

      hideTimerRef.current = setTimeout(() => {
        setShowVideoControl(false)
        hideTimerRef.current = null
      }, MOBILE_HIDE_MS)
    })

    const handleClickVideo = useRefCallback(() => {
      if (isMobile) {
        showControlsAndMaybeAutoHide()
      } else {
        togglePlay()
      }
    })

    const handleClickVideoPlayButton = useRefCallback(() => {
      togglePlay()
    })

    const canPlay = useMemo(() => !previewMode, [previewMode])

    useEffect(() => {
      if (!isMobile || !canPlay || !isPlaying) {
        clearHideTimer()
        setShowVideoControl(true)
        return
      }

      showControlsAndMaybeAutoHide()
      return clearHideTimer
    }, [canPlay, isMobile, isPlaying])

    return (
      <main
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-between overflow-hidden',
          isMobile ? 'pt-0' : 'pt-6',
          className,
        )}
      >
        <div className="flex h-full min-h-0 flex-1 flex-row items-center justify-center gap-x-6 mb-2 pb-10">
          {/* Left spacer - hidden on small screens to keep video centered */}
          {!isMobile && (
            <div className="relative z-0 hidden w-48 shrink-0 flex-col items-end justify-center self-start min-[1080px]:flex" />
          )}
          <div className="group relative flex sm:h-full flex-1 flex-col items-center justify-center">
            <ScenePreview
              autoPlay={!isEditorMode}
              isMuted={isMuted}
              onClick={handleClickVideo}
              onVideoLoaded={handleVideoLoaded}
              onVideoPause={handleVideoPauseEvent}
              onVideoPlay={handleVideoPlayEvent}
              onVideoTimeUpdate={handleVideoTimeUpdate}
              playerRef={playerRef}
              previewMode={previewMode}
              projectInfo={projectInfo}
              ready={ready}
              selectedScene={currentShot?.scene}
            />
            {canPlay && showVideoControl && (
              <>
                <VideoPlayerButton
                  className={cn(isMobile ? 'block' : 'group-hover:block', !isPlaying && 'block')}
                  isPlaying={isPlaying}
                  onClick={handleClickVideoPlayButton}
                />
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200 overflow-visible',
                    isMobile
                      ? 'opacity-100 pointer-events-auto'
                      : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                    !isMobile && !isPlaying && 'opacity-100 pointer-events-auto',
                  )}
                >
                  <div
                    className="absolute inset-0 overflow-hidden rounded-b-xl"
                    style={{
                      background:
                        'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)',
                    }}
                  />
                  <VideoController
                    className="!p-2"
                    currentTime={currentTime}
                    disabled={false}
                    duration={duration}
                    isMuted={isMuted}
                    isPlaying={isPlaying}
                    onMuteToggle={handleMuteToggle}
                    onPause={pauseVideo}
                    onPlay={playVideo}
                    onSeek={handleVideoSeek}
                    shots={shotSegments}
                    showPlayButton={false}
                  />
                </div>
              </>
            )}
          </div>
          {!isMobile && (
            <StoryboardPanel
              className={cn(
                'relative z-0 w-48 shrink-0 hidden flex-col items-start justify-center self-start min-[1080px]:flex',
                !storyboardData && 'opacity-0',
              )}
              duration={storyboardData?.duration}
              enableEditShot={enableEdit && !!currentShot}
              motionDescription={storyboardData?.motionDescription}
              onEditShot={handleEditShot}
              scriptText={storyboardData?.scriptText}
            />
          )}
        </div>
      </main>
    )
  },
)

VideoPreview.displayName = 'VideoPreview'

export default memo(VideoPreview)
