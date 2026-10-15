'use client'

import { LongTakeStatusStage, LongTakeStatusState } from '@shared/types/api/long-take'
import { Project, ProjectVoiceOverJson } from '@shared/types/api/project'
import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import type { DebugSettings } from '@shared/types/project/debug-settings'
import { Button, cn } from '@shared/ui'
import React, { memo, ReactNode, useEffect, useRef, useState } from 'react'

import { VideoWithSkeleton } from '@/app/home/components/VideoWithSkeleton'
import { ContextMenuRenderer, useContextMenu } from '@/components/ContextMenu'
import { Cross } from '@/components/icons/core'
import { ProgressiveBlurWithGradient } from '@/components/ProgressiveBlurWithGradient'
import { ProjectThumbnailStrip, type ThumbnailItem } from '@/components/ProjectThumbnailStrip'
import type { VideoPlayerRef } from '@/components/VideoPlayer'
import VideoPlayer, { BufferingSpinner, usePlaybackBuffering } from '@/components/VideoPlayer'
import VideoOverlayControls from '@/components/VideoPlayer/VideoOverlayControls'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useMobileActionsScrollPadding } from '@/hooks/useMobileActionsScrollPadding'
import type { StoryModeShareActionSource } from '@/hooks/useStoryModeShareActions'
import { useVideoDownload } from '@/hooks/useVideoDownload'

import { STORY_MODE_MOBILE_TOP_INSET_CLASS } from '../../constants'
import { StoryModeFrame } from '../StoryModeFrame'

import { DetailPanel } from './DetailPanel'
import { MobileVideoStatusStrip } from './MobileVideoStatusStrip'
import { getUipProcessingOverrides } from './progress'
import { ProcessingPreview } from './StorySequencer'

export interface FinalVideoViewProps {
  assets?: QuickStartTemplateAsset[]
  /**
   * Whether the project can carry captions at all. Distinct from
   * showCaptionSwitch, which also requires permission to change them -- the
   * read-only status strip must still report captions on a share page.
   */
  captionAvailable?: boolean
  concurrentStages?: LongTakeStatusStage[]
  // Pre-resolved image/video model for the badges. When provided (e.g. the demo
  // path resolves them from the durable DemoProject snapshot), these win over
  // the live `project`-derived values; omit to derive from `project` (project /
  // share pages, where the live project is the source of truth).
  initialMuted?: boolean
  initPrompt?: string
  isMobile?: boolean
  isOwner: boolean
  isUip?: boolean
  lipSyncDownloadEnabled?: boolean
  lipSyncEnabled?: boolean
  onClose: () => void
  onLipSyncSwitch?: (next: boolean) => void
  onPreviewAssetChange?: (asset: null | QuickStartTemplateAsset) => void
  onSelectSibling?: (id: string, index: number) => void
  onViewChatHistory?: () => void
  // 'controlled' overlays VideoOverlayControls on the video on desktop (default
  // on the project page); mobile keeps the primitive player's hover controls.
  // 'native' uses VideoWithSkeleton with native browser controls.
  playerVariant?: StoryModePlayerVariant
  poster?: string
  // Full project record, forwarded to DetailPanel for the mobile more-menu Delete.
  project?: Project
  projectId: string
  ratio: string | undefined
  script: string | undefined
  shareMode?: boolean
  shouldShowProcessingPreview: boolean
  showCaptionSwitch?: boolean
  showChatHistory?: boolean
  showLipSyncSwitch?: boolean
  // Renders StoryModeInputTranscriptPanels (input/transcript tabs) in the
  // detail panel instead of the bare transcript section. Used on share/demo.
  showUserPrompt?: boolean
  siblings?: ThumbnailItem[]
  // Source project's BGM state; forwarded to DetailPanel for remix carry.
  sourceBgmEnabled?: boolean | null
  sourceVoice?: null | ProjectVoiceOverJson
  stage: LongTakeStatusStage | undefined
  stageDetail?: string
  stageStatus: LongTakeStatusState | undefined
  styleName: string | undefined
  styleText: string | undefined
  styleThumbnailUrl: string | undefined
  templateAudioUrl?: string
  // Optional overlay anchored to the top of the video column (share banner).
  topOverlay?: ReactNode
  // Forwarded to DetailPanel; tags Copy style / Remix tracking by entry-point.
  trackingSource?: StoryModeShareActionSource
  videoAspectRatio: string
  videoModel?: null | string
  videoUrl: string
  watermarkVideoUrl?: null | string
}

