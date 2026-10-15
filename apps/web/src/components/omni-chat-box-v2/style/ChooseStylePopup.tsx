'use client'
import { Button, cn, Tooltip } from '@shared/ui'
import { AgentThinkingIcon } from '@shared/ui/chat'
import React, { useMemo, useRef, useState } from 'react'

import {
  Add,
  CrossSmall,
  Loading,
  MagicEdit,
  More,
  Question,
  Sparkle,
} from '@/components/icons/core'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import { useIsMobile } from '@/util/browserUtils'

import { styleCardUsageKey, useBrandStyleUsage } from '../brand/use-brand-style-usage'

import { STORY_MODE_AUTO_STYLE_ID, STORY_MODE_CUSTOM_STYLE_ID } from './story-mode-style-helpers'
import { StyleBrandBadge } from './StyleBrandBadge'
import { StyleCardCarousel } from './StyleCardCarousel'

export type ChooseStylePopupProps = {
  className?: string
  customStyleLabel?: string
  customStylePreviewUrl?: null | string
  // Hides the "Add new style" create CTA (the dashed tile + bottom button) when
  // the picker is reused only to pick from existing styles -- e.g. the Brand
  // Library, where creating a brand-new custom style is a separate flow.
  hideAddStyle?: boolean
  isCustomStylePreviewGenerating?: boolean
  mobileLayout?: boolean
  onAddStyle?: () => void
  onClose: () => void
  onDeleteUserStyle?: (styleId: string) => void
  onSelectStyle: (style: StoryModeStyleOption) => void
  selectedStyleId: string
  styleOptions?: StoryModeStyleOption[]
  userStyles?: StoryModeStyleOption[]
}

// Preset styles ship a short (~5s) hover-preview clip (previewVideoUrl). On
// desktop hover we play it (looping, muted) over the static thumbnail poster;
// pointer-leave pauses + rewinds so idle cards rest on the thumbnail.
// preload='none' keeps the .mp4 from being fetched until the first hover (not
// for every card). Falls back to the static thumbnail if the clip fails to load.
const StylePreviewVideo = React.memo(function StylePreviewVideo({
  posterUrl,
  videoUrl,
}: {
  posterUrl: string
  styleId: string
  styleName: string
  videoUrl: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <img
        alt=""
        className="pointer-events-none absolute inset-0 size-full max-w-none object-cover object-center"
        draggable={false}
        loading="lazy"
        src={posterUrl}
      />
    )
  }

  return (
    // Images/video are pointer-events-none so clicks bubble to the parent card
    // (selection); this captures enter/leave to drive playback.
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseEnter={() => {
        const video = videoRef.current
        if (video) {
          video.currentTime = 0
          void Promise.resolve(video.play()).catch(() => undefined)
        }
      }}
      onMouseLeave={() => {
        const video = videoRef.current
        if (video) {
          video.pause()
          video.currentTime = 0
        }
      }}
    >
      <video
        className="pointer-events-none absolute inset-0 size-full max-w-none object-cover object-center"
        loop
        muted
        onError={() => setFailed(true)}
        playsInline
        poster={posterUrl || undefined}
        preload="none"
        ref={videoRef}
        src={videoUrl}
      />
    </div>
  )
})

const AUTO_STYLE_TOOLTIP_TEXT = 'Let AI pick for you'

