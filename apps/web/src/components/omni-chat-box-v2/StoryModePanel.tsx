import { cn } from '@shared/ui'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Add, CrossSmall } from '@/components/icons/core'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import { useIsMobile } from '@/util/browserUtils'

import {
  MOUSE_DRAG_THRESHOLD_PX,
  STORY_MODE_CUSTOM_STYLE_ID,
} from './style/story-mode-style-helpers'
import { TextStyleVisual } from './style/TextStyleVisual'
import { ChooseStyleSheet } from './ChooseStyleSheet'

type StoryModePanelProps = {
  customStyleLabel?: string
  customStylePreviewUrl?: null | string
  onAddStyle: () => void
  onClearSelectedStyle?: () => void
  /** Called when mobile Choose Style sheet is closed without tapping Apply. Restore this style id. */
  onCloseWithoutApply?: (previousStyleId: string) => void
  onDeleteUserStyle?: (styleId: string) => void
  onSelectStyle: (style: StoryModeStyleOption) => void
  selectedStyleId: string
  showStyleError?: boolean
  styleErrorMessage?: string
  /** Preset style options (useStoryModeStyleOptions). Defaults to empty when omitted. */
  styleOptions?: StoryModeStyleOption[]
  /** User saved style options. Rendered before preset options. */
  userStyles?: StoryModeStyleOption[]
}

export { matchStylePreset, STORY_MODE_CUSTOM_STYLE_ID } from './style/story-mode-style-helpers'

const StyleThumbnail = React.memo(function StyleThumbnail({
  alt,
  imageUrl,
  priority = false,
}: {
  alt: string
  imageUrl: string
  priority?: boolean
}) {
  const [imageLoaded, setImageLoaded] = useState(false)

  useEffect(() => {
    setImageLoaded(false)
  }, [imageUrl])

  if (imageUrl) {
    return (
      <>
        {!imageLoaded && <div className="absolute inset-0 animate-pulse rounded-sm bg-white/20" />}
        <img
          alt={alt}
          className={cn(
            'size-full rounded-sm object-cover transition-opacity duration-200',
            imageLoaded ? 'opacity-100' : 'opacity-0',
          )}
          fetchPriority={priority ? 'high' : 'auto'}
          loading={priority ? 'eager' : 'lazy'}
          onLoad={() => setImageLoaded(true)}
          src={imageUrl}
        />
      </>
    )
  }

  return <div className="absolute inset-0 animate-pulse rounded-sm bg-white/20" />
})

