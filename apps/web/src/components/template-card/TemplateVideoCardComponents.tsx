import { Project } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { Badge, cn } from '@shared/ui'
import { motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import React, { useEffect } from 'react'

import { VideoWithSkeleton } from '@/app/home/components/VideoWithSkeleton'
import { ProjectBgParams } from '@/app/projects/[projectId]/constants/shader-gradient'
import { CrossCircle, Info } from '@/components/icons/core'
import { VideoPlayerRef } from '@/components/VideoPlayer'
import VisibilityComponent from '@/components/VisibilityComponent'
import { formatDate } from '@/util/date-format'

import { VideoFilterCategory } from '../navigation/consts'

const ShaderGradientBackground = dynamic(
  () => import('@/components/animated/ShaderGradientBackground'),
  { ssr: false },
)

import {
  failedTextStyle,
  HOVER_ANIMATION_DURATION,
  inProgressTextStyle,
  OverlayContent,
  percentageStyle,
  type PreviewMode,
  resolvePreviewModeBehavior,
  resolveVideoMountCondition,
  resolveVideoUrl,
  STORY_MODE_HOVER_GLASS_GRADIENT_STYLE,
  STORY_MODE_RESTING_GLASS_BLUR_STYLE,
  STORY_MODE_RESTING_GLASS_GRADIENT_STYLE,
  TemplateVideoCardProps,
} from './template-video-card-constants'

export function StoryModeCardRemixGlyph({
  className = 'size-[18px] shrink-0',
}: {
  className?: string
} = {}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 19.6866 19.9999"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.56548 14.1688C2.81118 13.9434 3.18889 13.9434 3.43462 14.1688C3.57162 14.2947 3.677 14.6853 3.88774 15.4647C3.92796 15.6134 3.94847 15.6879 3.98247 15.7518C4.04253 15.8647 4.13521 15.9573 4.24809 16.0174C4.31203 16.0514 4.38657 16.072 4.5352 16.1122C5.31452 16.3229 5.70519 16.4283 5.8311 16.5653C6.05657 16.811 6.05657 17.1887 5.8311 17.4344C5.70504 17.5713 5.31425 17.6769 4.5352 17.8876C4.38661 17.9277 4.31202 17.9483 4.24809 17.9823C4.13526 18.0424 4.04251 18.135 3.98247 18.2479C3.94853 18.3118 3.92792 18.3864 3.88774 18.535C3.67703 19.3143 3.5716 19.7051 3.43462 19.8309C3.18889 20.0562 2.81114 20.0563 2.56548 19.8309C2.42851 19.705 2.32305 19.3143 2.11235 18.535C2.07213 18.3863 2.05163 18.3119 2.01763 18.2479C1.95754 18.135 1.86494 18.0424 1.752 17.9823C1.68807 17.9483 1.61355 17.9278 1.46489 17.8876C0.685607 17.6768 0.294849 17.5714 0.168992 17.4344C-0.056375 17.1888 -0.0562865 16.811 0.168992 16.5653C0.294845 16.4283 0.685652 16.3229 1.46489 16.1122C1.61347 16.072 1.68809 16.0514 1.752 16.0174C1.86487 15.9574 1.95753 15.8647 2.01763 15.7518C2.05162 15.6879 2.07216 15.6133 2.11235 15.4647C2.32299 14.6857 2.42858 14.2949 2.56548 14.1688Z"
        fill="currentColor"
      />
      <path
        d="M8.31938 3.94322C8.87158 3.94325 9.54749 4.00014 10.3682 4.06724L14.2559 4.38463C15.0765 4.45172 15.7521 4.50592 16.2969 4.59556C16.8533 4.68712 17.3608 4.82726 17.8243 5.11314C18.5429 5.55659 19.103 6.21681 19.4239 6.99791C19.6308 7.50175 19.6866 8.02577 19.6866 8.5897C19.6865 9.14179 19.6306 9.81712 19.5635 10.6376L19.2461 14.5253C19.1791 15.3458 19.1248 16.0215 19.0352 16.5663C18.9436 17.1227 18.8026 17.6301 18.5166 18.0936C18.0731 18.8124 17.4131 19.3733 16.6319 19.6942C16.1282 19.9009 15.6048 19.9569 15.0411 19.9569C14.4889 19.9569 13.8129 19.9 12.9922 19.8329L8.19048 19.4403C7.64016 19.3952 7.23044 18.9125 7.27544 18.3622C7.32056 17.8119 7.80331 17.4023 8.35356 17.4471L13.1553 17.8397C14.0089 17.9095 14.5895 17.9569 15.0411 17.9569C15.4807 17.9569 15.7098 17.9102 15.8721 17.8436C16.2626 17.6832 16.5927 17.4031 16.8145 17.0438C16.9066 16.8945 16.9902 16.6759 17.0616 16.242C17.1349 15.7965 17.1822 15.2157 17.252 14.3622L17.5704 10.4745C17.6401 9.6213 17.6875 9.04113 17.6875 8.5897C17.6876 8.14983 17.6409 7.92005 17.5743 7.75767C17.4139 7.36737 17.1335 7.03797 16.7745 6.81627C16.6251 6.7241 16.4058 6.64062 15.9717 6.5692C15.5262 6.49592 14.9461 6.44756 14.0928 6.37779L10.2051 6.06041C9.35197 5.99065 8.7718 5.94329 8.32036 5.94322C7.88048 5.94319 7.6507 5.98982 7.48833 6.0565C7.09779 6.21694 6.76767 6.49699 6.54595 6.85631C6.45381 7.00564 6.37126 7.22431 6.29985 7.65806C6.22654 8.10361 6.17823 8.6844 6.10845 9.53795L5.877 12.3651C5.83181 12.9154 5.3492 13.3251 4.79888 13.2801C4.24872 13.235 3.83905 12.7522 3.88384 12.202L4.11528 9.37486C4.18237 8.55429 4.23659 7.87867 4.32622 7.33384C4.41777 6.77754 4.55794 6.26995 4.8438 5.8065C5.28731 5.08775 5.94731 4.52679 6.72856 4.20591C7.23226 3.99909 7.75564 3.94322 8.31938 3.94322Z"
        fill="currentColor"
      />
      <path
        d="M11.462 0.00181343C12.0255 0.0133819 12.5476 0.0806084 13.0469 0.297712C13.8212 0.634534 14.4699 1.20788 14.8985 1.93541C15.0328 2.16358 15.1319 2.40184 15.2081 2.65025L14.46 2.59849C13.8304 2.55494 13.2847 2.51673 12.8145 2.50377C12.6493 2.34962 12.4587 2.22292 12.2491 2.1317C12.0881 2.06176 11.8594 2.01081 11.42 2.00181C10.9687 1.99263 10.3875 2.02769 9.53325 2.07994L5.6397 2.31822C4.78515 2.37049 4.20377 2.40642 3.75688 2.47056C3.32164 2.53307 3.10146 2.61197 2.95024 2.70103C2.58661 2.91533 2.29929 3.23879 2.13091 3.62584C2.06098 3.78677 2.01002 4.01551 2.00102 4.45494C1.99183 4.90632 2.02688 5.48809 2.07915 6.34263L2.37309 11.1522C2.40626 11.7029 1.98723 12.1768 1.43657 12.2108C0.885628 12.2445 0.411197 11.8251 0.377 11.2743L0.0830548 6.4647C0.0327939 5.64295 -0.00925457 4.96595 0.00200011 4.41392C0.0135332 3.85036 0.0799408 3.32826 0.296922 2.82896C0.633671 2.0546 1.20712 1.40609 1.93462 0.977399C2.40391 0.700973 2.91451 0.571225 3.4727 0.491071C4.01923 0.412617 4.69587 0.37141 5.51763 0.321149L9.41118 0.0838447C10.2329 0.0335831 10.91 -0.00946781 11.462 0.00181343Z"
        fill="currentColor"
      />
    </svg>
  )
}

