'use client'

import { Project } from '@shared/types/api/project'
import { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useRouter } from 'next/navigation'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { ArrowRightSmall } from '@/components/icons/core'
import {
  type CardAspectRatio,
  distributeIntoHorizontalRows,
  type HorizontalRowHeight,
  normalizeHorizontalRowHeight,
  PROJECT_CARD_GRID_GAP_PX,
} from '@/components/project-card-grid/layout-utils'
import type { PreviewMode } from '@/components/template-card/template-video-card-constants'
import { TemplateVideoCard } from '@/components/template-card/TemplateVideoCard'
import { SIDEBAR_LOGO_OVERLAP_MARKER_ATTR } from '@/constants/sidebar-logo-overlap'
import { type OverlapAvoidSelector, useSelectorOverlapShift } from '@/hooks/useSelectorOverlap'

export type ProjectCardGridProps = ProjectCardGridFooterActionProps &
  ProjectCardGridHeaderProps &
  ProjectCardGridVisualProps &
  ProjectCardMasonryProps

type GridItem = Project | QuickStartTemplate

type LayoutDirection = 'horizontal' | 'vertical'

type PositionedGridItem = {
  item: GridItem
  originalIndex: number
}

type ProjectCardGridFooterActionProps = {
  viewAllHref?: string
  viewAllLabel?: string
}

type ProjectCardGridHeaderProps = {
  headerLogoOverlapMarker?: string
  headerOverlapAvoidSelectors?: OverlapAvoidSelector[]
  headerSticky?: boolean
  rightContent?: React.ReactNode
  subtitle?: React.ReactNode
  subtitleBottomContent?: React.ReactNode
  subtitleBottomContentContainerClassName?: string
  title?: React.ReactNode
}

type ProjectCardGridViewAllButtonProps = {
  label: string
  onClick: () => void
}

type ProjectCardGridVisualProps = {
  showMasonryBottomOverlay?: boolean
}

type ProjectCardMasonryProps = {
  containerRef?: React.RefObject<HTMLElement | null>
  hideOverflowByMinHeight?: boolean
  horizontalRowHeight?: HorizontalRowHeight
  layoutDirection?: LayoutDirection
  maxColumns?: number
  onTemplateClick?: (template: QuickStartTemplate, index: number) => void
  /**
   * Optional previewMode forwarded to every TemplateVideoCard rendered by this
   * grid. Default (undefined) leaves the card on its own `lazy-hover` default
   * so existing callers keep today's behavior. Demo galleries that want
   * viewport-driven autoplay pass `'eager-autoplay'`.
   */
  previewMode?: PreviewMode
  projects?: Project[]
  showInputTypeBadge?: boolean
  templates: GridItem[]
}

const RATIO_HEIGHT_WEIGHT: Record<CardAspectRatio, number> = {
  '9:16': 16 / 9,
  '1:1': 1,
  '16:9': 9 / 16,
}

const BREAKPOINTS = [
  { min: 1536, cols: 6 },
  { min: 1280, cols: 5 },
  { min: 1024, cols: 4 },
  { min: 768, cols: 3 },
  { min: 0, cols: 2 },
]
const NO_OVERLAP_AVOID_SELECTORS: OverlapAvoidSelector[] = []

export function getColumnCountFromWidth(width: number): number {
  const bp = BREAKPOINTS.find((b) => width >= b.min)
  return bp?.cols ?? 2
}

export const ProjectCardGridSection: React.FC<React.PropsWithChildren> = ({
  children,
}: React.PropsWithChildren) => {
  return <div className="w-full flex flex-col justify-start items-start gap-3">{children}</div>
}