export const StoryModePanel: React.FC<StoryModePanelProps> = React.memo(
  ({
    customStyleLabel,
    customStylePreviewUrl,
    onAddStyle,
    onClearSelectedStyle,
    onCloseWithoutApply,
    onDeleteUserStyle,
    onSelectStyle,
    selectedStyleId,
    showStyleError = false,
    styleErrorMessage,
    styleOptions = [],
    userStyles = [],
  }) => {
    const stylesRowRef = useRef<HTMLDivElement | null>(null)
    const styleIdWhenSheetOpenedRef = useRef<null | string>(null)
    const [hoveredStyle, setHoveredStyle] = useState<null | StoryModeStyleOption>(null)
    const [showLeftFade, setShowLeftFade] = useState(false)
    const [isMouseDragging, setIsMouseDragging] = useState(false)
    const [previewLeft, setPreviewLeft] = useState<null | number>(null)
    const [mobileSheetOpen, setMobileSheetOpen] = useState(false)
    const [mobileSheetStyleId, setMobileSheetStyleId] = useState<null | string>(null)
    const isMobile = useIsMobile()
    const styleErrorText = styleErrorMessage ?? 'Please select a style to continue.'
    const isCustomStyleSelected = selectedStyleId === STORY_MODE_CUSTOM_STYLE_ID
    const allStyles = useMemo(() => [...userStyles, ...styleOptions], [styleOptions, userStyles])
    const userStyleIdSet = useMemo(() => new Set(userStyles.map((style) => style.id)), [userStyles])
    const hasStyleList = userStyles.length > 0 || styleOptions.length > 0
    const dragStateRef = useRef({
      isDragging: false,
      moved: false,
      startScrollLeft: 0,
      startX: 0,
    })
    const suppressClickRef = useRef(false)

    // Prefer a rendered scene preview (latest snapshot) over the uploaded
    // reference thumbnail. The popup card cycles all previews; these
    // single-image surfaces (inline row, mobile sheet) show the first one.
    const getImageUrl = useCallback(
      (style: StoryModeStyleOption) =>
        style.scenePreviewUrls?.find((url) => url.trim()) || style.thumbnailUrl || '',
      [],
    )

    const selectedStyle = useMemo(() => {
      if (isCustomStyleSelected) {
        return {
          id: STORY_MODE_CUSTOM_STYLE_ID,
          label: customStyleLabel ?? 'Custom',
          styleText: undefined,
          thumbnailUrl: customStylePreviewUrl ?? '',
        }
      }
      return allStyles.find((style) => style.id === selectedStyleId)
    }, [allStyles, customStyleLabel, customStylePreviewUrl, isCustomStyleSelected, selectedStyleId])

    const hasSelectedStyle = Boolean(selectedStyle)
    const selectedThumbnailUrl = selectedStyle
      ? isCustomStyleSelected
        ? selectedStyle.thumbnailUrl
        : getImageUrl(selectedStyle as StoryModeStyleOption)
      : undefined

    const prefetchedImageUrlsRef = useRef(new Set<string>())
    const videoRefs = useRef(new Map<string, HTMLVideoElement>())

    useEffect(() => {
      const urlsToPrefetch = allStyles
        .map((style) => getImageUrl(style))
        .filter((url): url is string => Boolean(url))

      if (selectedThumbnailUrl) {
        urlsToPrefetch.push(selectedThumbnailUrl)
      }

      urlsToPrefetch.forEach((url) => {
        if (prefetchedImageUrlsRef.current.has(url)) {
          return
        }
        prefetchedImageUrlsRef.current.add(url)
        const image = new Image()
        image.src = url
      })
    }, [allStyles, getImageUrl, selectedThumbnailUrl])

    useEffect(() => {
      const hoveredId = hoveredStyle?.id
      videoRefs.current.forEach((video, styleId) => {
        if (styleId === hoveredId) {
          void video.play().catch(() => {
            // Ignore autoplay blocking and keep image fallback behavior intact.
          })
          return
        }
        video.pause()
      })
    }, [hoveredStyle])

    useEffect(() => {
      return () => {
        videoRefs.current.forEach((video) => {
          video.pause()
          video.removeAttribute('src')
          video.load()
        })
        videoRefs.current.clear()
      }
    }, [])

    useEffect(() => {
      const el = stylesRowRef.current
      if (!el) {
        return
      }

      const updateFadeState = () => {
        setShowLeftFade(el.scrollLeft > 0)
      }

      updateFadeState()
      el.addEventListener('scroll', updateFadeState, { passive: true })
      window.addEventListener('resize', updateFadeState)
      return () => {
        el.removeEventListener('scroll', updateFadeState)
        window.removeEventListener('resize', updateFadeState)
      }
    }, [hasSelectedStyle, styleOptions.length, userStyles.length])

    const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }
      const el = stylesRowRef.current
      if (!el) {
        return
      }

      dragStateRef.current = {
        isDragging: true,
        moved: false,
        startScrollLeft: el.scrollLeft,
        startX: event.clientX,
      }
      setIsMouseDragging(true)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStateRef.current.isDragging) {
          return
        }
        const deltaX = moveEvent.clientX - dragStateRef.current.startX
        if (!dragStateRef.current.moved && Math.abs(deltaX) < MOUSE_DRAG_THRESHOLD_PX) {
          return
        }
        dragStateRef.current.moved = true
        el.scrollLeft = dragStateRef.current.startScrollLeft - deltaX
      }

      const handleMouseUp = () => {
        if (dragStateRef.current.moved) {
          suppressClickRef.current = true
          // Clear the flag on the next frame so it doesn't persist when
          // mouseup fires outside the styles row (where no click event
          // would reach handleClickCapture to reset it).
          requestAnimationFrame(() => {
            suppressClickRef.current = false
          })
        }
        dragStateRef.current.isDragging = false
        dragStateRef.current.moved = false
        setIsMouseDragging(false)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }, [])

    const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (!suppressClickRef.current) {
        return
      }
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }, [])

    const handleStyleHover = useCallback(
      (style: StoryModeStyleOption, event: React.MouseEvent<HTMLButtonElement>) => {
        const hoveredVideo = videoRefs.current.get(style.id)
        if (hoveredVideo) {
          hoveredVideo.currentTime = 0
          void hoveredVideo.play().catch(() => {
            // Best-effort warm start; effect below still controls steady-state play/pause.
          })
        }
        const container = stylesRowRef.current
        if (!container) {
          setHoveredStyle(style)
          return
        }
        const containerRect = container.getBoundingClientRect()
        const targetRect = event.currentTarget.getBoundingClientRect()
        setHoveredStyle(style)
        setPreviewLeft(targetRect.left - containerRect.left + targetRect.width / 2)
      },
      [],
    )

    const handleStyleLeave = useCallback(() => {
      setHoveredStyle(null)
    }, [])

    const handleMobileStyleClick = useCallback(
      (style: StoryModeStyleOption) => {
        styleIdWhenSheetOpenedRef.current = selectedStyleId
        setMobileSheetStyleId(style.id)
        setMobileSheetOpen(true)
      },
      [selectedStyleId],
    )

    const handleMobileSheetClose = useCallback(
      (revert?: boolean) => {
        if (revert) {
          const previousId = styleIdWhenSheetOpenedRef.current
          if (previousId != null) {
            onCloseWithoutApply?.(previousId)
          }
        }
        styleIdWhenSheetOpenedRef.current = null
        setMobileSheetStyleId(null)
        setMobileSheetOpen(false)
      },
      [onCloseWithoutApply],
    )

    // Sync selectedStyleId to sheet ref when it changes while sheet is open (e.g. from Apply)
    // This ensures that if the user taps Apply (which updates selectedStyleId), the "previousId"
    // stored in the ref is updated to the new style. So if the sheet closes right after, or if
    // the user closes it later without changing selection again, we don't revert to the old style.
    useEffect(() => {
      if (mobileSheetOpen) {
        styleIdWhenSheetOpenedRef.current = selectedStyleId
      }
    }, [mobileSheetOpen, selectedStyleId])

    const renderAddStyleButton = (className?: string) => (
      <button
        className={cn('flex shrink-0 flex-col items-center gap-1.5', className)}
        onClick={onAddStyle}
        type="button"
      >
        <div className="flex h-[68px] w-[50px] items-center justify-center rounded-sm border-2 border-white/[0.15] bg-white/[0.03]">
          <Add className="size-4.5 text-secondary" />
        </div>
        <span className="text-secondary line-clamp-2 max-w-[70px] text-center text-xs font-medium leading-[15px]">
          Add style
        </span>
      </button>
    )

    return (
      <div className="flex w-full flex-col items-center gap-6">
        <div className="flex w-full max-w-[792px] flex-col gap-5">
          <div
            className="relative flex items-start gap-3 overflow-visible"
            data-onboarding-target="style-selection"
          >
            <div className="flex shrink-0 items-start gap-2">
              {hasSelectedStyle && selectedStyle ? (
                <div className="flex w-[70px] flex-col items-center gap-1.5">
                  <div className="relative h-[68px] w-[50px] rounded-sm">
                    <StyleThumbnail
                      alt={selectedStyle.label}
                      imageUrl={selectedThumbnailUrl ?? ''}
                      priority
                    />
                    <button
                      aria-label="Clear selected style"
                      className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-white text-black"
                      onClick={onClearSelectedStyle}
                      type="button"
                    >
                      <CrossSmall className="size-3" />
                    </button>
                  </div>
                  <p className="text-primary line-clamp-2 max-w-[70px] overflow-hidden text-center text-xs font-medium leading-[15px]">
                    {selectedStyle.label}
                  </p>
                </div>
              ) : (
                renderAddStyleButton()
              )}
              {(hasSelectedStyle || hasStyleList) && (
                <div className="flex h-[68px] shrink-0 items-center justify-center px-1">
                  <div className="h-8 w-px shrink-0 bg-white/20" />
                </div>
              )}
            </div>
            <div className="relative min-w-0 flex-1" onMouseLeave={handleStyleLeave}>
              {showLeftFade && (
                <div className="pointer-events-none absolute left-0 top-0 z-10 h-[89px] w-[60px] bg-gradient-to-r from-[#1a1a1a] to-transparent" />
              )}
              <div
                className={cn(
                  'relative flex items-start gap-4 overflow-x-auto overflow-y-hidden pr-14 scrollbar-hide cursor-grab',
                  isMouseDragging && 'cursor-grabbing select-none',
                )}
                onClickCapture={handleClickCapture}
                onMouseDown={handleMouseDown}
                ref={stylesRowRef}
              >
                {hasSelectedStyle && renderAddStyleButton()}

                {userStyles.map((style) => {
                  const isSelected = style.id === selectedStyleId
                  const imageUrl = getImageUrl(style)
                  return (
                    <div
                      className={cn('group relative w-[70px] shrink-0', isSelected && 'hidden')}
                      key={style.id}
                    >
                      <button
                        className="flex w-full flex-col items-center gap-1.5"
                        onClick={() =>
                          isMobile ? handleMobileStyleClick(style) : onSelectStyle(style)
                        }
                        onMouseEnter={(event) => handleStyleHover(style, event)}
                        type="button"
                      >
                        <div
                          className={cn(
                            'relative h-[68px] w-[50px] overflow-hidden rounded-sm transition-all duration-200',
                            !isSelected && 'hover:opacity-35',
                          )}
                        >
                          <StyleThumbnail alt={style.label} imageUrl={imageUrl} />
                        </div>
                        <span className="text-secondary line-clamp-2 max-w-[70px] overflow-hidden text-center text-xs font-medium leading-[15px]">
                          {style.label}
                        </span>
                      </button>
                    </div>
                  )
                })}

                {styleOptions.map((style) => {
                  const isSelected = style.id === selectedStyleId
                  const imageUrl = getImageUrl(style)
                  return (
                    <button
                      className={cn(
                        'flex w-[70px] shrink-0 flex-col items-center gap-1.5',
                        isSelected && 'hidden',
                      )}
                      key={style.id}
                      onClick={() =>
                        isMobile ? handleMobileStyleClick(style) : onSelectStyle(style)
                      }
                      onMouseEnter={(event) => handleStyleHover(style, event)}
                      type="button"
                    >
                      <div
                        className={cn(
                          'relative h-[68px] w-[50px] overflow-hidden rounded-sm transition-all duration-200',
                          !isSelected && 'hover:opacity-35',
                        )}
                      >
                        <StyleThumbnail alt={style.label} imageUrl={imageUrl} />
                      </div>
                      <span className="text-secondary line-clamp-2 max-w-[70px] overflow-hidden text-center text-xs font-medium leading-[15px]">
                        {style.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Hover preview: desktop only; mobile uses sheet, no animation preview */}
              {allStyles.map((style) => {
                const isHovered = hoveredStyle?.id === style.id
                const imageUrl = getImageUrl(style)
                const hasImage = Boolean(imageUrl)
                const previewVideoUrl = style.previewVideoUrl?.trim() || ''
                const hasVideoPreview = Boolean(previewVideoUrl)
                const canDelete = Boolean(onDeleteUserStyle && userStyleIdSet.has(style.id))
                return (
                  <div
                    className={cn(
                      'absolute z-[60] flex -translate-x-1/2 transition-opacity duration-100 max-sm:hidden',
                      isHovered && previewLeft !== null
                        ? 'pointer-events-auto opacity-100'
                        : 'pointer-events-none opacity-0',
                    )}
                    key={`preview-${style.id}`}
                    style={{
                      bottom: 'calc(100% - 30px)',
                      left: previewLeft ?? 0,
                    }}
                  >
                    <div className="relative h-[196px] w-[110px] overflow-hidden rounded-sm shadow-[0px_12px_60px_rgba(0,0,0,0.5)]">
                      {hasVideoPreview ? (
                        <video
                          className="size-full rounded-sm object-cover"
                          loop
                          muted
                          playsInline
                          poster={hasImage ? imageUrl : undefined}
                          preload="auto"
                          ref={(node) => {
                            if (node) {
                              videoRefs.current.set(style.id, node)
                            } else {
                              videoRefs.current.delete(style.id)
                            }
                          }}
                          src={previewVideoUrl}
                        />
                      ) : hasImage ? (
                        <img
                          alt={style.label}
                          className="size-full rounded-sm object-cover"
                          src={imageUrl}
                        />
                      ) : (
                        <TextStyleVisual mode="preview" styleText={style.styleText} />
                      )}
                      {canDelete && (
                        <button
                          aria-label={`Delete ${style.label}`}
                          className="absolute bottom-2 left-1/2 z-[90] flex h-5 -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-xxs bg-white/10 px-1.5 text-[12px] font-medium leading-[15px] text-white backdrop-blur-2xl transition-colors duration-150 hover:bg-[#de4c22]"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            onDeleteUserStyle?.(style.id)
                          }}
                          type="button"
                        >
                          Remove style
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="pointer-events-none absolute right-0 top-0 h-[89px] w-[60px] bg-gradient-to-l from-[#1a1a1a] to-transparent" />
            </div>
          </div>
          {showStyleError && (
            <p className="w-full max-w-[792px] text-xs text-error" role="alert">
              {styleErrorText}
            </p>
          )}
        </div>

        {/* Mobile-only: Choose Style bottom sheet */}
        {isMobile && mobileSheetOpen && (
          <ChooseStyleSheet
            allStyles={allStyles}
            getImageUrl={getImageUrl}
            onAddStyle={onAddStyle}
            onApply={onSelectStyle}
            onClose={handleMobileSheetClose}
            onDeleteUserStyle={onDeleteUserStyle}
            selectedStyleId={mobileSheetStyleId ?? selectedStyleId}
            userStyleIdSet={userStyleIdSet}
          />
        )}
      </div>
    )
  },
)

StoryModePanel.displayName = 'StoryModePanel'
