import { Logger } from '@reelmakeeasy/common/utils/logger'
import { SceneDataForCanvas } from '@shared/types/api'
import { Project } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { cn, toast } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { memo, useMemo, useState } from 'react'

import {
  canceledProjectsSetAtom,
  projectProgressFamily,
  videoRefreshTimestampAtom,
} from '@/atom/project'
import ShaderGradientBackground from '@/components/animated/ShaderGradientBackground'
import { ContextMenuItem, ContextMenuRenderer, useContextMenu } from '@/components/ContextMenu'
import { CrossCircle, Info } from '@/components/icons/core'
import { VideoPlayer, VideoPlayerRef } from '@/components/VideoPlayer'
import { useFileUrl } from '@/hooks/use-file-url'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectWritePermission } from '@/hooks/useProjectWritePermission'
import { useVideoDownload } from '@/hooks/useVideoDownload'

import { ProjectBgParams } from '../../constants/shader-gradient'

const nsLogger = Logger.get('project.scene-preview')

const suppressContextMenu = (e: React.MouseEvent) => e.preventDefault()

interface ScenePreviewProps {
  autoFitAspectRatio?: boolean
  autoPlay?: boolean
  enableContextMenu?: boolean
  isMuted?: boolean
  onClick?: () => void
  onVideoLoaded: (duration: number) => void
  onVideoPause: () => void
  onVideoPlay: () => void
  onVideoTimeUpdate: (currentTime: number, duration: number) => void
  playerRef: React.RefObject<null | VideoPlayerRef>
  previewMode?: boolean
  projectInfo: null | Project
  ready?: boolean
  selectedScene?: SceneDataForCanvas
  showBufferingIndicator?: boolean
  showHoverPlayButton?: boolean
  showPlayButtonWithPause?: boolean
}