export const ProjectCardGridHeader: React.FC<ProjectCardGridHeaderProps> = ({
  headerLogoOverlapMarker,
  headerOverlapAvoidSelectors,
  headerSticky = false,
  rightContent,
  subtitle,
  subtitleBottomContent,
  subtitleBottomContentContainerClassName,
  title,
}: ProjectCardGridHeaderProps) => {
  const hasTopRowContent = Boolean(title || subtitle || rightContent)
  const hasSubtitleOnly = Boolean(subtitle && !subtitleBottomContent)
  const hasRightContent = Boolean(rightContent)
  const hasSubtitleBottomContent = Boolean(subtitleBottomContent)
  const rightContentRef = useRef<HTMLDivElement>(null)
  const subtitleBottomContentRef = useRef<HTMLDivElement>(null)
  const overlapAvoidSelectors = headerOverlapAvoidSelectors ?? NO_OVERLAP_AVOID_SELECTORS
  const overlapAvoidTargetRef = hasSubtitleBottomContent
    ? subtitleBottomContentRef
    : rightContentRef
  // The empty-header guard must come after the hooks: content props can appear
  // or vanish while mounted (e.g. data arriving after login), and an early
  // return before the hooks changes the rendered hook count (React #310/#300).
  // The overlap hook is inert in the empty case -- `enabled`
  // resolves to false when there is no right/bottom content.
  const overlapAvoidShiftPx = useSelectorOverlapShift(overlapAvoidTargetRef, {
    enabled:
      headerSticky &&
      overlapAvoidSelectors.length > 0 &&
      (hasRightContent || hasSubtitleBottomContent),
    selectors: overlapAvoidSelectors,
  })

  if (!title && !subtitle && !rightContent && !subtitleBottomContent) {
    return null
  }

  const overlapAvoidStyle =
    overlapAvoidShiftPx === 0 ? undefined : { transform: `translateX(${overlapAvoidShiftPx}px)` }
  const overlapMarkerAttr =
    typeof headerLogoOverlapMarker === 'string' && headerLogoOverlapMarker.length > 0
      ? { [SIDEBAR_LOGO_OVERLAP_MARKER_ATTR]: headerLogoOverlapMarker }
      : undefined

  return (
    <div
      className={
        headerSticky
          ? 'w-full flex flex-col gap-[18px] mt-[-6px] py-[6px] mb-[6px] sticky top-14 md:top-0 z-40 bg-background'
          : 'w-full flex flex-col gap-[18px] mt-[-6px] py-[6px] mb-[6px]'
      }
      {...overlapMarkerAttr}
    >
      {hasTopRowContent && (
        <div
          className={
            subtitle
              ? `w-full inline-flex justify-between items-start gap-2.5 overflow-hidden${hasSubtitleOnly ? ' pb-[5px]' : ''}`
              : 'w-full h-16 inline-flex justify-between items-center gap-2.5 overflow-hidden'
          }
        >
          {(title || subtitle) && (
            <div className={subtitle ? 'min-w-0 flex flex-col items-start gap-0' : 'flex-shrink-0'}>
              {title && (
                <div className="justify-start text-2xl font-semibold leading-[28.8px] tracking-[-0.6px] text-white">
                  {title}
                </div>
              )}
              {subtitle && (
                <div className="self-stretch justify-start text-sm font-normal leading-[22px] text-white/50">
                  {subtitle}
                </div>
              )}
            </div>
          )}
          {rightContent && (
            <div
              className={
                subtitle
                  ? 'relative flex min-w-0 items-center self-start'
                  : 'relative flex items-center min-w-0'
              }
              ref={rightContentRef}
              style={hasSubtitleBottomContent ? undefined : overlapAvoidStyle}
            >
              {/* Keep the scrollbar slightly away from content. */}
              <div className="scrollbar-thin mb-[-6px] flex items-center overflow-x-auto pb-[6px] md:overflow-x-visible">
                {rightContent}
              </div>
              <div className="absolute right-0 inset-y-0 w-12 pointer-events-none bg-gradient-to-l from-background to-transparent md:hidden" />
            </div>
          )}
        </div>
      )}
      {subtitleBottomContent && (
        <div
          className={['relative w-full', subtitleBottomContentContainerClassName]
            .filter(Boolean)
            .join(' ')}
          ref={subtitleBottomContentRef}
          style={overlapAvoidStyle}
        >
          {/* Keep the scrollbar slightly away from content. */}
          <div className="scrollbar-thin mb-[-6px] flex items-center overflow-x-auto pb-[6px] md:overflow-x-visible">
            {subtitleBottomContent}
          </div>
          <div className="absolute right-0 inset-y-0 w-12 pointer-events-none bg-gradient-to-l from-background to-transparent md:hidden" />
        </div>
      )}
    </div>
  )
}