const SpinnerIcon = (
  <div className="size-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent text-white" />
)

export function computeOverlayContent(
  showOnProjectsPage: boolean,
  project: Project | undefined,
  flags: {
    isLongTakeInProcess: boolean
    showProcessingWithoutProgress: boolean
    showProgress: boolean
  },
): OverlayContent {
  if (!showOnProjectsPage || !project) {
    return null
  }
  if (project.stage === PROJECT_STAGE.CANCELED) {
    return {
      label: 'Canceled',
      subtext: 'Project canceled',
      icon: <CrossCircle className="size-6" style={{ color: 'var(--Status-error, #CF4020)' }} />,
      subtextStyle: failedTextStyle,
    }
  }
  if (project.stage === PROJECT_STAGE.FAILED) {
    return {
      label: 'Failed',
      subtext: 'Project failed',
      icon: <Info className="size-6" style={{ color: 'var(--Status-error, #CF4020)' }} />,
      subtextStyle: failedTextStyle,
    }
  }
  if (project.stage === PROJECT_STAGE.INITIALIZING) {
    return {
      label: 'Initializing',
      icon: SpinnerIcon,
      subtext: 'Preparing your video plan...',
      subtextStyle: inProgressTextStyle,
    }
  }
  if (flags.isLongTakeInProcess) {
    return {
      label: 'Processing',
      icon: SpinnerIcon,
      subtext: 'Preparing your video plan...',
      subtextStyle: inProgressTextStyle,
    }
  }
  if (flags.showProgress) {
    return {
      label: 'Processing',
      icon: SpinnerIcon,
      subtext: 'Preparing your video plan...',
      subtextStyle: inProgressTextStyle,
      showPercentage: true,
    }
  }
  if (flags.showProcessingWithoutProgress) {
    return {
      label: 'Processing',
      icon: SpinnerIcon,
      subtext: 'Preparing your video plan...',
      subtextStyle: inProgressTextStyle,
    }
  }
  return null
}

