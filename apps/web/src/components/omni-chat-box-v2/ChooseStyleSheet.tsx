import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CrossSmall } from '@/components/icons/core'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

import { TextStyleVisual } from './style/TextStyleVisual'

const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

const CHOOSE_STYLE_CARD_WIDTH = 180
const CHOOSE_STYLE_CARD_HEIGHT = 320
const CHOOSE_STYLE_GAP = 24
const CHOOSE_STYLE_SCALE_RADIUS = 140
const CHOOSE_STYLE_MIN_SCALE = 0.82

/**
 * Mobile Choose Style sheet.
 * Swipeable 3-card carousel: large center card, smaller side peek cards.
 */
export type ChooseStyleSheetProps = {
  allStyles: StoryModeStyleOption[]
  getImageUrl: (style: StoryModeStyleOption) => string
  onAddStyle: () => void
  onApply: (style: StoryModeStyleOption) => void
  /** Called when sheet is dismissed. Pass true when user closed without Apply (e.g. X). */
  onClose: (revert?: boolean) => void
  onDeleteUserStyle?: (styleId: string) => void
  selectedStyleId: string
  userStyleIdSet: Set<string>
}

export const ChooseStyleSheet: React.FC<ChooseStyleSheetProps> = ({
  allStyles,
  getImageUrl,
  onAddStyle,
  onApply,
  onClose,
  onDeleteUserStyle,
  selectedStyleId,
  userStyleIdSet,
}) => {
  const activeIdx = useMemo(
    () =>
      Math.max(
        0,
        allStyles.findIndex((s) => s.id === selectedStyleId),
      ),
    [allStyles, selectedStyleId],
  )
  const [currentIdx, setCurrentIdx] = useState(activeIdx)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerWidth, setContainerWidth] = useState(400)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<null | number>(null)
  const scrollEndRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    setCurrentIdx(activeIdx)
  }, [activeIdx])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || allStyles.length === 0) {
      return
    }
    setContainerWidth(el.clientWidth)
    const cardSpan = CHOOSE_STYLE_CARD_WIDTH + CHOOSE_STYLE_GAP
    el.scrollLeft = activeIdx * cardSpan
  }, [activeIdx, allStyles.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(idx, allStyles.length - 1))
      setCurrentIdx(clamped)
      const el = scrollRef.current
      if (el) {
        const cardSpan = CHOOSE_STYLE_CARD_WIDTH + CHOOSE_STYLE_GAP
        el.scrollTo({ behavior: 'smooth', left: clamped * cardSpan })
      }
    },
    [allStyles.length],
  )

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      return
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) {
        return
      }
      setScrollLeft(el.scrollLeft)
      setContainerWidth(el.clientWidth)
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const onScrollEnd = () => {
      if (scrollEndRef.current) {
        clearTimeout(scrollEndRef.current)
      }
      scrollEndRef.current = setTimeout(() => {
        scrollEndRef.current = null
        const span = CHOOSE_STYLE_CARD_WIDTH + CHOOSE_STYLE_GAP
        const idx = Math.round(el.scrollLeft / span)
        const clamped = Math.max(0, Math.min(idx, allStyles.length - 1))
        if (clamped !== currentIdx) {
          setCurrentIdx(clamped)
        }
      }, 150)
    }
    el.addEventListener('scroll', onScrollEnd, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScrollEnd)
      if (scrollEndRef.current) {
        clearTimeout(scrollEndRef.current)
      }
    }
  }, [allStyles.length, currentIdx])

  const cardSpan = CHOOSE_STYLE_CARD_WIDTH + CHOOSE_STYLE_GAP
  const getScaleForIndex = useCallback(
    (index: number) => {
      const viewportCenterX = scrollLeft + containerWidth / 2
      const paddingLeft = (containerWidth - CHOOSE_STYLE_CARD_WIDTH) / 2
      const cardCenterX = paddingLeft + index * cardSpan + CHOOSE_STYLE_CARD_WIDTH / 2
      const offsetPx = Math.abs(cardCenterX - viewportCenterX)
      const t = Math.min(1, offsetPx / CHOOSE_STYLE_SCALE_RADIUS)
      return 1 - (1 - CHOOSE_STYLE_MIN_SCALE) * t
    },
    [scrollLeft, containerWidth],
  )

  const current = allStyles[currentIdx]
  const isCurrentUserStyle = Boolean(current && userStyleIdSet.has(current.id))

  return createPortal(
    <>
      {/* Full-screen overlay; portaled to body so it layers above the navbar */}
      <div aria-hidden className="fixed inset-0 z-[80] bg-black/80 pointer-events-none" />
      <button
        aria-label="Close overlay"
        className="fixed inset-0 z-[80]"
        onClick={() => onClose(true)}
        type="button"
      />
      <div
        aria-labelledby="choose-style-sheet-title"
        className="fixed inset-x-0 bottom-0 z-[80] flex flex-col overflow-hidden rounded-t-[16px] backdrop-blur-2xl"
        role="dialog"
        style={{ background: 'rgba(68,68,68,0.5)', WebkitBackdropFilter: 'blur(40px)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-4 p-4">
          <div className="min-w-0 flex-1">
            <h2
              className="text-[16px] font-medium leading-[20px] text-[#fafafa]"
              id="choose-style-sheet-title"
              style={FF_STYLE}
            >
              Choose Style
            </h2>
            <p className="text-[14px] font-normal leading-[22px] text-white/50" style={FF_STYLE}>
              Select the style you'd like to use for your video.
            </p>
          </div>
          <button
            aria-label="Close"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            onClick={() => onClose(true)}
            type="button"
          >
            <CrossSmall className="size-6" />
          </button>
        </div>

        {/* Carousel: padding so first/last card can center; one style prominently visible */}
        <div className="flex flex-col items-center gap-4 overflow-hidden pb-4">
          <div
            className="scrollbar-hide flex w-full snap-x snap-mandatory gap-6 overflow-x-auto overflow-y-hidden py-2"
            onScroll={handleScroll}
            ref={scrollRef}
            style={{
              WebkitOverflowScrolling: 'touch',
              paddingLeft: Math.max(0, (containerWidth - CHOOSE_STYLE_CARD_WIDTH) / 2),
              paddingRight: Math.max(0, (containerWidth - CHOOSE_STYLE_CARD_WIDTH) / 2),
            }}
          >
            {allStyles.map((style, index) => {
              const scale = getScaleForIndex(index)
              const imageUrl = getImageUrl(style)
              const hasImage = Boolean(imageUrl)
              return (
                <button
                  className="flex shrink-0 snap-center snap-always overflow-hidden rounded-sm transition-transform duration-150 ease-out"
                  key={style.id}
                  onClick={() => goTo(index)}
                  style={{
                    height: CHOOSE_STYLE_CARD_HEIGHT,
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                    width: CHOOSE_STYLE_CARD_WIDTH,
                  }}
                  type="button"
                >
                  {hasImage ? (
                    <img
                      alt={style.label}
                      className="size-full object-cover"
                      draggable={false}
                      src={imageUrl}
                    />
                  ) : (
                    <TextStyleVisual mode="preview" styleText={style.styleText} />
                  )}
                </button>
              )
            })}
          </div>

          {/* Style name + "Video style" */}
          {current && (
            <div className="flex w-full flex-col items-center leading-[22px]">
              <p className="text-[18px] font-medium text-white" style={FF_STYLE}>
                {current.label}
              </p>
              <p className="text-[14px] font-normal text-white/50" style={FF_STYLE}>
                Video style
              </p>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex shrink-0 gap-4 px-4 pb-4">
          {isCurrentUserStyle ? (
            <>
              <button
                className="flex h-[38px] flex-1 items-center justify-center rounded-sm bg-[#de4c22] text-[14px] font-medium leading-[17px] text-white"
                onClick={() => {
                  onDeleteUserStyle?.(current.id)
                  onClose(false)
                }}
                style={FF_STYLE}
                type="button"
              >
                Remove style
              </button>
              <button
                className="flex h-[38px] flex-1 items-center justify-center rounded-sm bg-white text-[14px] font-medium leading-[17px] text-black"
                onClick={() => {
                  if (current) {
                    onApply(current)
                  }
                  onClose(false)
                }}
                style={FF_STYLE}
                type="button"
              >
                Apply
              </button>
            </>
          ) : (
            <>
              <button
                className="flex h-[38px] flex-1 items-center justify-center rounded-sm bg-white/10 text-[14px] font-medium leading-[17px] text-white"
                onClick={() => {
                  onAddStyle()
                  onClose(false)
                }}
                style={FF_STYLE}
                type="button"
              >
                Add new style
              </button>
              <button
                className="flex h-[38px] flex-1 items-center justify-center rounded-sm bg-white text-[14px] font-medium leading-[17px] text-black"
                onClick={() => {
                  if (current) {
                    onApply(current)
                  }
                  onClose(false)
                }}
                style={FF_STYLE}
                type="button"
              >
                Apply
              </button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