// 10x10 pixel-sampled mesh from the design reference, for a
// close color match to its blue-grey/orange/olive blend.
const AUTO_STYLE_MESH = [
  [
    '#667a8a',
    '#697b86',
    '#727b7d',
    '#857d6a',
    '#977c56',
    '#9e784d',
    '#977756',
    '#867867',
    '#777877',
    '#6d7981',
  ],
  [
    '#667b88',
    '#6d7b82',
    '#797b76',
    '#8c7b64',
    '#9b7851',
    '#a17449',
    '#9c7350',
    '#8d745f',
    '#7e7871',
    '#72797d',
  ],
  [
    '#6c7b84',
    '#747b7c',
    '#837a6c',
    '#93785a',
    '#9e724c',
    '#a27048',
    '#9d704a',
    '#937456',
    '#847764',
    '#777871',
  ],
  [
    '#7b7677',
    '#82776f',
    '#907561',
    '#9b7253',
    '#a26d48',
    '#9f6c45',
    '#9a7147',
    '#91764e',
    '#877b5a',
    '#7d7c63',
  ],
  [
    '#937060',
    '#96705d',
    '#9d6f55',
    '#a26c4d',
    '#a26a48',
    '#9b6f46',
    '#937647',
    '#8a7a48',
    '#847b4d',
    '#7f7b53',
  ],
  [
    '#a5694f',
    '#a7694d',
    '#a8694b',
    '#a96748',
    '#a46945',
    '#997147',
    '#8c7845',
    '#857a45',
    '#807b47',
    '#7f7a47',
  ],
  [
    '#ae6445',
    '#ad6345',
    '#ad6344',
    '#ac6345',
    '#a36744',
    '#966d44',
    '#877343',
    '#7e7442',
    '#797442',
    '#797542',
  ],
  [
    '#a96348',
    '#a76448',
    '#a66147',
    '#a56046',
    '#9d6446',
    '#906745',
    '#7f6945',
    '#756a44',
    '#706a43',
    '#716c43',
  ],
  [
    '#9e6550',
    '#9c6350',
    '#9b624f',
    '#97614d',
    '#91614e',
    '#87604c',
    '#775f49',
    '#6c5f48',
    '#686147',
    '#676146',
  ],
  [
    '#92675a',
    '#906758',
    '#8d6457',
    '#8b6357',
    '#866256',
    '#7f6055',
    '#725e53',
    '#685c50',
    '#635d4e',
    '#635e4e',
  ],
] as const

function autoStyleMeshBackground(): string {
  const n = AUTO_STYLE_MESH.length
  const stops: string[] = []
  for (let gy = 0; gy < n; gy += 1) {
    for (let gx = 0; gx < n; gx += 1) {
      const px = (gx * 100) / (n - 1)
      const py = (gy * 100) / (n - 1)
      stops.push(
        `radial-gradient(circle at ${px}% ${py}%, ${AUTO_STYLE_MESH[gy][gx]} 0%, transparent 20%)`,
      )
    }
  }
  // Solid average-color base last (CSS layers paint first-listed on top), so
  // the gaps between sample points show this instead of the container's grey
  // showing through and washing out the blend once blurred.
  stops.push('linear-gradient(#8b6f55, #8b6f55)')
  return stops.join(', ')
}

