'use client'

import {
  OutdatedCollapsedHeader,
  OutdatedCollapseToggle,
  UpdatedStatusBadge,
} from '@shared/ui/artifact-panel'
import { FONT_FEATURE_SETTINGS } from '@shared/ui/constants'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { ChevronDownSmall, ChevronUpSmall } from '@/components/icons/core'

/** One labelled one-liner of the brief ("Visual style" / "Tone" / ...). */
export interface VideoBriefMetaItem {
  label: string
  value: string
}

/** A labelled bullet list of hard requirements ("Must follow" / "MUST NOT VIOLATE"). */
export interface VideoBriefConstraintList {
  items: readonly string[]
  label: string
}

export interface VideoBriefContentProps {
  /** Headline pills above the title - duration, ratio, video type. */
  badges?: readonly string[]
  belowMeta?: ReactNode
  /**
   * Opaque identity of the brief being rendered. Only used to re-collapse when the surface swaps
   * in a different brief; any stable per-brief string does.
   */
  briefId?: string
  /**
   * The compact meta grid, shown before "View more". Omit it to render `expandedMeta` outright
   * with no toggle - there is nothing to expand into.
   */
  compactMeta?: readonly VideoBriefMetaItem[]
  /** Hard requirements, rendered with the expanded meta. Empty lists are dropped. */
  constraints?: readonly VideoBriefConstraintList[]
  /** Initial state of the "View more" toggle. The canvas Summary section opens expanded. */
  defaultExpanded?: boolean
  /** The brief's one-paragraph summary. Always visible (it is the brief in one breath). */
  description?: string
  /** The full meta list, shown after "View more" (or outright when `compactMeta` is omitted). */
  expandedMeta?: readonly VideoBriefMetaItem[]
  /** When true, render flat against the panel background - no card box. */
  flat?: boolean
  freshness?: VideoBriefFreshness
  /** When false, suppress the badge row (headline pills plus the freshness badge / collapse toggle). */
  showBadges?: boolean
  /** When false, suppress the title, for a caller whose own chrome already carries a heading. */
  showTitle?: boolean
  title?: string
}

/**
 * Freshness of the brief relative to the rest of the session. `outdated` renders collapsed behind
 * a header (a superseded brief shouldn't dominate the pane); `updated` shows the freshness badge.
 */
export type VideoBriefFreshness = 'current' | 'outdated' | 'updated'

/**
 * The Summary artifact's content presentation, shared by both authoring canvases. Backend-agnostic
 * by contract: data in, callbacks out, no feature or backend imports, no state, no fetching - each
 * surface maps its own state into these props.
 */
export function VideoBriefContent({
  badges = [],
  belowMeta,
  briefId,
  compactMeta = [],
  constraints = [],
  defaultExpanded = false,
  description,
  expandedMeta = [],
  flat = false,
  freshness = 'current',
  showBadges = true,
  showTitle = true,
  title,
}: VideoBriefContentProps) {
  const isOutdated = freshness === 'outdated'
  const [isCollapsed, setIsCollapsed] = useState(isOutdated)
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  useEffect(() => {
    setIsCollapsed(isOutdated)
  }, [briefId, isOutdated])

  const nonEmptyConstraints = constraints.filter((list) => list.items.length > 0)
  // A caller supplying only one meta list gets it outright, with no dead "View more" button.
  const canExpand =
    compactMeta.length > 0 && (expandedMeta.length > 0 || nonEmptyConstraints.length > 0)
  const showExpanded = isExpanded || compactMeta.length === 0

  return (
    <article
      className={
        isOutdated
          ? 'w-full overflow-hidden rounded-2xl border border-white/10 p-6'
          : flat
            ? 'group relative w-full'
            : 'group relative w-full overflow-hidden rounded-2xl border border-transparent bg-white/5 p-6'
      }
    >
      <div className="flex flex-col gap-6">
        <VideoBriefHeader
          badges={badges}
          description={description}
          freshness={freshness}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((value) => !value)}
          showBadges={showBadges}
          showTitle={showTitle}
          title={title}
        />

        {isCollapsed ? null : (
          <div className="flex flex-col gap-3">
            {showExpanded ? (
              <ExpandedMetaSection constraints={nonEmptyConstraints} items={expandedMeta} />
            ) : (
              <CompactMetaSection items={compactMeta} />
            )}
            {belowMeta}
          </div>
        )}
      </div>

      {isCollapsed || !canExpand ? null : (
        <ExpandToggleButton
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((prev) => !prev)}
        />
      )}
    </article>
  )
}