export function ProcessingMask({
  overlayContent,
  progressPercentage,
  showProgress,
}: {
  overlayContent: null | {
    icon?: React.ReactNode
    label: string
    showPercentage?: boolean
    subtext?: string
    subtextClassName?: string
    subtextStyle?: React.CSSProperties
  }
  progressPercentage: number
  showProgress: boolean
}) {
  if (!overlayContent) {
    return null
  }
  const { label, subtext, icon, showPercentage, subtextStyle } = overlayContent
  const showPill = !icon
  const percentage = showProgress ? progressPercentage : 0
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-y-2 px-4">
      {icon}
      {showPill && (
        <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">{label}</div>
      )}
      {subtext && <p style={subtextStyle}>{subtext}</p>}
      {showPercentage && <span style={percentageStyle}>{percentage}%</span>}
    </div>
  )
}

export function TemplateVideoCardDefaultOverlay({
  activeFilterCategory,
  displayTitle,
  hovered,
  project,
  showOnProjectsPage,
  template,
}: {
  activeFilterCategory?: VideoFilterCategory
  displayTitle: string
  hovered: boolean
  project?: Project
  showOnProjectsPage: boolean
  template: TemplateVideoCardProps['template']
}) {
  return (
    <motion.div
      animate={{
        opacity: hovered ? 0 : 1,
      }}
      className="absolute left-0 bottom-0 z-20 flex h-[140px] w-full flex-col items-start justify-end gap-3 p-3"
      initial={{ opacity: 1 }}
      style={{
        background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 64%, rgba(0, 0, 0, 0.60) 100%)',
      }}
      transition={{ duration: HOVER_ANIMATION_DURATION, ease: 'easeOut' }}
    >
      {showOnProjectsPage && (
        <div className="flex w-full items-start justify-between">
          {activeFilterCategory === 'goal' && template.goals?.[0] && (
            <div
              className="flex flex-col justify-end text-right text-sm font-medium leading-[17px] text-white opacity-60"
              style={{
                textShadow: '0px 4px 10px rgba(0, 0, 0, 0.25)',
              }}
            >
              {template.goals[0]}
            </div>
          )}
          {activeFilterCategory === 'industry' && template.industries?.[0] && (
            <div
              className="flex flex-col justify-end text-right text-sm font-medium leading-[17px] text-white opacity-60"
              style={{
                textShadow: '0px 4px 10px rgba(0, 0, 0, 0.25)',
              }}
            >
              {template.industries[0]}
            </div>
          )}
        </div>
      )}
      {showOnProjectsPage && (
        <div className="self-stretch line-clamp-2 justify-end text-base font-medium leading-5 text-white">
          {displayTitle}
        </div>
      )}

      {showOnProjectsPage && project?.createdAt && (
        <div
          className="justify-start text-sm font-medium leading-4 text-white opacity-60"
          style={{
            textShadow: '0px 4px 10px rgba(0, 0, 0, 0.25)',
          }}
        >
          {formatDate(project.createdAt, 'MMM d, yyyy')}
        </div>
      )}
    </motion.div>
  )
}