export const ProjectCardMasonry: React.FC<ProjectCardMasonryProps> = ({
  containerRef,
  hideOverflowByMinHeight = false,
  horizontalRowHeight,
  layoutDirection = 'vertical',
  maxColumns,
  onTemplateClick,
  previewMode,
  projects,
  showInputTypeBadge = true,
  templates,
}: ProjectCardMasonryProps) => {
  const masonryRef = useRef<HTMLDivElement>(null)
  const [horizontalContainerWidth, setHorizontalContainerWidth] = useState(0)
  const responsiveColumnCount = useColumnCount(containerRef)
  const normalizedMaxColumns =
    typeof maxColumns === 'number' && Number.isFinite(maxColumns)
      ? Math.max(1, Math.floor(maxColumns))
      : undefined
  const columnCount = normalizedMaxColumns
    ? Math.min(responsiveColumnCount, normalizedMaxColumns)
    : responsiveColumnCount
  const normalizedHorizontalRowHeight = useMemo(
    () => normalizeHorizontalRowHeight(horizontalRowHeight),
    [horizontalRowHeight],
  )
  const columnRefs = useRef<Array<HTMLDivElement | null>>([])
  const [clipHeight, setClipHeight] = useState<null | number>(null)

  const { columns } = useMemo(
    () =>
      layoutDirection === 'vertical'
        ? distributeIntoColumns(templates, columnCount)
        : { columns: [], heights: [] },
    [templates, columnCount, layoutDirection],
  )

  const horizontalRows = useMemo(
    () =>
      layoutDirection === 'horizontal'
        ? distributeIntoHorizontalRows(
            templates,
            horizontalContainerWidth,
            normalizedHorizontalRowHeight,
            PROJECT_CARD_GRID_GAP_PX,
          )
        : [],
    [horizontalContainerWidth, layoutDirection, normalizedHorizontalRowHeight, templates],
  )

  const projectById = useMemo(() => {
    const map = new Map<string, Project>()
    projects?.forEach((project) => {
      map.set(project.id, project)
    })
    return map
  }, [projects])

  useEffect(() => {
    if (layoutDirection !== 'horizontal') {
      return
    }

    const observedElement = containerRef?.current ?? masonryRef.current

    if (!observedElement) {
      const onResize = () => {
        setHorizontalContainerWidth(getWindowWidth())
      }
      setHorizontalContainerWidth(getWindowWidth())
      window.addEventListener('resize', onResize)

      return () => {
        window.removeEventListener('resize', onResize)
      }
    }

    const updateWidth = () => {
      setHorizontalContainerWidth(observedElement.offsetWidth)
    }

    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(observedElement)

    return () => {
      observer.disconnect()
    }
  }, [containerRef, layoutDirection])

  useEffect(() => {
    if (layoutDirection !== 'vertical' || !hideOverflowByMinHeight) {
      setClipHeight(null)
      return
    }

    const root = masonryRef.current
    if (!root || columns.length === 0) {
      return
    }

    let frameId: null | number = null

    const measure = () => {
      const rootRect = root.getBoundingClientRect()
      const bottoms = columnRefs.current
        .slice(0, columns.length)
        .map((column) => {
          if (!column || column.children.length === 0) {
            return null
          }
          const lastChild = column.children.item(column.children.length - 1)
          if (!(lastChild instanceof HTMLElement)) {
            return null
          }
          return lastChild.getBoundingClientRect().bottom - rootRect.top
        })
        .filter((value): value is number => value !== null)

      if (bottoms.length === 0) {
        setClipHeight(null)
        return
      }

      const nextClipHeight = Math.min(...bottoms)
      setClipHeight((prev) => {
        if (prev !== null && Math.abs(prev - nextClipHeight) < 0.5) {
          return prev
        }
        return nextClipHeight
      })
    }

    const scheduleMeasure = () => {
      if (frameId !== null) {
        return
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        measure()
      })
    }

    scheduleMeasure()

    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(root)
    columnRefs.current.slice(0, columns.length).forEach((column) => {
      if (column) {
        observer.observe(column)
      }
    })

    return () => {
      observer.disconnect()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [columns, hideOverflowByMinHeight, layoutDirection])

  if (layoutDirection === 'horizontal') {
    return (
      <div
        className="w-full flex flex-col justify-start items-start gap-3 overflow-hidden"
        ref={masonryRef}
      >
        {horizontalRows.map((row, rowIndex) => (
          <div className="w-full flex justify-start items-start gap-3" key={rowIndex}>
            {row.items.map(({ item, originalIndex, width }, indexInRow) => {
              const template = item as QuickStartTemplate
              const templateId = 'projectId' in item ? item.projectId : item.id
              const project = templateId ? projectById.get(templateId) : undefined
              const ratio = template.aspectRatio || '9:16'

              return (
                <div
                  className="shrink-0"
                  key={templateId || `${rowIndex}-${indexInRow}`}
                  style={{ width: `${width}px` }}
                >
                  <TemplateVideoCard
                    aspectRatio={ratio}
                    onClickInitialIndex={() => {
                      onTemplateClick?.(template, originalIndex)
                    }}
                    previewMode={previewMode}
                    project={project}
                    showInputTypeBadge={showInputTypeBadge}
                    template={template}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="w-full flex justify-start items-start gap-3 overflow-hidden"
      ref={masonryRef}
      style={
        hideOverflowByMinHeight && clipHeight !== null
          ? { maxHeight: `${clipHeight}px` }
          : undefined
      }
    >
      {columns.map((column, colIdx) => {
        return (
          <div
            className="flex-1 inline-flex flex-col justify-start items-start gap-3"
            key={colIdx}
            ref={(element) => {
              columnRefs.current[colIdx] = element
            }}
          >
            {column.map(({ item, originalIndex }, indexInColumn) => {
              const template = item as QuickStartTemplate
              const templateId = 'projectId' in item ? item.projectId : item.id
              const project = templateId ? projectById.get(templateId) : undefined
              const ratio = template.aspectRatio || '9:16'

              return (
                <div className="w-full" key={templateId || `${colIdx}-${indexInColumn}`}>
                  <TemplateVideoCard
                    aspectRatio={ratio}
                    onClickInitialIndex={() => {
                      onTemplateClick?.(template, originalIndex)
                    }}
                    previewMode={previewMode}
                    project={project}
                    showInputTypeBadge={showInputTypeBadge}
                    template={template}
                  />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export const ProjectCardGridViewAllButton: React.FC<ProjectCardGridViewAllButtonProps> = ({
  label,
  onClick,
}: ProjectCardGridViewAllButtonProps) => {
  return (
    <button
      className="h-[38px] min-w-[38px] px-2.5 inline-flex justify-center items-center gap-[3px] rounded-sm bg-accent-orange/10 backdrop-blur-[20px] hover:bg-accent-orange/25"
      onClick={onClick}
    >
      <div className="px-0.5 flex justify-start items-center gap-2.5">
        <div className="justify-start text-accent-orange text-sm font-medium leading-[17px]">
          {label}
        </div>
      </div>
      <div className="size-6 flex items-center justify-center">
        <ArrowRightSmall className="size-[18px] text-accent-orange" />
      </div>
    </button>
  )
}

export const ProjectCardGridFooterAction: React.FC<ProjectCardGridFooterActionProps> = ({
  viewAllHref,
  viewAllLabel,
}: ProjectCardGridFooterActionProps) => {
  const router = useRouter()

  if (!viewAllHref || !viewAllLabel) {
    return null
  }

  return (
    <div className="w-full flex flex-col justify-start items-center gap-2.5">
      <ProjectCardGridViewAllButton label={viewAllLabel} onClick={() => router.push(viewAllHref)} />
    </div>
  )
}

const ProjectCardGridImpl: React.FC<ProjectCardGridProps> = ({
  containerRef,
  headerLogoOverlapMarker,
  headerOverlapAvoidSelectors,
  headerSticky,
  hideOverflowByMinHeight,
  horizontalRowHeight,
  layoutDirection = 'vertical',
  maxColumns,
  onTemplateClick,
  previewMode,
  projects,
  rightContent,
  showInputTypeBadge = true,
  showMasonryBottomOverlay = false,
  subtitle,
  subtitleBottomContent,
  subtitleBottomContentContainerClassName,
  templates,
  title,
  viewAllHref,
  viewAllLabel,
}: ProjectCardGridProps) => {
  const hasFooterAction = Boolean(viewAllHref && viewAllLabel)

  return (
    <ProjectCardGridSection>
      <ProjectCardGridHeader
        headerLogoOverlapMarker={headerLogoOverlapMarker}
        headerOverlapAvoidSelectors={headerOverlapAvoidSelectors}
        headerSticky={headerSticky}
        rightContent={rightContent}
        subtitle={subtitle}
        subtitleBottomContent={subtitleBottomContent}
        subtitleBottomContentContainerClassName={subtitleBottomContentContainerClassName}
        title={title}
      />
      <div className="relative w-full">
        <ProjectCardMasonry
          containerRef={containerRef}
          hideOverflowByMinHeight={hideOverflowByMinHeight}
          horizontalRowHeight={horizontalRowHeight}
          layoutDirection={layoutDirection}
          maxColumns={maxColumns}
          onTemplateClick={onTemplateClick}
          previewMode={previewMode}
          projects={projects}
          showInputTypeBadge={showInputTypeBadge}
          templates={templates}
        />
        {showMasonryBottomOverlay && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-[150px] max-h-full bg-gradient-to-b from-[var(--bg-background-transparent)] to-[var(--bg-background)] pointer-events-none" />
        )}
        {hasFooterAction && (
          <div className="absolute inset-x-0 bottom-0 z-30">
            <ProjectCardGridFooterAction viewAllHref={viewAllHref} viewAllLabel={viewAllLabel} />
          </div>
        )}
      </div>
    </ProjectCardGridSection>
  )
}

export const ProjectCardGrid = React.memo(ProjectCardGridImpl)

ProjectCardGrid.displayName = 'ProjectCardGrid'

export function getColumnCountFromWindow(): number {
  return getColumnCountFromWidth(getWindowWidth())
}

export function useColumnCount(containerRef?: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(() =>
    containerRef?.current
      ? getColumnCountFromWidth(containerRef.current.offsetWidth)
      : getColumnCountFromWindow(),
  )

  useEffect(() => {
    const el = containerRef?.current
    if (!el) {
      setCols(getColumnCountFromWindow())
      const onResize = () => setCols(getColumnCountFromWindow())
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }

    const observer = new ResizeObserver(() => {
      setCols(getColumnCountFromWidth(el.offsetWidth))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])

  return cols
}

function distributeIntoColumns(items: GridItem[], columnCount: number) {
  const columns: PositionedGridItem[][] = Array.from({ length: columnCount }, () => [])
  const heights: number[] = new Array(columnCount).fill(0)

  items.forEach((item, originalIndex) => {
    const ratio = item.aspectRatio || '9:16'
    const weight = RATIO_HEIGHT_WEIGHT[ratio]

    let minIdx = 0
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[minIdx]) {
        minIdx = i
      }
    }

    columns[minIdx].push({ item, originalIndex })
    heights[minIdx] += weight
  })

  return { columns, heights }
}

function getWindowWidth(): number {
  if (typeof window === 'undefined') {
    return 1024
  }

  return window.innerWidth
}
