'use client'

import { Button, cn } from '@shared/ui'
import Image from 'next/image'
import { useEffect, useRef } from 'react'

export interface ProjectThumbnailStripProps {
  className?: string
  'data-testid'?: string
  items: ThumbnailItem[]
  onSelect: (id: string, index: number) => void
  orientation?: 'horizontal' | 'vertical'
  selectedId?: string
}

export interface ThumbnailItem {
  id: string
  thumbnailUrl?: string
  title?: string
}

const VERTICAL_WRAPPER = 'flex max-h-full flex-col gap-3 overflow-y-auto pb-10 px-px scrollbar-hide'
const HORIZONTAL_WRAPPER = 'flex items-center gap-3 overflow-x-auto scrollbar-hide px-px'

const VERTICAL_MASK_STYLE = {
  maskImage: 'linear-gradient(to bottom, black calc(100% - 39px), transparent calc(100% - 39px))',
}

export function ProjectThumbnailStrip({
  className,
  'data-testid': dataTestId,
  items,
  onSelect,
  orientation = 'vertical',
  selectedId,
}: ProjectThumbnailStripProps) {
  const isVertical = orientation === 'vertical'
  const selectedItemIndex = items.findIndex((item) => item.id === selectedId)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !selectedId || selectedItemIndex === -1) {
      return
    }
    const el = container.querySelector<HTMLElement>(`[data-testid="project-thumb-${selectedId}"]`)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: isVertical ? 'center' : 'nearest',
      inline: 'nearest',
    })
  }, [isVertical, selectedId, selectedItemIndex])

  return (
    <div
      className={cn(isVertical ? VERTICAL_WRAPPER : HORIZONTAL_WRAPPER, className)}
      data-testid={dataTestId}
      ref={scrollRef}
      style={isVertical ? VERTICAL_MASK_STYLE : undefined}
    >
      {items.map((item, index) => {
        const isSelected = item.id === selectedId
        return (
          <Button
            aria-label={item.title || 'Open project'}
            className={cn(
              'relative size-10 shrink-0 overflow-hidden rounded-sm bg-white/10 transition-all',
              isSelected ? 'opacity-100' : 'opacity-30 hover:opacity-80',
            )}
            data-testid={`project-thumb-${item.id}`}
            key={item.id}
            onClick={() => onSelect(item.id, index)}
            type="button"
            variant="base"
          >
            {item.thumbnailUrl ? (
              <Image
                alt={item.title || 'Project thumbnail'}
                className="object-cover"
                fill
                src={item.thumbnailUrl}
              />
            ) : (
              <div className="size-full bg-white/10" />
            )}
          </Button>
        )
      })}
    </div>
  )
}