const ScenePreview: React.FC<ScenePreviewProps> = ({
  autoFitAspectRatio = false,
  autoPlay = true,
  enableContextMenu = true,
  playerRef,
  isMuted = false,
  selectedScene,
  projectInfo,
  ready,
  previewMode,
  showBufferingIndicator = false,
  showHoverPlayButton = false,
  showPlayButtonWithPause = false,
  onClick,
  onVideoLoaded,
  onVideoTimeUpdate,
  onVideoPlay,
  onVideoPause,
}) => {
  const projectId = projectInfo?.id || ''
  const { addImgHostname } = useFileUrl()
  const { download } = useVideoDownload()
  // true => browser has enough media data to continue playback; false => buffering/not ready.
  const [isVideoReady, setIsVideoReady] = useState(false)
  // Keep buffering UI off while paused so hover controls remain the primary affordance.
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoAspectRatio, setVideoAspectRatio] = useState(9 / 16)
  const contextMenu = useContextMenu()
  const { guard } = useProjectWritePermission()
  const progressData = useAtomValue(projectProgressFamily(projectId))
  const videoRefreshTimestamp = useAtomValue(videoRefreshTimestampAtom)
  const canceledProjects = useAtomValue(canceledProjectsSetAtom)
  const isNormalProject = !projectInfo?.isLongTake && !projectInfo?.routePrefix
  const isProjectCanceled =
    isNormalProject &&
    (canceledProjects.has(projectId) || projectInfo?.stage === PROJECT_STAGE.CANCELED)
  const handleEnded = useRefCallback(() => {
    setIsVideoPlaying(false)
    onVideoPause()
  })

  const handleVideoLoaded = useRefCallback((duration: number) => {
    setIsVideoReady(true)
    onVideoLoaded(duration)
    if (autoFitAspectRatio) {
      const size = playerRef.current?.getVideoSize()
      if (size?.width && size?.height) {
        setVideoAspectRatio(size.width / size.height)
      }
    }
  })

  const handleVideoTimeUpdate = useRefCallback((currentTime: number, duration: number) => {
    onVideoTimeUpdate(currentTime, duration)
  })

  const handleDownload = useRefCallback(async ({ watermark }: { watermark?: boolean }) => {
    if (!projectId) {
      toast.error('Video not ready for download')
      return
    }

    try {
      await download(projectId, Boolean(watermark))
    } catch (error) {
      nsLogger.error('Download failed:', error)
      toast.error('Download failed. Please try again.')
    }
  })

  const handleVideoPause = useRefCallback(() => {
    setIsVideoPlaying(false)
    onVideoPause()
  })

  const handleVideoError = useRefCallback((e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    setIsVideoPlaying(false)
    setIsVideoReady(false)
    const video = e.currentTarget as HTMLVideoElement
    const error = video.error

    const errorInfo = {
      errorCode: error?.code,
      errorMessage: error?.message,
      currentSrc: video.currentSrc,
      src: video.src,
      networkState: video.networkState,
      readyState: video.readyState,
    }

    nsLogger.warn('Video error details:', errorInfo)

    // 3 === MEDIA_ERR_DECODE, which means the video file is invalid
    if (error?.code === 3) {
      toast.warning('The video file is invalid. Please contact support.')
    }
  })

  const handleVideoPlay = useRefCallback(() => {
    setIsVideoPlaying(true)
    onVideoPlay()
  })

  const handleVideoSeeking = useRefCallback(() => {
    if (isVideoPlaying) {
      // Paused scrubbing should not look like buffering.
      setIsVideoReady(false)
    }
  })

  const handleVideoSeeked = useRefCallback(() => {
    setIsVideoReady(true)
  })

  const handleVideoLoadStart = useRefCallback(() => {
    setIsVideoReady(false)
  })

  const handleVideoCanPlay = useRefCallback(() => {
    setIsVideoReady(true)
  })

  const handleVideoWaiting = useRefCallback(() => {
    if (isVideoPlaying) {
      // `waiting` often means network starvation during playback.
      setIsVideoReady(false)
    }
  })

  const handleVideoPlaying = useRefCallback(() => {
    setIsVideoReady(true)
  })

  const imageUrl = selectedScene?.imageUrl
  const showCountdown = useMemo(() => {
    return projectInfo !== null && !imageUrl && Boolean(progressData.remainingMs)
  }, [projectInfo, imageUrl, progressData.remainingMs])

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Export with watermark',
      onClick: guard(() => handleDownload({ watermark: true })),
      disabled: !projectInfo?.watermarkVideo,
    },
    {
      label: 'Export without watermark',
      onClick: guard(() => handleDownload({ watermark: false })),
      disabled: !projectInfo?.resultVideo,
    },
  ]

  const isWideVideo = autoFitAspectRatio ? videoAspectRatio >= 1 : false
  const aspectStyle = autoFitAspectRatio ? { aspectRatio: videoAspectRatio } : undefined

  if (previewMode) {
    return (
      <div
        className={cn(
          'relative z-0 flex size-full items-center justify-center rounded-2xl overflow-hidden',
          autoFitAspectRatio ? 'h-full w-auto max-w-full' : 'aspect-[9/16] h-full w-auto',
          autoFitAspectRatio && (isWideVideo ? 'h-auto w-full' : 'h-full w-auto'),
        )}
        style={aspectStyle}
      >
        {ready && imageUrl && (
          <img
            alt="Scene storyboard"
            className="block size-full object-cover"
            src={addImgHostname(imageUrl)}
          />
        )}
        {isProjectCanceled && (
          <div className="relative flex size-full flex-1 flex-col items-center justify-center gap-y-6 px-8 bg-transparent">
            <CrossCircle className="size-6" style={{ color: 'var(--Text-light-primary, #FFF)' }} />
            <div
              style={{
                color: 'var(--Text-light-primary, #FFF)',
                fontSize: '18px',
                fontWeight: 600,
                lineHeight: '21.8px',
                fontFeatureSettings: "'ss01' on, 'ss03' on, 'ss04' on, 'ss06' on, 'ss08' on",
                textAlign: 'center',
              }}
            >
              Project canceled
            </div>
          </div>
        )}
        {projectInfo?.stage === PROJECT_STAGE.FAILED && (
          <div className="relative flex size-full flex-1 flex-col items-center justify-center gap-y-6 px-8 bg-transparent">
            <Info className="size-6" style={{ color: 'var(--Text-light-primary, #FFF)' }} />
            <div
              style={{
                color: 'var(--Text-light-primary, #FFF)',
                fontSize: '18px',
                fontWeight: 600,
                lineHeight: '21.8px',
                fontFeatureSettings: "'ss01' on, 'ss03' on, 'ss04' on, 'ss06' on, 'ss08' on",
                textAlign: 'center',
              }}
            >
              Project failed
            </div>
          </div>
        )}
        {showCountdown && !isProjectCanceled && (
          <div className="relative flex size-full flex-1 flex-col items-center justify-center gap-y-6 px-8 bg-transparent">
            <div className="size-6 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <div
              style={{
                color: 'var(--Text-primary)',
                fontSize: '18px',
                fontWeight: 600,
                lineHeight: '21.8px',
                fontFeatureSettings: "'ss01' on, 'ss03' on, 'ss04' on, 'ss06' on, 'ss08' on",
                textAlign: 'center',
              }}
            >
              Preparing your video plan...
            </div>
            <span
              style={{
                color: 'var(--Text-secondary, rgba(255, 255, 255, 0.50))',
                fontSize: '16px',
                fontWeight: 500,
                lineHeight: '20px',
                fontFeatureSettings: "'ss01' on, 'ss03' on, 'ss04' on, 'ss06' on, 'ss08' on",
                textAlign: 'center',
              }}
            >
              {Math.round(progressData.value * 100)}%
            </span>
          </div>
        )}
        <ShaderGradientBackground
          className={cn(
            'absolute -z-10 rounded-2xl inset-0 pointer-events-none opacity-0 overflow-hidden',
            (showCountdown || projectInfo?.stage === PROJECT_STAGE.FAILED || isProjectCanceled) &&
              'opacity-100',
          )}
          gradientProps={ProjectBgParams}
        />
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'relative aspect-[9/16] h-full w-auto overflow-hidden rounded-xl',
          autoFitAspectRatio
            ? isWideVideo
              ? 'w-full h-auto'
              : 'h-full w-auto'
            : 'aspect-[9/16] h-full w-auto',
        )}
        onContextMenu={enableContextMenu ? contextMenu.handleContextMenu : suppressContextMenu}
        style={aspectStyle}
      >
        {showBufferingIndicator && !isVideoReady && isVideoPlaying && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-fill-secondary/70 pointer-events-none">
            <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
        <VideoPlayer
          autoPlay={autoPlay}
          className={autoFitAspectRatio ? 'size-full object-contain' : 'size-full'}
          containerClassName="size-full"
          loop={false}
          onClick={onClick}
          onEnded={handleEnded}
          onError={handleVideoError}
          onLoadedMetadata={handleVideoLoaded}
          onPause={handleVideoPause}
          onPlay={handleVideoPlay}
          onTimeUpdate={handleVideoTimeUpdate}
          primitiveVideoPlayerProps={{
            muted: isMuted,
            onCanPlay: handleVideoCanPlay,
            onLoadStart: handleVideoLoadStart,
            onPlaying: handleVideoPlaying,
            onSeeked: handleVideoSeeked,
            onSeeking: handleVideoSeeking,
            onWaiting: handleVideoWaiting,
          }}
          ref={playerRef}
          showHoverPlayButton={showHoverPlayButton}
          showPlayButtonWithPause={showPlayButtonWithPause}
          spacebarHandling="off"
          src={(() => {
            const videoUrl = projectInfo?.resultVideo
            if (!videoUrl) {
              return ''
            }
            return `${addImgHostname(videoUrl)}?t=${videoRefreshTimestamp}`
          })()}
        />
      </div>
      <ContextMenuRenderer
        isOpen={contextMenu.isOpen}
        itemClassName="h-8 px-2.5 gap-1.5 hover:bg-fill-hover rounded-sm text-sm font-medium leading-[17px]"
        items={contextMenuItems}
        menuClassName="bg-menu-background shadow-none backdrop-blur-2xl w-[304px] rounded-2xl border-0"
        onClose={contextMenu.close}
        position={contextMenu.position}
      />
    </>
  )
}

export default memo(ScenePreview)
