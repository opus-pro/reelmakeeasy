'use client'

import { cn } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AiGeneratingIcon } from '@/components/animated/AiGeneratingIcon'
import { ProgressHalfRing, Warning } from '@/components/icons/core'
import { getPublicCdnUrl } from '@/util/cdn-utils'

const DEFAULT_BG_1X_URL = getPublicCdnUrl('assets/notifications/bar/default-bg-36.png')
const DEFAULT_BG_2X_URL = getPublicCdnUrl('assets/notifications/bar/default-bg-72.png')
const DEFAULT_BG_3X_URL = getPublicCdnUrl('assets/notifications/bar/default-bg-108.png')
const DEFAULT_BG_4X_URL = getPublicCdnUrl('assets/notifications/bar/default-bg-144.png')

const DEFAULT_THUMBNAIL_SRCSET = [
  `${DEFAULT_BG_1X_URL} 1x`,
  `${DEFAULT_BG_2X_URL} 2x`,
  `${DEFAULT_BG_3X_URL} 3x`,
  `${DEFAULT_BG_4X_URL} 4x`,
].join(', ')

const COLLAPSED_MAX_WIDTH_PX = 232
const COLLAPSED_MIN_WIDTH_PX = 180

export type OngoingProjectsNotificationItem = {
  href: string
  id: string
  // A 'bgm' row reports a per-project background job
  // instead of the project itself, so the same project can appear
  // twice: its own row plus the job running on it. Absent reads as 'project'.
  kind?: OngoingProjectsNotificationItemKind
  // Raw project id, when the row belongs to one. Lets rows about the same
  // project be correlated across kinds.
  projectId?: string
  status: OngoingProjectsNotificationStatus
  subtitle: string
  thumbnail?: OngoingProjectsNotificationThumbnail
  title: string
}

export type OngoingProjectsNotificationItemKind = 'bgm' | 'project'

export type OngoingProjectsNotificationStatus = 'error' | 'generating' | 'ready'

export type OngoingProjectsNotificationThumbnail = string | { src: string; srcSet?: string }

export type OngoingProjectsNotificationViewProps = {
  allTotal?: number
  animateGeneratingIcon?: boolean
  isConnected?: boolean
  isReconnecting?: boolean
  items: OngoingProjectsNotificationItem[]
  maxVisibleItems?: number
  ongoingTotal?: number
  onItemClick?: (item: OngoingProjectsNotificationItem) => void
  onMouseEnter?: () => void
  onReachBottom?: () => void
  onReconnect?: () => void
  onSeeAllClick?: () => void
}