export type StoryModePlayerVariant = 'controlled' | 'native'

function MobileActionBar({
  onClose,
  topBarPortalRef,
}: {
  onClose: () => void
  topBarPortalRef: (node: HTMLDivElement | null) => void
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-between px-4 pb-4',
        STORY_MODE_MOBILE_TOP_INSET_CLASS,
      )}
    >
      <div className="flex items-center gap-2" ref={topBarPortalRef} />
      <Button aria-label="Close" className="rounded-full" onClick={onClose} size="icon">
        <Cross className="size-3.5 text-primary" />
      </Button>
    </div>
  )
}

function MobileBody({
  detailPanel,
  onContextMenu,
  statusStrip,
  videoAspectRatio,
  videoContent,
}: {
  detailPanel: ReactNode
  onContextMenu: React.MouseEventHandler<HTMLDivElement>
  /** One-line Caption / Background music summary, drawn between the two. */
  statusStrip?: ReactNode
  videoAspectRatio: string
  videoContent: ReactNode
}) {
  return (
    <>
      <div
        className="w-[clamp(200px,68vw,352px)] shrink-0 overflow-hidden rounded-lg"
        onContextMenu={onContextMenu}
        style={{ aspectRatio: videoAspectRatio }}
      >
        {videoContent}
      </div>
      {statusStrip}
      <div className="w-full">{detailPanel}</div>
    </>
  )
}

// Show the loading spinner before the first frame is ready (initial load) and
// again whenever playback stalls to re-buffer, but never over an error.
const shouldShowLoadingSpinner = (
  isVideoReady: boolean,
  isBuffering: boolean,
  hasVideoError: boolean,
) => (!isVideoReady || isBuffering) && !hasVideoError

// Screen-reader label for the loading spinner: distinguishes a mid-playback
// re-buffer from the initial load.
const loadingSpinnerLabel = (isBuffering: boolean) => (isBuffering ? 'Buffering' : 'Loading video')

