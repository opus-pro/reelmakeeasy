'use client'

import { cn } from '@shared/ui'
import {
  MediaCard,
  MediaGrid,
  OutdatedCollapsedHeader,
  OutdatedCollapseToggle,
  UpdatedStatusBadge,
} from '@shared/ui/artifact-panel'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { Clock, Expand, Loading, Warning } from '@/components/icons/core'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useImageLightbox } from '@/hooks/use-image-lightbox'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { getPlannerEvents, selectAssetEvent } from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'
import type { AnchorAssetListBlock, AssetRef } from '../state-types'

import { AssetFallbackBackground } from './AssetFallbackBackground'
import { AssetPreviewImage } from './AssetPreviewImage'
import { NON_READY_ASSET_LABEL, type NonReadyAssetStatus, nonReadyAssetStatus } from './assetStatus'
import { assetTypeMeta } from './assetTypeMeta'
import { useCanMentionInComposer } from './useCanMentionInComposer'

interface AnchorAssetListBlockItemProps {
  block: AnchorAssetListBlock
  // When false (the uid_revamp canvas Assets section), the internal title/badge header is
  // suppressed because ArtifactSection owns the title and Updated badge. Defaults to true
  // so the legacy chat timeline is unchanged.
  showHeader?: boolean
  // 'card' (default) is the legacy chat timeline: a boxed grid with each label overlaid on its
  // thumbnail. 'plain' is the uid_revamp canvas mock: no surrounding gray box
  // (ArtifactSection frames it) and each asset's name + type badge sit below its thumbnail.
  variant?: AssetListVariant
}

type AssetListVariant = 'card' | 'plain'

/** Shared so the canvas Assets section's ArtifactSection title matches the block's own header. */
export const ASSETS_DISPLAY_TITLE = 'Assets'

/**
 * Inline style to enforce square tiles because `@tailwindcss/aspect-ratio`
 * can conflict with native `aspect-ratio` behavior in some layouts.
 */
const ASPECT_1_1: CSSProperties = { aspectRatio: '1 / 1' }