// Auto tile background: a static gradient mesh
// (hidden at rest, shown on hover/selected) behind an icon that crosses from a
// static MagicEdit glyph to the animated AI-processing Rive mark on hover. The
// icon stays static except on hover (not selected-but-not-hovered) because
// nothing is actually being processed at this point in the flow -- an
// animated "thinking" icon otherwise would misrepresent the tile as busy.
function AutoStyleBackground({
  isHovered,
  isSelected,
}: {
  // Lifted to the outer card button (not tracked here) so hovering anywhere
  // on the card -- including the label below the thumbnail -- activates it,
  // not just the thumbnail box itself.
  isHovered: boolean
  isSelected: boolean
}) {
  const isActive = isSelected || isHovered
  // Scoped to this thumbnail box specifically (unlike isHovered above, which
  // is card-wide) so the icon only animates when the pointer is actually over
  // the thumbnail, not the label below it.
  const [isThumbnailHovered, setIsThumbnailHovered] = useState(false)

  return (
    <div
      className="relative flex size-full items-center justify-center overflow-hidden rounded-sm bg-[rgba(68,68,68,0.5)]"
      onMouseEnter={() => setIsThumbnailHovered(true)}
      onMouseLeave={() => setIsThumbnailHovered(false)}
    >
      <div
        className={cn(
          'absolute -inset-3 transition-opacity duration-300',
          isActive ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: autoStyleMeshBackground(), filter: 'blur(8px)' }}
      />
      <div
        className={cn(
          'absolute inset-0 bg-black/10 transition-opacity duration-300',
          isActive ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="relative z-10 size-6">
        {/* Both icons stay mounted and cross-fade on hover, instead of one
            replacing the other -- swapping via conditional render remounted
            AgentThinkingIcon's Rive asset from scratch every hover, which
            reloads (and re-fades-in) it each time, reading as a stutter. */}
        <AgentThinkingIcon
          className={cn(
            'absolute inset-0 size-6 brightness-0 invert opacity-80 transition-opacity duration-200',
            isThumbnailHovered ? 'opacity-80' : 'opacity-0',
          )}
        />
        <MagicEdit
          className={cn(
            'absolute inset-0 size-6 text-white transition-opacity duration-200',
            isThumbnailHovered ? 'opacity-0' : isActive ? 'opacity-80' : 'opacity-50',
          )}
        />
      </div>
    </div>
  )
}

const StyleCardThumbnail = React.memo(function StyleCardThumbnail({
  fallbackUrl,
  imageUrls,
  isAutoStyle = false,
  isGenerating,
  isHovered,
  isSelected,
  previewVideoUrl,
  styleId,
  styleName,
}: {
  // Reference thumbnail shown when there are no scene previews, or when every
  // preview fails to load (carousel fallback). Empty for presets without one.
  fallbackUrl: string
  // Rendered scene previews to cycle (carousel). A single entry renders
  // statically; an empty list falls through to the generating / placeholder
  // states below.
  imageUrls: string[]
  // The Auto tile: permanently thumbnail-less, so it renders an
  // animated gradient (AutoStyleBackground) instead of falling into the
  // "Creating..." pulse below (that reads as a stuck custom-style generation).
  isAutoStyle?: boolean
  isGenerating: boolean
  // Both drive the Auto tile's background animation (see AutoStyleBackground).
  // isHovered is tracked by the outer card button, not this thumbnail box, so
  // the whole card (including the label below) counts as "hovered".
  isHovered?: boolean
  isSelected?: boolean
  // Preset hover-preview clip. Set for presets only (saved styles have none);
  // when present it plays on hover instead of the scene-preview slideshow.
  previewVideoUrl?: string
  styleId: string
  styleName: string
}) {
  if (isAutoStyle) {
    return <AutoStyleBackground isHovered={Boolean(isHovered)} isSelected={Boolean(isSelected)} />
  }

  // Preset hover video takes precedence: presets carry previewVideoUrl + a
  // thumbnail poster, while saved styles carry scene previews and keep the
  // carousel slideshow below.
  if (previewVideoUrl && fallbackUrl.length > 0) {
    return (
      <StylePreviewVideo
        posterUrl={fallbackUrl}
        styleId={styleId}
        styleName={styleName}
        videoUrl={previewVideoUrl}
      />
    )
  }
  if (imageUrls.length > 0 || fallbackUrl.length > 0) {
    return (
      <StyleCardCarousel className="rounded-sm" fallbackUrl={fallbackUrl} imageUrls={imageUrls} />
    )
  }

  if (isGenerating) {
    return (
      <div className="flex size-full items-center justify-center">
        <Loading className="size-8 animate-spin text-white" />
      </div>
    )
  }

  return (
    <div className="relative flex size-full flex-col items-center justify-center">
      <div className="absolute inset-0 animate-pulse rounded-sm bg-white/20" />
      <span className="relative text-[11px] font-medium leading-[14px] text-white/50">
        Creating...
      </span>
    </div>
  )
})

export const ChooseStylePopup: React.FC<ChooseStylePopupProps> = ({
  className,
  customStyleLabel,
  customStylePreviewUrl,
  hideAddStyle = false,
  isCustomStylePreviewGenerating = false,
  mobileLayout = false,
  onAddStyle,
  onClose,
  onDeleteUserStyle,
  onSelectStyle,
  selectedStyleId,
  styleOptions = [],
  userStyles = [],
}) => {
  const allStyles = useMemo<StoryModeStyleOption[]>(() => {
    const merged = [...userStyles, ...styleOptions]

    return selectedStyleId === STORY_MODE_CUSTOM_STYLE_ID &&
      !merged.some((style) => style.id === STORY_MODE_CUSTOM_STYLE_ID)
      ? [
          {
            id: STORY_MODE_CUSTOM_STYLE_ID,
            label: customStyleLabel?.trim() || 'Custom style',
            styleText: customStyleLabel?.trim() || undefined,
            thumbnailUrl: customStylePreviewUrl || '',
          },
          ...merged,
        ]
      : merged
  }, [customStyleLabel, customStylePreviewUrl, selectedStyleId, styleOptions, userStyles])
  const userStyleIds = useMemo(() => new Set(userStyles.map((style) => style.id)), [userStyles])
  // Which brand briefs reference each style, for the brand badge + hover tooltip.
  const brandUsage = useBrandStyleUsage()
  const isMobile = useIsMobile()
  const [menuStyleId, setMenuStyleId] = useState<null | string>(null)
  // Only the Auto tile reads this (see AutoStyleBackground); tracked on the
  // outer card button so hovering anywhere on the card -- not just its
  // thumbnail box -- counts, rather than each card owning its own hover state.
  const [isAutoTileHovered, setIsAutoTileHovered] = useState(false)
  // Brand tab is only offered when a brand with styles is selected; default to it
  // so the brand's look is front and center, falling back to All styles.

  if (isMobile) {
    return (
      <section
        className={cn(
          'relative flex h-full min-h-0 w-full flex-col bg-[rgba(68,68,68,0.5)] px-4 pb-4',
          className,
        )}
      >
        <header className="flex w-full items-start gap-4 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-white">Choose Style</h2>
            <p className="text-sm text-white/50">
              Select the style you&apos;d like to use for your video.
            </p>
          </div>
          <Button
            aria-label="Close choose style"
            className="size-7 shrink-0 rounded-full bg-fill-secondary hover:bg-fill-hover"
            onClick={onClose}
            size="icon"
            type="button"
            variant="base"
          >
            <CrossSmall className="size-6 text-white" />
          </Button>
        </header>

        {/* 3-up grid of 3:4 cards (8px gaps) with the style
            name overlaid; "Add new style" is a bottom CTA, not a grid tile.
            auto-rows-max is load-bearing: when the grid is itself the flex-1
            min-h-0 scroll container, auto row tracks ignore the aspect-ratio
            transferred height (Blink AND WebKit) and the cards overlap.
            max-content tracks pick it up. */}
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-3 content-start gap-2 overflow-y-auto pb-4">
          {allStyles.map((style, index) => {
            const isSelected = style.id === selectedStyleId
            const scenePreview = (style.scenePreviewUrls ?? []).find((url) => url.trim())
            const previewUrl = scenePreview || style.thumbnailUrl?.trim() || ''
            const isCustomStyle = style.id === STORY_MODE_CUSTOM_STYLE_ID
            const isAutoStyle = style.id === STORY_MODE_AUTO_STYLE_ID
            // User styles get a ... chip opening Edit /
            // Delete. The chip and menu are siblings of the card button: the
            // card's overflow-hidden would clip them, and the menu is a
            // self-contained popover because a Radix dropdown nested in this
            // Radix Dialog never opens (portal swallowed by the modal).
            const hasCardMenu = userStyleIds.has(style.id) && Boolean(onDeleteUserStyle)
            const isMenuOpen = menuStyleId === style.id
            // The w-32 menu is wider than a grid card, so anchoring it to the
            // right edge pushes it off-screen for leftmost-column cards; anchor
            // those to the left edge so it opens rightward instead.
            const isLeftmostColumn = index % 3 === 0
            return (
              <div className={cn('relative', isMenuOpen ? 'z-10' : '')} key={style.id}>
                <button
                  className={cn(
                    'relative block aspect-[3/4] w-full overflow-hidden rounded-[12px] bg-tertiary',
                    isSelected ? 'ring-2 ring-inset ring-white' : '',
                  )}
                  onClick={() => onSelectStyle(style)}
                  type="button"
                >
                  {previewUrl ? (
                    <img
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      src={previewUrl}
                    />
                  ) : isCustomStyle && isCustomStylePreviewGenerating ? (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Loading className="size-8 animate-spin text-white" />
                    </span>
                  ) : isAutoStyle ? (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Sparkle className="size-8 text-white/70" />
                    </span>
                  ) : null}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
                    <span className="line-clamp-2 text-left text-sm font-medium text-white">
                      {style.label}
                    </span>
                  </div>
                </button>
                {hasCardMenu ? (
                  <button
                    aria-expanded={isMenuOpen}
                    aria-label={`Options for ${style.label}`}
                    className="absolute right-[5px] top-[5px] flex size-6 items-center justify-center rounded-full bg-black/15 text-white backdrop-blur-[5px]"
                    onClick={() => setMenuStyleId(isMenuOpen ? null : style.id)}
                    type="button"
                  >
                    <More className="size-[18px]" />
                  </button>
                ) : null}
                {isMenuOpen ? (
                  <>
                    {/* Click-away catcher. */}
                    <div className="fixed inset-0 z-[83]" onClick={() => setMenuStyleId(null)} />
                    <div
                      className={cn(
                        'absolute top-8 z-[84] w-32 rounded-2xl bg-[var(--UI-menu-background,hsl(var(--ui-bg-menu)))] p-1.5 backdrop-blur-2xl',
                        isLeftmostColumn ? 'left-1' : 'right-1',
                      )}
                    >
                      {onDeleteUserStyle ? (
                        <button
                          className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-primary transition hover:bg-[var(--fill-hover)]"
                          onClick={() => {
                            setMenuStyleId(null)
                            onDeleteUserStyle(style.id)
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>

        {!hideAddStyle && (
          <div className="shrink-0 pt-2">
            <button
              className="h-12 w-full rounded-full bg-white text-base font-medium text-black transition hover:opacity-90"
              onClick={onAddStyle}
              type="button"
            >
              Add new style
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      className={cn(
        // Definite width (not w-full) so the dialog doesn't shrink-wrap to its
        // content: a tab with few cards (e.g. a brand with one style) would
        // otherwise render a much narrower panel than All styles. max-w caps it
        // to the viewport on mid-size screens so it never overflows.
        'relative flex w-[802px] max-w-[calc(100vw_-_32px)] flex-col rounded-3xl bg-[rgba(68,68,68,0.5)] px-4 pb-4 max-sm:h-full max-sm:w-full max-sm:max-w-full max-sm:min-h-0 max-sm:rounded-b-none',
        mobileLayout && 'pb-[calc(env(safe-area-inset-bottom,0px)_+_16px)]',
        className,
      )}
    >
      <header className="flex w-full items-start gap-4 pt-5 pb-3 pl-2">
        <div className="flex min-h-[22px] min-w-0 flex-1 flex-col justify-center gap-1">
          <h2 className="font-semibold text-lg md:text-[18px] leading-[21.8px] text-white">
            Choose style
          </h2>
          {mobileLayout && (
            <p className="text-sm text-secondary font-normal leading-[22px] tracking-normal">
              Select the style you&apos;d like to use for your video.
            </p>
          )}
        </div>
        <Button
          aria-label="Close choose style"
          className="shrink-0 rounded-full bg-fill-secondary hover:bg-fill-hover size-9.5 md:size-7"
          onClick={onClose}
          size="icon"
          type="button"
          variant="base"
        >
          <CrossSmall className="size-[var(--mobile-icon-size)] text-white" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[min(450px,60vh)] mr-[-10px] overflow-y-auto overflow-x-hidden rounded-md max-sm:h-full max-sm:mr-0">
          <div
            className={cn(
              mobileLayout ? 'grid grid-cols-3 gap-2' : '-mr-4 flex flex-wrap content-start',
              'pb-4',
            )}
          >
            {!mobileLayout && !hideAddStyle && (
              <button
                className="flex w-[154px] shrink-0 self-start flex-col items-center gap-2 rounded-md p-2 transition-colors hover:bg-white/[0.04]"
                onClick={onAddStyle}
                type="button"
              >
                <div className="flex size-[138px] items-center justify-center rounded-sm border border-dashed border-secondary bg-[rgba(68,68,68,0.5)]">
                  <Add className="size-[var(--mobile-icon-size)] text-white/50" />
                </div>
                <span className="text-center text-xs font-medium leading-[15px] text-white/50">
                  Add style
                </span>
              </button>
            )}

            {allStyles.map((style) => {
              const isSelected = style.id === selectedStyleId
              // The carousel cycles the rendered scene previews and falls back to
              // the single reference thumbnail when there are none (presets, or
              // styles saved before scene previews existed) or when every preview
              // fails to load.
              const scenePreviews = (style.scenePreviewUrls ?? []).filter((url) => url.trim())
              const cardFallbackUrl = style.thumbnailUrl?.trim() || ''
              const isCustomStyle = style.id === STORY_MODE_CUSTOM_STYLE_ID
              const isAutoStyle = style.id === STORY_MODE_AUTO_STYLE_ID
              const isUserStyle = userStyleIds.has(style.id)
              const brandNames = brandUsage.get(styleCardUsageKey(style.id, isUserStyle)) ?? []
              const showDeleteButton = isUserStyle && Boolean(onDeleteUserStyle) && !mobileLayout

              return (
                <div className="group relative" key={style.id}>
                  <button
                    className={cn(
                      'flex shrink-0 flex-col items-center gap-2 rounded-md transition-colors',
                      // Mobile: no card padding so the only spacing is the grid's gap-2.
                      mobileLayout ? 'w-full' : 'w-[154px] p-2',
                      isSelected ? 'bg-fill-secondary' : 'hover:bg-white/[0.04]',
                    )}
                    onClick={() => onSelectStyle(style)}
                    onMouseEnter={() => isAutoStyle && setIsAutoTileHovered(true)}
                    onMouseLeave={() => isAutoStyle && setIsAutoTileHovered(false)}
                    type="button"
                  >
                    <div
                      className={cn(
                        'relative shrink-0 overflow-hidden rounded-sm',
                        // Portrait 114:180 thumbnail; width is responsive (3-col), so the
                        // card scales with the device and ~3 rows fill the sheet.
                        mobileLayout ? 'aspect-[114/180] w-full' : 'size-[138px]',
                      )}
                    >
                      <StyleCardThumbnail
                        fallbackUrl={cardFallbackUrl}
                        imageUrls={scenePreviews}
                        isAutoStyle={isAutoStyle}
                        isGenerating={isCustomStyle && isCustomStylePreviewGenerating}
                        isHovered={isAutoTileHovered}
                        isSelected={isSelected}
                        previewVideoUrl={style.previewVideoUrl}
                        styleId={style.id}
                        styleName={style.label}
                      />
                      <StyleBrandBadge names={brandNames} />
                    </div>
                    {isAutoStyle ? (
                      <span
                        className={cn(
                          'flex w-full max-w-full items-center justify-center gap-1 text-center text-xs font-medium leading-[15px]',
                          isSelected ? 'text-white' : 'text-white/50',
                        )}
                      >
                        Auto
                        <Tooltip
                          arrow
                          className="w-48 rounded-sm bg-[#444] px-3.5 py-2"
                          content={
                            <p className="text-[14px] font-normal leading-[22px] text-white">
                              {AUTO_STYLE_TOOLTIP_TEXT}
                            </p>
                          }
                          side="bottom"
                          sideOffset={4}
                        >
                          <span
                            className="inline-flex shrink-0"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Question className="size-3.5 text-white/50" />
                          </span>
                        </Tooltip>
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'line-clamp-2 w-full max-w-full break-words text-center text-xs font-medium leading-[15px]',
                          isSelected ? 'text-white' : 'text-white/50',
                        )}
                      >
                        {style.label}
                      </span>
                    )}
                  </button>

                  {showDeleteButton ? (
                    <Button
                      aria-label={`Delete ${style.label}`}
                      className={cn(
                        'absolute right-0 top-0 rounded-full bg-white text-black opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100',
                        // Mobile: nudge the small button up/right by size-1 to peek over the corner.
                        mobileLayout ? '-right-1 -top-1 size-4.5' : 'size-7',
                      )}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteUserStyle?.(style.id)
                      }}
                      size="icon"
                      type="button"
                      variant="base"
                    >
                      <CrossSmall className="size-3 md:size-6" />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {mobileLayout && !hideAddStyle && (
        <Button
          className="h-12 w-full shrink-0 rounded-full bg-white text-base font-medium text-black hover:bg-white/90"
          onClick={onAddStyle}
          type="button"
          variant="ghost"
        >
          Add new style
        </Button>
      )}
    </section>
  )
}

export default ChooseStylePopup