const FinalVideoView: React.FC<FinalVideoViewProps> = ({
  assets,
  captionAvailable,
  showCaptionSwitch = false,
  showChatHistory = false,
  showLipSyncSwitch = false,
  showUserPrompt = false,
  concurrentStages,
  initPrompt,
  initialMuted = true,
  isUip,
  isOwner,
  lipSyncDownloadEnabled,
  lipSyncEnabled,
  isMobile,
  onClose,
  onLipSyncSwitch,
  onPreviewAssetChange,
  onSelectSibling,
  onViewChatHistory,
  playerVariant = 'controlled',
  poster,
  project,
  projectId,
  ratio,
  script,
  shareMode = false,
  shouldShowProcessingPreview,
  siblings,
  sourceBgmEnabled,
  sourceVoice,
  stage,
  stageDetail,
  stageStatus,
  styleName,
  styleText,
  styleThumbnailUrl,
  templateAudioUrl,
  topOverlay,
  trackingSource,
  videoAspectRatio,
  videoModel,
  videoUrl,
  watermarkVideoUrl,
}) => {
  const isNativePlayer = playerVariant === 'native'
  const hasDesktopSiblings = Boolean(siblings && siblings.length > 1 && onSelectSibling)
  const playerRef = useRef<null | VideoPlayerRef>(null)
  const nativePlayerRef = useRef<null | VideoPlayerRef>(null)
  useEffect(() => {
    nativePlayerRef.current?.setMuted(initialMuted)
    // Explicit play() call needed for unmuted video on mobile: the autoPlay attribute
    // alone is insufficient when the video is unmuted; browsers require an imperative
    // play() call connected to the user gesture. setMuted runs first so play() sees
    // the correct muted state immediately.
    nativePlayerRef.current?.play()?.catch(() => undefined)
  }, []) // mount only; never re-apply so native controls are not overridden on re-render
  const [isPlaying, setIsPlaying] = useState(false)
  const [isVideoReady, setIsVideoReady] = useState(false)
  const { bufferingHandlers, isBuffering, resetBuffering } = usePlaybackBuffering(
    isPlaying,
    videoUrl,
  )
  const [hasVideoError, setHasVideoError] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [mobileActionsPortalElement, setMobileActionsPortalElement] =
    useState<HTMLDivElement | null>(null)
  const [mobileTopBarPortalElement, setMobileTopBarPortalElement] = useState<HTMLDivElement | null>(
    null,
  )
  const mobileActionsScrollPadding = useMobileActionsScrollPadding(mobileActionsPortalElement)
  // Share path uses a fixed top group (banner + action bar); measure it so scroll
  // content clears it, mirroring how the non-share bar uses a static top padding.
  const [mobileTopGroupElement, setMobileTopGroupElement] = useState<HTMLDivElement | null>(null)
  const mobileTopScrollPadding = useMobileActionsScrollPadding(mobileTopGroupElement)
  const contextMenu = useContextMenu()
  const { download, isDownloading } = useVideoDownload()

  const handleContextMenuDownload = useRefCallback(async (watermark: boolean) => {
    if (!projectId || !videoUrl) {
      return
    }
    await download(projectId, watermark, undefined, { lipSync: lipSyncDownloadEnabled })
  })

  useEffect(() => {
    setIsVideoReady(false)
    setHasVideoError(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [videoUrl])

  const uipOverrides = getUipProcessingOverrides(isUip, stage)

  const videoContent = shouldShowProcessingPreview ? (
    <ProcessingPreview
      aspectRatio={videoAspectRatio}
      concurrentStages={concurrentStages}
      headlineOverride={uipOverrides?.headline}
      labelOverride={uipOverrides?.label}
      stage={stage}
      stageDetail={stageDetail}
      status={stageStatus}
    />
  ) : isNativePlayer ? (
    <VideoWithSkeleton
      autoPlay
      className="size-full overflow-hidden rounded-2xl"
      fetchPriority="high"
      loadingOverlaySrc={poster} // Image overlay to display until loadedmetadata fires
      loop={false}
      poster={poster} // <video poster> native attribute; cannot rename, part of VideoPlayerProps
      primitiveVideoPlayerProps={{
        controls: true,
        controlsList: 'nodownload',
        muted: initialMuted,
      }}
      videoPlayerRef={nativePlayerRef}
      videoUrl={videoUrl}
    />
  ) : (
    <div className="relative size-full overflow-hidden rounded-2xl">
      <VideoPlayer
        className="size-full object-contain"
        containerClassName="size-full"
        fetchPriority="high"
        onEnded={() => resetBuffering()}
        onError={() => setHasVideoError(true)}
        onLoadedMetadata={(d) => {
          setDuration(d)
          setIsVideoReady(true)
        }}
        onPause={() => {
          setIsPlaying(false)
          resetBuffering()
        }}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(t) => setCurrentTime(t)}
        poster={poster}
        preload="auto"
        primitiveVideoPlayerProps={{
          ...bufferingHandlers,
        }}
        ref={playerRef}
        showHoverPlayButton={!!isMobile}
        showPlayButtonWithPause={!!isMobile}
        src={videoUrl}
      />
      {!isMobile && (
        <VideoOverlayControls
          currentTime={currentTime}
          duration={duration}
          isMuted={isMuted}
          isPlaying={isPlaying}
          onMuteToggle={() => {
            const next = !isMuted
            playerRef.current?.setMuted(next)
            setIsMuted(next)
          }}
          onPause={() => playerRef.current?.pause()}
          onPlay={() => playerRef.current?.play()}
          onSeek={(time) => {
            setCurrentTime(time)
            playerRef.current?.seek(time)
          }}
        />
      )}
      {shouldShowLoadingSpinner(isVideoReady, isBuffering, hasVideoError) && (
        <BufferingSpinner label={loadingSpinnerLabel(isBuffering)} />
      )}
    </div>
  )

  // Prefer the pre-resolved model (demo snapshot path) and only derive from the
  // live project when the caller did not supply it (project / share pages).
  const projectVideoModel = project
    ? ((project.debugSettings as DebugSettings | undefined)?.transitionVideoModel ?? null)
    : undefined
  const resolvedVideoModel = videoModel === undefined ? projectVideoModel : videoModel

  const detailPanel = (
    <DetailPanel
      assets={assets}
      initPrompt={initPrompt}
      isMobile={isMobile}
      isOwner={isOwner}
      lipSyncDownloadEnabled={lipSyncDownloadEnabled}
      lipSyncEnabled={lipSyncEnabled}
      mobileActionsPortalElement={isMobile ? mobileActionsPortalElement : null}
      mobileTopBarPortalElement={isMobile ? mobileTopBarPortalElement : null}
      onLipSyncSwitch={onLipSyncSwitch}
      onPreviewAssetChange={onPreviewAssetChange}
      onViewChatHistory={onViewChatHistory}
      project={project}
      projectId={projectId}
      ratio={ratio}
      script={script}
      shareMode={shareMode}
      showCaptionSwitch={showCaptionSwitch}
      showChatHistory={showChatHistory}
      showLipSyncSwitch={showLipSyncSwitch}
      showUserPrompt={showUserPrompt}
      sourceBgmEnabled={sourceBgmEnabled}
      sourceVoice={sourceVoice}
      stage={stage}
      styleName={styleName}
      styleText={styleText}
      styleThumbnailUrl={styleThumbnailUrl}
      templateAudioUrl={templateAudioUrl}
      trackingSource={trackingSource}
      videoModel={resolvedVideoModel}
      videoUrl={videoUrl}
      watermarkVideoUrl={watermarkVideoUrl}
    />
  )

  if (isMobile) {
    const actionBar = (
      <MobileActionBar onClose={onClose} topBarPortalRef={setMobileTopBarPortalElement} />
    )
    return (
      <div className="relative flex size-full flex-col bg-background">
        {topOverlay ? (
          <div className="fixed inset-x-0 top-0 z-50" ref={setMobileTopGroupElement}>
            <ProgressiveBlurWithGradient strongEdge="top" />
            <div className="relative">
              <div className="pt-5">{topOverlay}</div>
              {actionBar}
            </div>
          </div>
        ) : (
          <div className="fixed inset-x-0 top-0 z-50">{actionBar}</div>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto scrollbar-hide"
          style={{
            // 0 on the non-share path (the top group is only ref'd when topOverlay exists).
            paddingBottom: mobileActionsScrollPadding,
            paddingTop: mobileTopScrollPadding,
          }}
        >
          <div className={cn('flex w-full flex-col items-center gap-4', !topOverlay && 'pt-16')}>
            <MobileBody
              detailPanel={detailPanel}
              onContextMenu={contextMenu.handleContextMenu}
              statusStrip={<MobileVideoStatusStrip showCaption={captionAvailable} />}
              videoAspectRatio={videoAspectRatio}
              videoContent={videoContent}
            />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-40" ref={setMobileActionsPortalElement} />
        <ContextMenuRenderer
          isOpen={contextMenu.isOpen}
          itemClassName="h-8 px-2.5 gap-1.5 hover:bg-fill-hover rounded-sm text-sm font-medium leading-[17px]"
          items={[
            {
              label: 'Export with watermark',
              onClick: () => handleContextMenuDownload(true),
              disabled: isDownloading || !videoUrl,
            },
            {
              label: 'Export without watermark',
              onClick: () => handleContextMenuDownload(false),
              disabled: isDownloading || !videoUrl,
            },
          ]}
          menuClassName="bg-menu/80 shadow-none backdrop-blur-[40px] w-[304px] rounded-[16px] border-0"
          onClose={contextMenu.close}
          position={contextMenu.position}
        />
      </div>
    )
  }

  const desktopCenter = (
    <div className="flex size-full min-h-0 flex-col gap-4 rounded-2xl p-2">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          className="h-full max-h-full max-w-full"
          onContextMenu={contextMenu.handleContextMenu}
          style={{ aspectRatio: videoAspectRatio }}
        >
          {videoContent}
        </div>
      </div>
    </div>
  )

  const desktopSiblingStrip =
    hasDesktopSiblings && siblings && onSelectSibling ? (
      <aside className="flex shrink-0 items-start justify-center">
        <ProjectThumbnailStrip items={siblings} onSelect={onSelectSibling} selectedId={projectId} />
      </aside>
    ) : undefined

  const desktopExtras = (
    <>
      <ContextMenuRenderer
        isOpen={contextMenu.isOpen}
        itemClassName="h-8 px-2.5 gap-1.5 hover:bg-fill-hover rounded-sm text-sm font-medium leading-[17px]"
        items={[
          {
            label: 'Export with watermark',
            onClick: () => handleContextMenuDownload(true),
            disabled: isDownloading || !videoUrl,
          },
          {
            label: 'Export without watermark',
            onClick: () => handleContextMenuDownload(false),
            disabled: isDownloading || !videoUrl,
          },
        ]}
        menuClassName="bg-menu/80 shadow-none backdrop-blur-[40px] w-[304px] rounded-[16px] border-0"
        onClose={contextMenu.close}
        position={contextMenu.position}
      />
    </>
  )

  return (
    <StoryModeFrame
      center={desktopCenter}
      extras={desktopExtras}
      onClose={onClose}
      panel={detailPanel}
      siblingStrip={desktopSiblingStrip}
      topOverlay={topOverlay}
    />
  )
}

export default memo(FinalVideoView)