export function AnchorAssetListBlockItem({
  block,
  showHeader = true,
  variant = 'card',
}: AnchorAssetListBlockItemProps) {
  const isPlain = variant === 'plain'
  const isOutdated = block.blockStatus === 'outdated'
  const [isCollapsed, setIsCollapsed] = useState(isOutdated)
  const isOutdatedCollapsed = isOutdated && isCollapsed
  const displayTitle = ASSETS_DISPLAY_TITLE

  useEffect(() => {
    setIsCollapsed(isOutdated)
  }, [block.id, isOutdated])

  if (isOutdatedCollapsed) {
    return (
      <section className="w-full overflow-hidden rounded-2xl border border-white/10 p-6">
        <OutdatedCollapsedHeader
          isCollapsed={isCollapsed}
          label={displayTitle}
          onToggle={() => setIsCollapsed((value) => !value)}
        />
      </section>
    )
  }

  const tiles = block.items.map((asset) => (
    <AssetTile
      asset={asset}
      isReadonly={isOutdated}
      key={`anchor-asset-${asset.id}-${asset.type}`}
      variant={variant}
    />
  ))

  return (
    <section
      className={
        isPlain
          ? 'flex w-full flex-col gap-4'
          : isOutdated
            ? 'flex w-full flex-col gap-6 rounded-2xl border border-white/10 p-6'
            : 'flex w-full flex-col gap-6 rounded-2xl border border-transparent bg-white/5 p-6'
      }
      // font-feature-settings inherits, so the stylistic sets reach the shared MediaCard's caption
      // and type badge -- they render the same glyph forms as the surrounding planner text.
      style={FONT_FEATURE_SETTINGS}
    >
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <h3
            className="text-lg font-semibold leading-[21.8px] text-white"
            style={FONT_FEATURE_SETTINGS}
          >
            {displayTitle}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            {block.blockStatus === 'updated' ? <UpdatedStatusBadge /> : null}
            {isOutdated ? (
              <OutdatedCollapseToggle
                isCollapsed={isCollapsed}
                onToggle={() => setIsCollapsed((value) => !value)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {isCollapsed ? null : isPlain ? (
        // The canvas Assets grid packs tiles against the pane width instead of a fixed 5-up. The legacy chat timeline keeps
        // its own dense 5-up grid.
        <MediaGrid aspectRatio={1}>{tiles}</MediaGrid>
      ) : (
        <div className="grid w-full grid-cols-[repeat(5,minmax(0,1fr))] gap-3">{tiles}</div>
      )}
    </section>
  )
}

function AssetTile({
  asset,
  isReadonly,
  variant,
}: {
  asset: AssetRef
  isReadonly: boolean
  variant: AssetListVariant
}) {
  const state = usePlannerState()
  const canMention = useCanMentionInComposer()
  const nonReadyStatus = nonReadyAssetStatus(asset)
  // A tile with no image is a status report, not an asset: mentioning it in chat would attach
  // something the agent cannot read, so it holds its place in the grid without being selectable.
  // The same holds for every tile once the project has no composer to mention into.
  const isSelectable = canMention && !isReadonly && nonReadyStatus === null
  const onSelect = () => getPlannerEvents(state).emit(selectAssetEvent, asset)

  if (variant === 'plain') {
    const { Icon, label: typeLabel } = assetTypeMeta(asset.type)
    return (
      <AssetExpandFrame asset={asset} isSelectable={isSelectable}>
        <MediaCard
          aspectRatio={1}
          caption={asset.label}
          captionMeta={
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3 shrink-0" />
              {typeLabel}
            </span>
          }
          onSelect={isSelectable ? onSelect : undefined}
        >
          <AssetFallbackBackground />
          {nonReadyStatus === null ? (
            // Decorative: MediaCard's caption already carries the label, and it sits inside the same
            // button, so a named image would make the tile announce the label twice.
            <AssetPreviewImage
              alt=""
              className="absolute inset-0 size-full object-cover object-center"
              src={asset.previewUrl}
            />
          ) : (
            <NonReadyAssetOverlay label={asset.label} status={nonReadyStatus} />
          )}
        </MediaCard>
      </AssetExpandFrame>
    )
  }

  return (
    <AssetExpandFrame asset={asset} className="w-full" isSelectable={isSelectable}>
      {/* A selectable tile is a real button, so it gets the tab stop, Enter/Space and focus ring
          natively. A tile that cannot be mentioned -- a status report, a readonly block, or any
          tile once the project has no composer -- is a plain div rather than a disabled
          button, which would still claim a tab stop and announce itself. */}
      {isSelectable ? (
        <button
          className={cn(CARD_TILE_CLASSES, 'cursor-pointer text-left')}
          onClick={onSelect}
          style={ASPECT_1_1}
          type="button"
        >
          <CardTileContent asset={asset} nonReadyStatus={nonReadyStatus} />
        </button>
      ) : (
        <div className={cn(CARD_TILE_CLASSES, 'cursor-default')} style={ASPECT_1_1}>
          <CardTileContent asset={asset} nonReadyStatus={nonReadyStatus} />
        </div>
      )}
    </AssetExpandFrame>
  )
}

/**
 * Wraps a tile in the shared `ImageLightbox`, so an asset can be read at a size the grid never
 * gives it -- the same click-to-expand the brand asset surfaces have.
 *
 * A selectable tile spends its own click on mentioning the asset into the composer, so expanding
 * rides on a badge beside it. A tile with no mention to make -- a readonly block, or any tile once
 * the project has no composer -- has a free click, so the whole tile is the trigger.
 */
function AssetExpandFrame({
  asset,
  children,
  className,
  isSelectable,
}: Readonly<{
  asset: AssetRef
  children: ReactNode
  className?: string
  isSelectable: boolean
}>) {
  // Only a ready asset has an image behind the tile; a status report has nothing to expand into.
  const canExpand = Boolean(asset.previewUrl) && nonReadyAssetStatus(asset) === null
  const { close, isOpen, open, triggerProps } = useImageLightbox(canExpand)
  const tileTriggerProps = isSelectable ? undefined : triggerProps

  return (
    <div
      aria-label={tileTriggerProps?.role ? `Expand ${asset.label}` : undefined}
      className={cn('relative', tileTriggerProps?.role && 'cursor-zoom-in', className)}
      {...tileTriggerProps}
    >
      {children}
      {/* A sibling of the tile rather than a child, since a button may not nest another. */}
      {isSelectable && canExpand ? (
        <button
          aria-label={`Expand ${asset.label}`}
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          onClick={open}
          type="button"
        >
          <Expand aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {isOpen && asset.previewUrl ? (
        // Expanded, the image is the dialog's whole content, so it carries the name the tile's own
        // decorative image does not.
        <ImageLightbox alt={asset.label} onClose={close} src={asset.previewUrl} />
      ) : null}
    </div>
  )
}

const CARD_TILE_CLASSES =
  'relative flex aspect-square justify-self-stretch flex-col items-start justify-end gap-2.5 overflow-hidden rounded-xs bg-white/5 p-2'

/** The card tile's contents, shared by its button and inert forms so the two cannot drift. */
function CardTileContent({
  asset,
  nonReadyStatus,
}: Readonly<{ asset: AssetRef; nonReadyStatus: NonReadyAssetStatus | null }>) {
  return (
    <>
      <AssetFallbackBackground />
      {nonReadyStatus === null ? (
        // Decorative: the tile prints the same label as visible text below, and the tile is the
        // accessible control, so a named image would make it announce the label twice.
        <AssetPreviewImage
          alt=""
          className="absolute inset-0 size-full rounded-xs object-cover object-center"
          src={asset.previewUrl}
        />
      ) : (
        <NonReadyAssetOverlay label={asset.label} status={nonReadyStatus} />
      )}
      <div className="pointer-events-none absolute inset-0 rounded-xs bg-gradient-to-b from-transparent from-[73.689%] to-black/80" />
      <p
        className="relative w-full truncate text-sm leading-[22px] text-white"
        style={FONT_FEATURE_SETTINGS}
      >
        {asset.label}
      </p>
    </>
  )
}

const NON_READY_ICON: Record<NonReadyAssetStatus, typeof Warning> = {
  failed: Warning,
  generating: Loading,
  planned: Clock,
}

/**
 * Stands in for the image a non-ready anchor does not have. Sized and positioned like
 * the preview it replaces so the grid keeps its rhythm rather than reflowing around a gap.
 */
function NonReadyAssetOverlay({ label, status }: { label: string; status: NonReadyAssetStatus }) {
  const Icon = NON_READY_ICON[status]
  const statusLabel = NON_READY_ASSET_LABEL[status]

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
      {/* The tile states the outcome, it does not alarm about it: the section heading above
          already carries the failure, so a grid of failed anchors stays quiet rather than
          repeating that emphasis on every tile. */}
      <Icon aria-hidden className={cn('size-5', status === 'generating' && 'animate-spin')} />
      {/* The visible label is the asset's name over again for a screen reader, so the sr-only
          line beside it carries the whole sentence and this one is hidden from the tree. */}
      <span aria-hidden className="text-xs">
        {statusLabel}
      </span>
      <span className="sr-only">{`${label}: ${statusLabel}`}</span>
    </div>
  )
}