export function TemplateVideoCardHoverOverlay({
  activeFilterCategory,
  displayTitle,
  hovered,
  hoverTitleRef,
  isTemplateGalleryCard,
  project,
  showOnProjectsPage,
  template,
}: {
  activeFilterCategory?: VideoFilterCategory
  displayTitle: string
  hovered: boolean
  hoverTitleRef: React.RefObject<HTMLDivElement | null>
  isTemplateGalleryCard: boolean
  project?: Project
  showOnProjectsPage: boolean
  template: TemplateVideoCardProps['template']
}) {
  return (
    <>
      {isTemplateGalleryCard && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-px -bottom-px z-20 h-[calc(140px+1px)] overflow-hidden"
        >
          <div className="absolute inset-0" style={STORY_MODE_RESTING_GLASS_BLUR_STYLE} />
          <div className="absolute inset-0" style={STORY_MODE_RESTING_GLASS_GRADIENT_STYLE} />
        </div>
      )}
      <motion.div
        animate={{
          opacity: hovered ? 1 : 0,
        }}
        className="absolute -inset-x-px -bottom-px z-20 overflow-hidden h-[calc(140px+1px)]"
        initial={{ opacity: 0 }}
        transition={{ duration: HOVER_ANIMATION_DURATION, ease: 'easeOut' }}
      >
        {isTemplateGalleryCard && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0" style={STORY_MODE_HOVER_GLASS_GRADIENT_STYLE} />
          </div>
        )}
        <div className="relative z-10 flex h-full flex-col items-start justify-end gap-3 p-3">
          {showOnProjectsPage && (
            <div className="inline-flex self-stretch items-start justify-between">
              {((activeFilterCategory === 'goal' && template.goals?.[0]) ||
                (activeFilterCategory === 'industry' && template.industries?.[0])) && (
                <div className="truncate justify-end text-right text-sm font-medium leading-4 text-white opacity-60">
                  {activeFilterCategory === 'goal' ? template.goals?.[0] : template.industries?.[0]}
                </div>
              )}
            </div>
          )}
          <div
            className="self-stretch line-clamp-2 justify-end text-base font-medium leading-5 text-white"
            ref={hoverTitleRef}
          >
            {displayTitle}
          </div>
          {showOnProjectsPage && project?.createdAt && (
            <div className="justify-start text-sm font-medium leading-4 text-white opacity-60">
              {formatDate(project.createdAt, 'MMM d, yyyy')}
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
}

// Fires onMount on first render. Used to notify the parent when the video
// element mounts so an eager-autoplay retry can be triggered.
export function TemplateVideoCardMediaLayer({
  effectivePreviewMode,
  isProcessing,
  onHoverPreviewReady,
  onVideoMount,
  overlayContent,
  progressPercentage,
  shouldHidePreviewCover,
  showBadge,
  showHoverVideoPreview,
  showProgress,
  storyModeCardBadge,
  template,
  videoRef,
}: {
  effectivePreviewMode: PreviewMode
  isProcessing: boolean
  onHoverPreviewReady: () => void
  onVideoMount?: () => void
  overlayContent: OverlayContent
  progressPercentage: number
  shouldHidePreviewCover: boolean
  showBadge: boolean
  showHoverVideoPreview: boolean
  showProgress: boolean
  storyModeCardBadge: null | string
  template: TemplateVideoCardProps['template']
  videoRef: React.RefObject<null | VideoPlayerRef>
}) {
  // Mount the <video> element as soon as the card enters the viewport for
  // eager modes; for lazy-hover keep the pre-existing behaviour of waiting
  // until the first hover (showHoverVideoPreview). eager-autoplay is allowed
  // on mobile (quick-start gallery); eager-hover still degrades to lazy-hover
  // on mobile via deriveEffectivePreviewMode.
  //
  // Large rootMargin to keep most videos mounted. In a gallery of 33 cards, users will
  // not experience memory overflow, but will experience rendering latency from remounts.
  //
  // 2400px top: 4 screen lengths of iPhone SE, 3 screen lengths of iPhone 14+
  const {
    isEagerMode,
    preload: preloadValue,
    shouldAutoPlay,
  } = resolvePreviewModeBehavior(effectivePreviewMode)
  return (
    <VisibilityComponent
      className="absolute inset-0 size-full"
      debounceMs={0}
      rootMargin="2400px 0px 2400px 0px"
      threshold={0.01}
      toggle={!isEagerMode}
    >
      {(visible) => {
        const hasPreviewVideo = Boolean(template.previewVideo)
        const shouldMountVideo = resolveVideoMountCondition({
          hasPreviewVideo,
          isEagerMode,
          showHoverVideoPreview,
          visible,
        })
        const videoUrl = resolveVideoUrl({
          isEagerMode,
          previewVideo: template.previewVideo ?? undefined,
          resultVideo: template.resultVideo ?? undefined,
        })
        return (
          <div className="relative size-full flex flex-col bg-[#2a2a2a]">
            {visible && (
              <>
                {shouldMountVideo && (
                  <>
                    <VideoMountEffect onMount={onVideoMount} />
                    <VideoWithSkeleton
                      autoPlay={shouldAutoPlay}
                      fallbackVideoUrl={isEagerMode ? undefined : template.resultVideo}
                      loop
                      muted
                      onLoadedMetadata={onHoverPreviewReady}
                      playWithHoverAction={false}
                      primitiveVideoPlayerProps={{
                        // Native attrs only. `muted` is now a top-level prop so
                        // a later caller can't silently override it via spread.
                        playsInline: true,
                        preload: preloadValue,
                        ...(template.thumbnail ? { poster: template.thumbnail } : {}),
                      }}
                      showHoverPlayButton={false}
                      videoPlayerRef={videoRef}
                      videoUrl={videoUrl}
                    />
                  </>
                )}
                {template.thumbnail ? (
                  <Image
                    alt="thumb"
                    className={cn(
                      'pointer-events-none transition-opacity duration-200 ease-out',
                      shouldHidePreviewCover ? 'opacity-0' : 'opacity-100',
                    )}
                    fill
                    src={template.thumbnail}
                  />
                ) : (
                  <div
                    className={cn(
                      'pointer-events-none absolute inset-0 bg-tertiary transition-opacity duration-200 ease-out',
                      shouldHidePreviewCover ? 'opacity-0' : 'opacity-100',
                    )}
                  />
                )}
              </>
            )}
            <div
              className={cn(
                'absolute inset-0 w-auto bg-tertiary animate-pulse',
                visible && 'hidden',
              )}
            />
            {isProcessing && (
              <ShaderGradientBackground
                className="absolute inset-0 z-[5] pointer-events-none overflow-hidden"
                gradientProps={ProjectBgParams}
              />
            )}
            <ProcessingMask
              overlayContent={overlayContent}
              progressPercentage={progressPercentage}
              showProgress={showProgress}
            />

            {showBadge && storyModeCardBadge && (
              // Hide on narrow cards; container query on card root.
              <div className="hidden @[120px]:flex absolute top-3 left-3 z-30 max-w-[calc(100%-24px)] items-start gap-0.5">
                <Badge
                  className={cn(
                    // Hover pinned to the resting fill: Badge's default variant
                    // carries hover:bg-primary/80, which flashes the chip light
                    // as the pointer crosses the poster. It is a label.
                    'h-5 min-w-0 bg-[rgba(0,0,0,0.10)] px-1.5 text-xs font-medium leading-[15px] text-white shadow-none backdrop-blur-2xl hover:bg-[rgba(0,0,0,0.10)]',
                    'rounded-md',
                  )}
                >
                  {/* Badge is inline-flex, so the ellipsis has to live on a real
                      block child -- a bare text node is an anonymous flex item and
                      text-overflow never applies to it, leaving a hard clip. */}
                  <span className="min-w-0 truncate">{storyModeCardBadge}</span>
                </Badge>
              </div>
            )}
          </div>
        )
      }}
    </VisibilityComponent>
  )
}

function VideoMountEffect({ onMount }: { onMount?: () => void }) {
  useEffect(() => {
    onMount?.()
  }, [])
  return null
}
