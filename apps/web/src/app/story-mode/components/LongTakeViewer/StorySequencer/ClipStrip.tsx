'use client'

import { cn } from '@shared/ui'
import { memo, useEffect, useRef } from 'react'

import type { StoryKeyframeSegment } from '@/app/story-mode/long-take.types'
import { useRefCallback } from '@/hooks/use-ref-callback'

interface ClipItemProps {
  clip: StoryKeyframeSegment
  index: number
  isActive: boolean
  isMasked: boolean
  onSeek: (ms: number, shotId: string) => void
  visible: boolean
}

interface ClipStripProps {
  activeIndex: number
  className?: string
  maskedKeyframeIds?: Set<string>
  onSeek: (ms: number, shotId: string) => void
  segments: StoryKeyframeSegment[]
  visible?: boolean
}

const ClipItem = memo(({ clip, index, isActive, isMasked, onSeek, visible }: ClipItemProps) => {
  const handleClick = useRefCallback(() => onSeek(clip.startMs + 0.5, clip.shotId))
  return (
    <div
      className={cn(
        'relative size-9.5 shrink-0 cursor-pointer overflow-hidden rounded-xs transition-[border-color] duration-150 select-none',
        isActive ? 'border-2 border-primary' : 'border-2 border-transparent',
      )}
      onClick={handleClick}
    >
      {visible && (clip.thumbnailUrl || clip.keyframeUrl) ? (
        <img
          alt={`Clip ${index + 1}`}
          className="pointer-events-none absolute inset-0 size-full object-cover [-webkit-user-drag:none]"
          draggable={false}
          loading="lazy"
          src={clip.thumbnailUrl || clip.keyframeUrl}
        />
      ) : (
        <div className="absolute inset-0 bg-fill-secondary" />
      )}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-150',
          isActive ? 'opacity-0' : 'opacity-100 hover:opacity-0',
        )}
      />
      {isMasked && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
          <div
            className="absolute left-1/2 top-1/2 h-2/3 w-[300%] -translate-x-1/2 -translate-y-1/2 opacity-50 blur-sm animate-shimmer-diagonal"
            style={{
              background:
                'linear-gradient(270deg, rgba(255, 255, 255, 0.00) 0%, #FFF 30.81%, #FFF 41%, rgba(255, 255, 255, 0.00) 100%)',
            }}
          />
        </div>
      )}
    </div>
  )
})
ClipItem.displayName = 'ClipItem'

/** Returns only keyframe segments, one per "clip" in the strip. */
const ClipStrip: React.FC<ClipStripProps> = ({
  activeIndex,
  segments,
  onSeek,
  className,
  maskedKeyframeIds,
  visible = true,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragScrollRef = useRef<null | { startScroll: number; startX: number }>(null)
  const didDragStripRef = useRef(false)
  const suppressNextClipClickRef = useRef(false)

  const onSeekFromClip = useRefCallback((ms: number, shotId: string) => {
    if (suppressNextClipClickRef.current) {
      suppressNextClipClickRef.current = false
      return
    }
    onSeek(ms, shotId)
  })

  const onStripPointerDown = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) {
      return
    }
    const el = scrollRef.current
    if (!el) {
      return
    }
    suppressNextClipClickRef.current = false
    didDragStripRef.current = false
    dragScrollRef.current = { startX: e.clientX, startScroll: el.scrollLeft }
  })

  const onStripPointerMove = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragScrollRef.current
    const el = scrollRef.current
    if (!state || !el || e.pointerType === 'touch' || !(e.buttons & 1)) {
      return
    }
    const dx = e.clientX - state.startX
    if (!didDragStripRef.current) {
      if (Math.abs(dx) <= 4) {
        return
      }
      didDragStripRef.current = true
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = state.startScroll - dx
  })

  const onStripPointerUp = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el?.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId)
    }
    dragScrollRef.current = null
    if (didDragStripRef.current) {
      suppressNextClipClickRef.current = true
      didDragStripRef.current = false
    }
  })

  // The trailing keyframe only mirrors the last transition's terminal lastFrame;
  // it has no meaningful playable range, so we omit it from the interactive strip.
  const visibleSegments = segments.length > 1 ? segments.slice(0, -1) : segments
  const visibleActiveIndex =
    visibleSegments.length > 0 ? Math.min(activeIndex, visibleSegments.length - 1) : -1

  // Auto-scroll to center active clip
  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }
    const activeEl = container.children[visibleActiveIndex] as HTMLElement | undefined
    if (!activeEl) {
      return
    }
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [visibleActiveIndex])

  if (visibleSegments.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'relative flex h-9.5 min-w-0 flex-1 items-center overflow-hidden w-full',
        className,
      )}
    >
      <div
        className={cn(
          'flex size-full min-w-0 cursor-grab touch-pan-x select-none items-center gap-1 overflow-x-auto scrollbar-none active:cursor-grabbing',
        )}
        onPointerCancel={onStripPointerUp}
        onPointerDown={onStripPointerDown}
        onPointerMove={onStripPointerMove}
        onPointerUp={onStripPointerUp}
        ref={scrollRef}
        style={{
          scrollbarWidth: 'none',
          paddingLeft: 'calc(50% - 19px)',
          paddingRight: 'calc(50% + 60px)',
          maskImage:
            'linear-gradient(to right, transparent 0, black 38px, black calc(100% - 120px), transparent calc(100% - 80px))',
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0, black 38px, black calc(100% - 120px), transparent calc(100% - 80px))',
        }}
      >
        {visibleSegments.map((clip, i) => (
          <ClipItem
            clip={clip}
            index={i}
            isActive={i === visibleActiveIndex}
            isMasked={maskedKeyframeIds?.has(clip.shotId) ?? false}
            key={clip.shotId}
            onSeek={onSeekFromClip}
            visible={visible}
          />
        ))}
      </div>
    </div>
  )
}

ClipStrip.displayName = 'ClipStrip'

export default memo(ClipStrip)