export function OngoingProjectsNotificationView({
  allTotal,
  isConnected = true,
  isReconnecting = false,
  items,
  maxVisibleItems,
  onItemClick,
  onMouseEnter,
  ongoingTotal,
  onReconnect,
  onReachBottom,
  onSeeAllClick,
  animateGeneratingIcon = false,
}: OngoingProjectsNotificationViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const isConnectedForUi = isConnected || isReconnecting

  const showExpanded = isHovered && isConnectedForUi

  const collapsedState = useMemo(() => {
    const collapsedPreviewItem = items[0]
    let countLabel = `${items.length}/${items.length}`
    let isGenerating = false
    let title: string

    const generatingTitle = 'Generating...'

    const normalizedAllTotal = Math.max(0, allTotal ?? 0)
    const normalizedOngoingTotal = Math.max(
      0,
      Math.min(Math.max(0, ongoingTotal ?? 0), normalizedAllTotal),
    )

    if (allTotal !== undefined && ongoingTotal !== undefined) {
      if (normalizedAllTotal === 0) {
        countLabel = '0'
        isGenerating = false
        title = 'Project updates'
      } else {
        isGenerating = normalizedOngoingTotal > 0
        countLabel = `${normalizedAllTotal - normalizedOngoingTotal}/${normalizedAllTotal}`
        title = isGenerating ? generatingTitle : 'Projects ready'
      }
    } else {
      const generatingCount = items.filter((item) => item.status === 'generating').length
      if (items.length === 0) {
        title = 'Project updates'
      } else if (generatingCount > 0) {
        isGenerating = true
        countLabel = `${items.length - generatingCount}/${items.length}`
        title = generatingTitle
      } else {
        title = 'Projects ready'
      }
    }

    const isError = !isGenerating && collapsedPreviewItem?.status === 'error'
    return {
      countLabel,
      isGenerating,
      // Badge title is an aggregate summary across all projects, not per-item.
      // Fall back to the neutral 'Project updates' label when the rolled-up
      // state includes errors, instead of the misleading 'Projects ready'.
      title: isError ? 'Project updates' : title,
      isError,
      // The tile carries a thumbnail in every state -- the
      // generating/error icon overlays it, exactly like the dropdown rows.
      // Dropping the image while generating left the badge a flat gray square
      // for the whole stretch it is actually on screen. The badge summarises
      // every project rather than one, so it takes the topmost thumbnail that
      // exists instead of insisting on the top item's: any real frame beats
      // the gray default.
      thumbnail: items.find((item) => hasUsableThumbnail(item.thumbnail))?.thumbnail,
    }
  }, [allTotal, items, ongoingTotal])

  const { expandedHeight, listMaxHeight } = useMemo(() => {
    const headerHeight = 38
    const panelPadding = 12
    const headerToListGap = 6
    const listItemHeight = 52
    const listGap = 4

    const visibleCount =
      maxVisibleItems === undefined ? items.length : Math.min(items.length, maxVisibleItems)
    const listH = visibleCount * listItemHeight + (visibleCount - 1) * listGap

    return {
      expandedHeight: panelPadding + headerHeight + headerToListGap + listH,
      listMaxHeight:
        maxVisibleItems !== undefined && items.length > maxVisibleItems ? listH : undefined,
    }
  }, [items.length, maxVisibleItems])

  const [viewportListMaxHeight, setViewportListMaxHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const update = () => {
      const panelPaddingTop = 6
      const headerHeight = 38
      const listMarginTop = 6
      const panelPaddingBottom = 6
      const bottomMargin = 24
      const rect = el.getBoundingClientRect()
      const maxBottom = window.innerHeight - bottomMargin

      const available =
        maxBottom - rect.top - panelPaddingTop - headerHeight - listMarginTop - panelPaddingBottom
      setViewportListMaxHeight(Math.max(0, available))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const effectiveListMaxHeight = useMemo(() => {
    if (listMaxHeight === undefined && viewportListMaxHeight === undefined) {
      return undefined
    }
    return Math.min(listMaxHeight ?? Infinity, viewportListMaxHeight ?? Infinity)
  }, [listMaxHeight, viewportListMaxHeight])

  const handleSeeAllClick = () => {
    onSeeAllClick?.()
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        setIsHovered(true)
        onMouseEnter?.()
      }}
      onMouseLeave={() => setIsHovered(false)}
      ref={containerRef}
    >
      <CollapsedMenuButton
        animateGeneratingIcon={animateGeneratingIcon}
        countLabel={collapsedState.countLabel}
        expandedHeight={expandedHeight}
        isConnected={isConnected}
        isError={collapsedState.isError}
        isGenerating={collapsedState.isGenerating}
        isReconnecting={isReconnecting}
        onReconnect={onReconnect}
        thumbnail={collapsedState.thumbnail}
        title={collapsedState.title}
        visible={!showExpanded}
      />

      <div
        className={cn(
          'absolute right-0 top-0 origin-top-right w-[232px] rounded-[16px] bg-[rgba(68,68,68,0.5)] p-[6px] backdrop-blur-2xl',
          'transition-all duration-150 ease-out',
          showExpanded
            ? 'opacity-100 scale-100 translate-x-0 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-90 translate-x-2 -translate-y-1 pointer-events-none',
        )}
        data-testid="ongoing-projects-panel"
      >
        <div className="flex h-[38px] w-[220px] items-center justify-center gap-[6px] rounded-[10px] px-[8px]">
          <div className="flex min-w-0 flex-1 items-center justify-center px-[2px]">
            <p className="text-primary min-w-0 flex-1 text-[14px] font-medium leading-[17px]">
              Activity
            </p>
          </div>
          <button
            aria-label="See all projects"
            className="text-secondary shrink-0 select-none whitespace-nowrap text-[14px] font-medium leading-[17px] transition-opacity hover:opacity-80"
            onClick={handleSeeAllClick}
            type="button"
          >
            See all projects
          </button>
        </div>
        <div
          className="mt-[6px] flex flex-col gap-[4px] overflow-x-hidden overflow-y-auto overscroll-contain"
          onScroll={
            onReachBottom
              ? (event) => {
                  const target = event.currentTarget
                  const distanceToBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight

                  if (distanceToBottom <= 16) {
                    onReachBottom()
                  }
                }
              : undefined
          }
          style={
            effectiveListMaxHeight === undefined ? undefined : { maxHeight: effectiveListMaxHeight }
          }
        >
          {items.map((item) => (
            <NotificationItem
              animateGeneratingIcon={animateGeneratingIcon}
              item={item}
              key={item.id}
              onItemClick={onItemClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** What the second line of a row says: a failed row replaces the mode label. */
export function resolveRowSubtitle(
  item: Pick<OngoingProjectsNotificationItem, 'status' | 'subtitle'>,
): string {
  if (item.status === 'error') {
    return 'Project failed'
  }
  return item.subtitle
}

function CollapsedMenuButton({
  countLabel,
  expandedHeight,
  isError,
  isConnected,
  isReconnecting,
  isGenerating,
  onReconnect,
  animateGeneratingIcon,
  thumbnail,
  title,
  visible,
}: {
  animateGeneratingIcon: boolean
  countLabel: string
  expandedHeight: number
  isConnected: boolean
  isError: boolean
  isGenerating: boolean
  isReconnecting: boolean
  onReconnect?: () => void
  thumbnail?: OngoingProjectsNotificationThumbnail
  title: string
  visible: boolean
}) {
  const isAnimatingOut = !visible
  const isConnectedForUi = isConnected || isReconnecting
  const showReconnectCta = !isConnected && !isReconnecting && !isAnimatingOut
  const measureRef = useRef<HTMLDivElement>(null)
  const [collapsedWidth, setCollapsedWidth] = useState(COLLAPSED_MIN_WIDTH_PX)

  useEffect(() => {
    const el = measureRef.current
    if (!el) {
      return
    }

    const measured = Math.ceil(el.getBoundingClientRect().width)
    if (Number.isNaN(measured)) {
      return
    }

    const clamped = Math.min(COLLAPSED_MAX_WIDTH_PX, Math.max(COLLAPSED_MIN_WIDTH_PX, measured))
    setCollapsedWidth((prev) => (prev === clamped ? prev : clamped))
  }, [countLabel, isAnimatingOut, showReconnectCta, title])

  const buttonStyle = isAnimatingOut
    ? {
        height: `${expandedHeight}px`,
        opacity: 0,
        width: `${COLLAPSED_MAX_WIDTH_PX}px`,
      }
    : {
        height: '38px',
        opacity: 1,
        width: `${collapsedWidth}px`,
      }

  return (
    <div
      className={cn(
        'relative ml-auto h-[38px] rounded-[10px] bg-[rgba(68,68,68,0.5)] backdrop-blur-2xl',
        isAnimatingOut && 'transition-[width,height,opacity] duration-150 ease-out',
        isAnimatingOut && 'pointer-events-none',
      )}
      data-testid="ongoing-projects-collapsed-pill"
      style={buttonStyle}
    >
      <div className="pointer-events-none absolute left-0 top-0 invisible">
        <div
          className={cn(
            'inline-flex h-[38px] items-center justify-center gap-[6px] pr-[8px]',
            showReconnectCta ? 'pl-[8px]' : 'pl-[48px]',
          )}
          ref={measureRef}
        >
          {showReconnectCta ? (
            <p className="text-primary whitespace-nowrap text-[14px] font-medium leading-[17px]">
              Click to refresh
            </p>
          ) : (
            <>
              <div className="flex items-center justify-center px-[2px]">
                <p className="text-primary whitespace-nowrap text-[14px] font-medium leading-[17px]">
                  {title}
                </p>
              </div>
              <p className="text-secondary whitespace-nowrap text-[14px] font-medium leading-[17px]">
                {countLabel}
              </p>
            </>
          )}
        </div>
      </div>

      <div
        className={cn(
          'flex h-full items-center justify-center gap-[6px] pr-[8px]',
          showReconnectCta ? 'pl-[8px]' : 'pl-[48px]',
        )}
      >
        {showReconnectCta ? (
          <p className="text-primary text-[14px] font-medium leading-[17px]">Click to refresh</p>
        ) : (
          <>
            <div className="flex min-w-0 flex-auto items-center justify-center px-[2px]">
              <p className="text-primary min-w-0 flex-auto truncate text-[14px] font-medium leading-[17px]">
                {title}
              </p>
            </div>
            <p className="text-secondary shrink-0 whitespace-nowrap text-[14px] font-medium leading-[17px]">
              {countLabel}
            </p>
          </>
        )}
      </div>

      {showReconnectCta ? (
        <button
          aria-label="Reconnect"
          className="absolute inset-0 cursor-pointer rounded-[10px] bg-white/20 backdrop-blur-sm"
          onClick={onReconnect}
          type="button"
        />
      ) : null}

      {isReconnecting && !isAnimatingOut ? (
        <div className="pointer-events-none absolute right-[-3px] top-[-3px] z-[1] flex size-[14px] items-center justify-center rounded-full bg-white/25 backdrop-blur-sm">
          <ProgressHalfRing className="size-[10px] animate-spin text-white" />
        </div>
      ) : null}

      <div
        className={cn(
          'absolute left-[7.81px] top-[-4.02px] flex size-[35.17px] items-center justify-center',
          showReconnectCta && 'hidden',
        )}
      >
        <div className="-rotate-6 flex-none">
          <div className="relative flex size-8 items-center justify-center overflow-hidden rounded-[6px] bg-[#727272]">
            <ThumbnailImage alt={title} className="size-full object-cover" thumbnail={thumbnail} />
            {isGenerating || isError ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rotate-6">
                  {isGenerating ? (
                    <AiGeneratingIcon
                      animate={animateGeneratingIcon && isConnectedForUi}
                      className="size-[18px] brightness-0 invert"
                    />
                  ) : (
                    <Warning className="size-[18px] text-white" />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function NotificationItem({
  item,
  onItemClick,
  animateGeneratingIcon,
}: {
  animateGeneratingIcon: boolean
  item: OngoingProjectsNotificationItem
  onItemClick?: (item: OngoingProjectsNotificationItem) => void
}) {
  const handleClick = () => {
    onItemClick?.(item)
  }

  const subtitle = resolveRowSubtitle(item)

  return (
    <button
      className="flex w-full select-none items-center gap-[6px] rounded-[10px] p-[8px] text-left transition-colors hover:bg-[rgba(255,255,255,0.18)]"
      onClick={handleClick}
      type="button"
    >
      <div className="relative size-9 shrink-0 overflow-hidden rounded-[4px] bg-white/10">
        <ThumbnailImage
          alt={item.title}
          className="size-full object-cover"
          thumbnail={item.thumbnail}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          {item.status === 'generating' ? (
            <AiGeneratingIcon
              animate={animateGeneratingIcon}
              className="size-[18px] brightness-0 invert"
            />
          ) : item.status === 'error' ? (
            <Warning className="size-[18px] text-white" />
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1 px-[2px]">
        <p className="text-primary truncate text-[14px] font-medium leading-[17px]">{item.title}</p>
        {/* A job row carries the project name here, which is as long
            as any title -- so the subtitle truncates the same way. */}
        <p className="text-secondary truncate text-[12px] font-normal leading-[19px]">{subtitle}</p>
      </div>
    </button>
  )
}

// Mirrors what resolveThumbnail below can actually paint: anything this
// rejects would land on the gray default, so it is not worth borrowing.
function hasUsableThumbnail(thumbnail: OngoingProjectsNotificationThumbnail | undefined): boolean {
  if (thumbnail === undefined) {
    return false
  }
  if (typeof thumbnail === 'string') {
    return thumbnail !== ''
  }
  return thumbnail.src !== '' || sanitizeSrcSet(thumbnail.srcSet) !== undefined
}

function resolveThumbnail(thumbnail: OngoingProjectsNotificationThumbnail | undefined): {
  src: string
  srcSet: string | undefined
} {
  if (thumbnail === undefined) {
    return { src: DEFAULT_BG_1X_URL, srcSet: DEFAULT_THUMBNAIL_SRCSET }
  }

  if (typeof thumbnail === 'string') {
    if (!thumbnail) {
      return { src: DEFAULT_BG_1X_URL, srcSet: DEFAULT_THUMBNAIL_SRCSET }
    }
    return { src: thumbnail, srcSet: undefined }
  }

  const srcSet = sanitizeSrcSet(thumbnail.srcSet)
  if (!thumbnail.src) {
    return { src: DEFAULT_BG_1X_URL, srcSet: srcSet ?? DEFAULT_THUMBNAIL_SRCSET }
  }
  return { src: thumbnail.src, srcSet }
}

function sanitizeSrcSet(srcSet: string | undefined): string | undefined {
  if (!srcSet) {
    return undefined
  }
  const valid = srcSet
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.split(/\s+/)[0] !== '')
  return valid.length > 0 ? valid.join(', ') : undefined
}

function ThumbnailImage({
  alt,
  className,
  thumbnail,
}: {
  alt: string
  className?: string
  thumbnail?: OngoingProjectsNotificationThumbnail
}) {
  const [hasError, setHasError] = useState(false)
  const resolved = resolveThumbnail(thumbnail)

  const srcRef = useRef(resolved.src)
  if (srcRef.current !== resolved.src) {
    srcRef.current = resolved.src
    setHasError(false)
  }

  const isDefault = resolved.src === DEFAULT_BG_1X_URL

  return (
    <img
      alt={alt}
      className={className}
      onError={isDefault || hasError ? undefined : () => setHasError(true)}
      src={hasError ? DEFAULT_BG_1X_URL : resolved.src}
      srcSet={hasError ? DEFAULT_THUMBNAIL_SRCSET : resolved.srcSet}
    />
  )
}
