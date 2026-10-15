'use client'
import { Button, cn, Popover, toast } from '@shared/ui'
import { motion } from 'framer-motion'
import { useAtomValue, useSetAtom } from 'jotai'
import { usePathname } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { deleteProjectDialogAtom } from '@/atom/delete-project-dialog'
import { projectProgressFamily } from '@/atom/project'
import { type ContextMenuItem, ContextMenuItems } from '@/components/ContextMenu'
import { Delete, More as OptionIcon } from '@/components/icons/core'
import { VideoPlayerRef } from '@/components/VideoPlayer'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useVideoDownload } from '@/hooks/useVideoDownload'
import { isTouchPrimaryInput } from '@/util/browser-env'
import { useIsMobile } from '@/util/browserUtils'

import {
  ASPECT_RATIO_CLASS,
  computeIsProcessing,
  deriveEffectivePreviewMode,
  getExportLabel,
  getTemplateCardBadgeLabel,
  getTemplateDisplayIndustry,
  getTemplateDisplayTitle,
  HOVER_ANIMATION_DURATION,
  HOVER_PREVIEW_CROSSFADE_DELAY_MS,
  type PreviewMode,
  PROJECT_STAGE,
  TemplateVideoCardProps,
} from './template-video-card-constants'
import {
  computeOverlayContent,
  TemplateVideoCardDefaultOverlay,
  TemplateVideoCardHoverOverlay,
  TemplateVideoCardMediaLayer,
} from './TemplateVideoCardComponents'

function playVideoRef(video: null | undefined | VideoPlayerRef) {
  Promise.resolve(video?.play()).catch((err: unknown) => {
    if (
      err instanceof DOMException &&
      (err.name === 'AbortError' || err.name === 'NotAllowedError')
    ) {
      return
    }
    // Uncomment to surface unexpected play() rejections during local debugging:
    // console.warn('[TemplateVideoCard] video.play() rejected', err)
  })
}

function useTemplateVideoCardState({
  onClickInitialIndex,
  project,
}: TemplateVideoCardProps & { effectivePreviewMode: PreviewMode }) {
  const pathname = usePathname()
  const { download, isDownloading } = useVideoDownload()
  const setDeleteDialog = useSetAtom(deleteProjectDialogAtom)

  const showOnProjectsPage = pathname.startsWith('/projects') && Boolean(project)
  const showWatermarkDownload = showOnProjectsPage && !!project?.watermarkVideo

  const progressData = useAtomValue(projectProgressFamily(project?.id ?? ''))
  const isProjectFinished =
    project?.stage === PROJECT_STAGE.FINISHED || Boolean(project?.resultVideo)
  const isLongTake = Boolean(project?.isLongTake)
  const isLongTakeInProcess =
    isLongTake &&
    project?.stage !== PROJECT_STAGE.FINISHED &&
    project?.stage !== PROJECT_STAGE.FAILED
  const currentPercentage = project ? Math.round(progressData.value * 100) : 0
  const prevPercentageRef = useRef<number>(currentPercentage)

  useEffect(() => {
    if (currentPercentage > 0) {
      prevPercentageRef.current = currentPercentage
    }
  }, [currentPercentage])

  const progressPercentage = isProjectFinished ? 0 : currentPercentage
  const showProgress = Boolean(project) && !isProjectFinished && progressPercentage > 0
  const isInProgressStage =
    Boolean(project) &&
    !isProjectFinished &&
    project?.stage !== PROJECT_STAGE.FAILED &&
    project?.stage !== PROJECT_STAGE.INITIALIZING
  const showProcessingWithoutProgress = Boolean(
    showOnProjectsPage && isInProgressStage && !showProgress && !isLongTakeInProcess,
  )
  const processingFlags = {
    isLongTakeInProcess,
    showProgress,
    showProcessingWithoutProgress,
  }
  const isProcessing = computeIsProcessing(Boolean(showOnProjectsPage), project, processingFlags)

  const handleDownload = useRefCallback(async (withWatermark: boolean) => {
    if (!project?.id) {
      toast.error('Video not ready for download')
      return
    }
    try {
      await download(project.id, withWatermark, project.routePrefix)
    } catch (_) {
      toast.error('Download failed. Please try again.')
    }
  })

  const handleDelete = useRefCallback(() => {
    if (project) {
      setDeleteDialog({ open: true, project })
    }
  })

  const overlayContent = computeOverlayContent(
    Boolean(showOnProjectsPage),
    project,
    processingFlags,
  )

  const menuItems: ContextMenuItem[] = showOnProjectsPage
    ? [
        {
          label: getExportLabel(isDownloading, Boolean(showWatermarkDownload)),
          onClick: () => handleDownload(true),
          disabled: isDownloading || !project?.resultVideo,
        },
        ...(showWatermarkDownload
          ? [
              {
                label: isDownloading ? 'Exporting...' : 'Export without watermark',
                onClick: () => handleDownload(false),
                disabled: isDownloading || !project?.resultVideo,
              },
            ]
          : []),
        {
          icon: <Delete className="size-4.5" />,
          label: 'Delete',
          onClick: handleDelete,
          separator: true,
        },
      ]
    : []

  const handleCardClick = useRefCallback(() => {
    onClickInitialIndex()
  })

  return {
    handleCardClick,
    isProcessing,
    menuItems,
    overlayContent,
    prevPercentageRef,
    progressPercentage,
    showOnProjectsPage,
    showProgress,
  }
}

