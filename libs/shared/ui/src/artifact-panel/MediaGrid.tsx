import type { ReactNode } from 'react'

import { cn } from '../lib/utils'

// Tile-grid sizing. Columns are packed against the GRID's own width (`auto-fill`), not the viewport,
// so the layout stays correct as the artifact pane resizes (two-pane split, mobile tab, zoom) - the
// pane is a sub-column, so viewport breakpoints would be the wrong axis. The min track width is
// derived from the tile aspect ratio (min width = target height x ratio, clamped), so wide tiles pack
// fewer per row and portrait tiles more, keeping tile HEIGHT in a consistent band across ratios.
const TARGET_TILE_HEIGHT = 200
const MIN_TILE_WIDTH = 160
const MAX_TILE_WIDTH = 320

const CARD_BODY = 'flex w-full flex-col gap-2'

/**
 * Responsive grid for media tiles (references, assets, clips), packed by the container width.
 * `aspectRatio` (tile width/height) tunes how many tiles fit per row so their rendered height stays
 * balanced - `1` for square references and assets, the session ratio for clips. `auto-fill` (not
 * `auto-fit`) keeps a sparse row's tiles at their intended size rather than stretching them.
 */
export function MediaGrid({
  aspectRatio = 1,
  children,
}: Readonly<{ aspectRatio?: number; children: ReactNode }>) {
  const minTrack = Math.round(
    Math.min(MAX_TILE_WIDTH, Math.max(MIN_TILE_WIDTH, TARGET_TILE_HEIGHT * aspectRatio)),
  )
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${minTrack}px, 100%), 1fr))` }}
    >
      {children}
    </div>
  )
}

/**
 * One framed media tile with an optional truncated caption, optionally selectable. The media itself
 * is `children`, so a tile can hold an image or a video, and it fills the frame. `aspectRatio` is
 * an inline style (the aspect-ratio Tailwind plugin is disabled repo-wide, so the class form
 * doesn't apply). Passing `onSelect` makes the whole tile a keyboard-reachable button, wrapping
 * both halves so the caption is inside the hit area; without it the tile is a plain figure - the
 * right shape for a tile whose own `children` already hold an interactive control (e.g. a video's
 * click-to-play overlay), where wrapping the whole tile in a button would nest one inside the
 * other. `selected` paints the frame's ring either way, so a caller with its own in-frame toggle
 * (layered into `children`, absolutely positioned) can still show the highlight without `onSelect`.
 */
export function MediaCard({
  aspectRatio = 1,
  caption,
  captionMeta,
  children,
  onSelect,
  selected = false,
}: Readonly<{
  aspectRatio?: number | string
  caption?: string
  captionMeta?: ReactNode
  children: ReactNode
  onSelect?: () => void
  selected?: boolean
}>) {
  if (onSelect) {
    return (
      <button
        aria-pressed={selected}
        className={cn(
          CARD_BODY,
          'cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        onClick={onSelect}
        type="button"
      >
        <MediaCardFrame aspectRatio={aspectRatio} selected={selected}>
          {children}
        </MediaCardFrame>
        <MediaCardCaption as="span" caption={caption} captionMeta={captionMeta} />
      </button>
    )
  }
  return (
    <figure className={CARD_BODY}>
      <MediaCardFrame aspectRatio={aspectRatio} selected={selected}>
        {children}
      </MediaCardFrame>
      <MediaCardCaption as="figcaption" caption={caption} captionMeta={captionMeta} />
    </figure>
  )
}

/** The tile's media well: a positioning context so children can absolutely stack inside it. */
function MediaCardFrame({
  aspectRatio,
  children,
  selected = false,
}: Readonly<{ aspectRatio: number | string; children: ReactNode; selected?: boolean }>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-fill-tertiary',
        selected ? 'border-primary ring-2 ring-primary' : 'border-subtle',
      )}
      style={{ aspectRatio }}
    >
      {children}
    </div>
  )
}

/**
 * The caption half, rendered as `figcaption` under a plain tile and `span` inside a selectable
 * one, where a `figcaption` would be invalid outside a `figure`. Renders nothing at all when there
 * is no name and no meta: an asset with a blank name is as nameless as one with no name, and an
 * empty caption would still reserve a row of text under every tile.
 */
function MediaCardCaption({
  as: Tag,
  caption,
  captionMeta,
}: Readonly<{ as: 'figcaption' | 'span'; caption?: string; captionMeta?: ReactNode }>) {
  const hasCaption = Boolean(caption?.trim())
  // `== null` rather than `=== undefined`: a caller computing meta as `cond ? <Tag/> : null` is as
  // captionless as one omitting it, and would otherwise get the empty row this guard exists to
  // avoid. Loose, so a meta of `0` still renders.
  if (!hasCaption && captionMeta == null) {
    return null
  }
  return (
    <Tag className="flex w-full flex-col gap-0.5">
      {hasCaption ? (
        <span className="truncate text-sm font-medium text-foreground">{caption}</span>
      ) : null}
      {captionMeta}
    </Tag>
  )
}
