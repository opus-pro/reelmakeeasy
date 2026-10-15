'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useEffect, useMemo, useRef, useState } from 'react'

import { TemplateVideoCard } from '@/components/template-card/TemplateVideoCard'
import { useBreakpoint } from '@/util/browserUtils'

import { buildStoryModeDemoGalleryRows } from './story-mode-demo-gallery-layout'

const GAP_MOBILE_PX = 8 // gap-2
const GAP_DESKTOP_PX = 12 // gap-3

type StoryModeDemoProjectsGalleryProps = {
  onTemplateClick: (template: QuickStartTemplate, index: number) => void
  showInputTypeBadge?: boolean
  templates: QuickStartTemplate[]
}

export function StoryModeDemoProjectsGallery({
  onTemplateClick,
  showInputTypeBadge = false,
  templates,
}: StoryModeDemoProjectsGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const { isAboveMd } = useBreakpoint('md')

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const updateWidth = () => {
      setContainerWidth(container.clientWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => {
        window.removeEventListener('resize', updateWidth)
      }
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [])

  // Use useBreakpoint (matchMedia) to match Tailwind's md: breakpoint,
  // which is what drives the gap-2/gap-3 CSS classes on the row wrappers.
  const gap = isAboveMd ? GAP_DESKTOP_PX : GAP_MOBILE_PX

  const rows = useMemo(
    () => buildStoryModeDemoGalleryRows(templates, containerWidth, { gap }),
    [containerWidth, gap, templates],
  )

  return (
    <div className="w-full" ref={containerRef}>
      {rows.length > 0 && (
        <div className="flex w-full flex-col gap-2 md:gap-3">
          {rows.map((row, rowIndex) => {
            // Every row autoplays muted as it enters the viewport. Preview
            // videos are 720p H.264 CRF 28 (~1-2 Mbps), so the per-row
            // bandwidth cost is acceptable across the gallery. Mobile still
            // degrades to lazy-hover via deriveEffectivePreviewMode inside the
            // card so no .mp4 requests fire until tap.
            return (
              <div
                className="flex w-full items-start gap-2 md:gap-3"
                key={`story-mode-row-${rowIndex}`}
              >
                {row.items.map(({ item, originalIndex, width }) => (
                  <div
                    className="shrink-0"
                    key={item.projectId || `story-mode-card-${originalIndex}`}
                    style={{ flexBasis: width, width }}
                  >
                    <TemplateVideoCard
                      aspectRatio={item.aspectRatio || '9:16'}
                      onClickInitialIndex={() => {
                        onTemplateClick(item, originalIndex)
                      }}
                      previewMode="eager-autoplay"
                      showInputTypeBadge={showInputTypeBadge}
                      template={item}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