const TemplateVideoCardImpl: React.FC<TemplateVideoCardProps> = ({
  activeFilterCategory,
  aspectRatio = '9:16',
  onClickInitialIndex,
  previewMode = 'lazy-hover',
  project,
  showInputTypeBadge = true,
  template,
}) => {
  const isMobile = useIsMobile() || isTouchPrimaryInput()
  const effectivePreviewMode: PreviewMode = deriveEffectivePreviewMode(previewMode, isMobile)
  const cardRootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<VideoPlayerRef>(null)
  const [videoMounted, setVideoMounted] = useState(false)
  const hoverTitleRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [hasEverPreviewed, setHasEverPreviewed] = useState(false)
  const [hoverPreviewReady, setHoverPreviewReady] = useState(false)
  const [hoverPreviewVisible, setHoverPreviewVisible] = useState(false)
  const [isInViewport, setIsInViewport] = useState(false)
  const isMobileAutoplay = isMobile && effectivePreviewMode === 'eager-autoplay'
  const [hoverTitleHeight, setHoverTitleHeight] = useState(0)
  const state = useTemplateVideoCardState({
    activeFilterCategory,
    aspectRatio,
    effectivePreviewMode,
    onClickInitialIndex,
    project,
    template,
  })
  const {
    handleCardClick: handleCardClickBase,
    isProcessing,
    menuItems,
    overlayContent,
    progressPercentage,
    showOnProjectsPage,
    showProgress,
  } = state
  // Mute the video element immediately so no audio bleeds while navigating away.
  const handleCardClick = useRefCallback(() => {
    videoRef.current?.setMuted(true)
    handleCardClickBase()
  })
  const isTemplateGalleryCard = showOnProjectsPage === false
  const displayTitle = getTemplateDisplayTitle(template)
  const primaryIndustry = getTemplateDisplayIndustry(template)
  const showPersistentIndustry = isTemplateGalleryCard && Boolean(primaryIndustry)
  const industryLiftOffset = hoverTitleHeight > 0 ? hoverTitleHeight + 12 : 0
  // Eager-autoplay (mobile or desktop): video mounts automatically on viewport
  // entry via resolveVideoMountCondition's isEagerMode branch.
  // Lazy-hover on mobile never mounts the video, so mobile makes zero .mp4
  // requests.
  const showHoverVideoPreview = !isMobile && hasEverPreviewed
  const isPlaybackActive = (hovered && !isMobile) || isMobileAutoplay
  // videoAllowedToSurface controls when the crossfade can reveal the video on
  // top of the poster. Eager-autoplay surfaces as soon as metadata loads;
  // eager-hover still waits for hover (otherwise a paused, frozen first frame
  // would sit on top of the poster); lazy-hover is unchanged.
  const videoAllowedToSurface = effectivePreviewMode === 'eager-autoplay' || showHoverVideoPreview
  const shouldHidePreviewCover = videoAllowedToSurface && hoverPreviewVisible
  const storyModeCardBadge = getTemplateCardBadgeLabel(template)
  const showBadge = showInputTypeBadge && Boolean(storyModeCardBadge)

  const measureHoverTitleHeight = () => {
    const titleNode = hoverTitleRef.current
    if (!titleNode) {
      return
    }
    const nextHeight = Math.ceil(titleNode.getBoundingClientRect().height)
    setHoverTitleHeight((prevHeight) => {
      return prevHeight === nextHeight ? prevHeight : nextHeight
    })
  }

  // 4d: Playback driven by hover, for lazy-hover and eager-hover only.
  // Autoplay has its own visibility-driven effect below (step 5) and must
  // not reuse hasEverPreviewed -- that flag's else-if branch would pause the
  // video on every non-hover render.
  useEffect(() => {
    if (effectivePreviewMode === 'eager-autoplay') {
      return
    }
    if (isPlaybackActive) {
      setHasEverPreviewed(true)
      // Drop the hoverPreviewReady gate: the browser will start playback as
      // soon as it has enough data. Waiting for loadedmetadata meant the
      // first hover silently did nothing if metadata wasn't back yet.
      playVideoRef(videoRef.current)
    } else if (hasEverPreviewed && !isMobile) {
      // Desktop hover-out pauses. Mobile playback once started is sticky --
      // the user explicitly tapped to start; we let it continue, and they
      // open the project (card tap) when they want to leave.
      videoRef.current?.setMuted(true)
      videoRef.current?.pause()
    }
  }, [effectivePreviewMode, isPlaybackActive, isMobile, hasEverPreviewed])

  useEffect(() => {
    setHoverPreviewReady(false)
    setHasEverPreviewed(false)
  }, [template.resultVideo])

  // 4b: Only lazy-hover tears the <video> element down; only it should
  // reset readiness. Eager modes keep the element mounted for the card's
  // lifetime, so loadedmetadata fires exactly once and we must not clobber
  // the resulting `true` by resetting here.
  useEffect(() => {
    if (effectivePreviewMode !== 'lazy-hover') {
      return
    }
    if (!showHoverVideoPreview) {
      setHoverPreviewReady(false)
    }
  }, [effectivePreviewMode, showHoverVideoPreview])

  // 4c: Crossfade the video in once it's both ready and allowed to surface.
  // Lazy-hover is the only mode that can transition back to hidden (before
  // first hover). Eager modes, once surfaced, stay surfaced.
  useEffect(() => {
    if (!videoAllowedToSurface || !hoverPreviewReady) {
      if (effectivePreviewMode === 'lazy-hover' && !hasEverPreviewed) {
        setHoverPreviewVisible(false)
      }
      return
    }

    const timeoutId = window.setTimeout(() => {
      setHoverPreviewVisible(true)
    }, HOVER_PREVIEW_CROSSFADE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [videoAllowedToSurface, hoverPreviewReady, hasEverPreviewed, effectivePreviewMode])

  // Step 5a: Eager-autoplay -- kick off playback once the video element is
  // mounted AND the card is in the viewport. Deps include videoMounted (not
  // hoverPreviewReady) to break a deadlock on initial page load: with
  // preload='none', metadata only loads after play(), so gating on
  // hoverPreviewReady is circular. The deadlock scenario: both the
  // VisibilityComponent IO (2400px) and the playback IO below (200px) fire
  // in the same React batch on page load; play() from the IO callback is a
  // no-op because the video element hasn't rendered yet; React then mounts
  // it but no dep changes trigger a retry. videoMounted changes when the
  // video element first renders, re-running this effect so play() succeeds.
  useEffect(() => {
    if (effectivePreviewMode !== 'eager-autoplay') {
      return
    }
    if (isInViewport && videoRef.current) {
      playVideoRef(videoRef.current)
    }
  }, [effectivePreviewMode, isInViewport, videoMounted])

  // Step 5a follow-through: when the video element mounts while the card is
  // already in the viewport (deadlock case: Step 5b fired before mount and
  // no-oped on null ref), call play() directly instead of waiting for the
  // setVideoMounted -> re-render -> Step 5a chain, which is timing-sensitive
  // under React 18 batching. isInViewport is a dep so the callback always
  // closes over the latest value; re-creating it on viewport transitions is
  // safe because it is not inside a stale-closure IO callback.
  const handleVideoMount = useCallback(() => {
    setVideoMounted(true)
    if (effectivePreviewMode === 'eager-autoplay' && isInViewport) {
      playVideoRef(videoRef.current)
    }
  }, [effectivePreviewMode, isInViewport])

  // Step 5b: Eager-autoplay -- toggle play/pause on viewport transitions
  // after first mount. Do NOT unmount (that would lose hoverPreviewVisible
  // and cause a black flash on scroll re-entry). On viewport exit we force
  // mute before pausing so a stale unmuted state can't leak audio from an
  // off-screen card if playback ever resumes. The isInViewport state feeds
  // the eager-autoplay play() retries above.
  useEffect(() => {
    if (effectivePreviewMode !== 'eager-autoplay') {
      return
    }
    const cardNode = cardRootRef.current
    if (!cardNode || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInViewport(true)
            videoRef.current?.setMuted(true)
            playVideoRef(videoRef.current)
          } else {
            setIsInViewport(false)
            videoRef.current?.setMuted(true)
            videoRef.current?.pause()
          }
        }
      },
      { rootMargin: '0px 0px 200px 0px', threshold: 0 },
    )
    observer.observe(cardNode)
    return () => {
      observer.disconnect()
    }
  }, [effectivePreviewMode])

  return (
    <div
      className={cn(
        // @container enables container-query-driven layout for the action
        // footer (stack vs side-by-side) based on the rendered card width
        // instead of viewport width -- justified-row gallery widths are a
        // continuum, not a discrete breakpoint set.
        'relative overflow-hidden rounded-xl p-3 cursor-pointer touch-manipulation @container',
        ASPECT_RATIO_CLASS[aspectRatio],
        showOnProjectsPage && 'group',
      )}
      onClick={handleCardClick}
      onMouseEnter={() => {
        measureHoverTitleHeight()
        setHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
      ref={cardRootRef}
      // The @container class sets container-type: inline-size; this inline
      // style overrides to 'size' so [@container(aspect-ratio>=1)] queries work.
      // Both are required: removing either silently breaks aspect-ratio queries.
      style={{ containerType: 'size' }}
    >
      <TemplateVideoCardMediaLayer
        effectivePreviewMode={effectivePreviewMode}
        isProcessing={isProcessing}
        onHoverPreviewReady={() => setHoverPreviewReady(true)}
        onVideoMount={handleVideoMount}
        overlayContent={overlayContent}
        progressPercentage={progressPercentage}
        shouldHidePreviewCover={shouldHidePreviewCover}
        showBadge={showBadge}
        showHoverVideoPreview={showHoverVideoPreview}
        showProgress={showProgress}
        storyModeCardBadge={storyModeCardBadge}
        template={template}
        videoRef={videoRef}
      />

      {showOnProjectsPage && menuItems.length > 0 && (
        <div
          className={cn(
            'absolute right-2 top-2 z-50 transition-opacity duration-200',
            isProcessing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <Popover
            align="start"
            className="bg-menu/80 shadow-none backdrop-blur-2xl w-[256px] rounded-2xl border-0 p-0"
            content={
              <ContextMenuItems
                itemClassName="h-[42px] px-[10px] hover:bg-white/10 rounded-sm text-sm font-medium leading-[17px]"
                items={menuItems}
              />
            }
            side="bottom"
            sideOffset={4}
          >
            <Button
              className="size-6 rounded-full border-0 bg-black/40 p-0 text-white backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white"
              size="sm"
              type="button"
              variant="ghost"
            >
              <OptionIcon className="size-4" />
            </Button>
          </Popover>
        </div>
      )}

      <TemplateVideoCardDefaultOverlay
        activeFilterCategory={activeFilterCategory}
        displayTitle={displayTitle}
        hovered={hovered}
        project={project}
        showOnProjectsPage={showOnProjectsPage}
        template={template}
      />
      <TemplateVideoCardHoverOverlay
        activeFilterCategory={activeFilterCategory}
        displayTitle={displayTitle}
        hovered={hovered}
        hoverTitleRef={hoverTitleRef}
        isTemplateGalleryCard={isTemplateGalleryCard}
        project={project}
        showOnProjectsPage={showOnProjectsPage}
        template={template}
      />
      {showPersistentIndustry && (
        <motion.div
          animate={{ y: hovered ? -industryLiftOffset : 0 }}
          className="hidden @[120px]:block pointer-events-none absolute left-3 bottom-3 z-20 max-w-[calc(100%-24px)]"
          initial={false}
          transition={{ duration: HOVER_ANIMATION_DURATION, ease: 'easeOut' }}
        >
          <motion.div
            animate={{
              // Fade out text shadow on hover to reduce backdrop-filter compositing artifacts around text.
              textShadow: hovered
                ? '0px 4px 10px rgba(0, 0, 0, 0)'
                : '0px 4px 10px rgba(0, 0, 0, 0.25)',
            }}
            className="truncate justify-start text-white text-sm font-medium leading-[17px] opacity-60"
            initial={false}
            transition={{ duration: HOVER_ANIMATION_DURATION, ease: 'easeOut' }}
          >
            {primaryIndustry}
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}

export const TemplateVideoCard = React.memo(TemplateVideoCardImpl)

TemplateVideoCard.displayName = 'TemplateVideoCard'