function CompactMetaSection({ items }: Readonly<{ items: readonly VideoBriefMetaItem[] }>) {
  return (
    <dl className="grid w-full gap-x-4 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
      {items.map((item) => (
        <MetaRow clamp item={item} key={item.label} />
      ))}
    </dl>
  )
}

function ExpandedMetaSection({
  constraints,
  items,
}: Readonly<{
  constraints: readonly VideoBriefConstraintList[]
  items: readonly VideoBriefMetaItem[]
}>) {
  return (
    <dl className="flex w-full flex-col gap-3">
      {items.map((item) => (
        <MetaRow item={item} key={item.label} />
      ))}

      {constraints.map((list) => (
        <div className="min-w-0" key={list.label}>
          <MetaLabel>{list.label}</MetaLabel>
          <dd>
            <ul
              className="mt-1 flex list-disc flex-col gap-1 pl-6 text-body-md text-primary"
              style={FONT_FEATURE_SETTINGS}
            >
              {list.items.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ExpandToggleButton({
  isExpanded,
  onToggle,
}: Readonly<{ isExpanded: boolean; onToggle: () => void }>) {
  return (
    <button
      aria-expanded={isExpanded}
      className="mt-6 inline-flex h-9.5 w-full items-center justify-center rounded-sm border border-white/10 px-2.5 text-label-sm text-primary transition-colors duration-150 ease-out hover:border-white/20 hover:bg-white/10"
      onClick={onToggle}
      style={FONT_FEATURE_SETTINGS}
      type="button"
    >
      {isExpanded ? (
        <>
          <ChevronUpSmall aria-hidden className="mr-1 size-4.5" />
          Collapse
        </>
      ) : (
        <>
          View more
          <ChevronDownSmall aria-hidden className="ml-1 size-4.5" />
        </>
      )}
    </button>
  )
}

// Casing is presentation, not data: the surfaces feeding these labels spell them inconsistently,
// so uppercase here rather than relying on every producer to agree.
function MetaLabel({ children }: Readonly<{ children: string }>) {
  return (
    <dt className="text-label-xs uppercase text-secondary" style={FONT_FEATURE_SETTINGS}>
      {children}
    </dt>
  )
}

/**
 * One labelled row. `clamp` truncates the value at two lines, which the compact grid wants (fixed
 * row height) and the expanded list doesn't (it exists to show the value in full).
 */
function MetaRow({ clamp = false, item }: Readonly<{ clamp?: boolean; item: VideoBriefMetaItem }>) {
  return (
    <div className="min-w-0">
      <MetaLabel>{item.label}</MetaLabel>
      <dd
        className={
          clamp
            ? 'line-clamp-2 text-body-md text-primary'
            : 'whitespace-pre-wrap text-body-md text-primary'
        }
        style={FONT_FEATURE_SETTINGS}
        title={item.value}
      >
        {item.value}
      </dd>
    </div>
  )
}

function VideoBriefHeader({
  badges,
  description,
  freshness,
  isCollapsed,
  onToggleCollapse,
  showBadges,
  showTitle,
  title,
}: Readonly<{
  badges: readonly string[]
  description?: string
  freshness: VideoBriefFreshness
  isCollapsed: boolean
  onToggleCollapse: () => void
  showBadges: boolean
  showTitle: boolean
  title?: string
}>) {
  const isOutdated = freshness === 'outdated'

  if (isOutdated && isCollapsed) {
    return (
      <OutdatedCollapsedHeader
        isCollapsed={isCollapsed}
        label={title ?? ''}
        onToggle={onToggleCollapse}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {showBadges ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Arbitrary caller strings can collide, so the key includes the index. */}
            {badges.map((badge, index) => (
              <span
                className="inline-flex h-5 items-center justify-center rounded-xxs bg-fill-secondary px-1.5 text-label-xs text-primary"
                key={`${index}-${badge}`}
                style={FONT_FEATURE_SETTINGS}
              >
                {badge}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {freshness === 'updated' ? <UpdatedStatusBadge /> : null}
            {isOutdated ? (
              <OutdatedCollapseToggle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
            ) : null}
          </div>
        </div>
      ) : null}

      {showTitle && title ? (
        <h3 className="text-h5 text-primary" style={FONT_FEATURE_SETTINGS}>
          {title}
        </h3>
      ) : null}

      {description ? (
        <p className="text-body-md text-primary" style={FONT_FEATURE_SETTINGS}>
          {description}
        </p>
      ) : null}
    </div>
  )
}
