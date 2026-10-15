'use client'

import { cn, TransparentImage } from '@shared/ui'
import { MediaCard } from '@shared/ui/artifact-panel'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { CheckMark, Plus } from '@/components/icons/core'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useImageLightbox } from '@/hooks/use-image-lightbox'
import { useIsMobile } from '@/util/browserUtils'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import type { BrandBriefAsset } from '../state-types'

import { useAssetDragDrop } from './useAssetDragDrop'

export interface AssetsSectionProps {
  assets: BrandBriefAsset[]
  disabled: boolean
  onChangeKind: (id: string, kind: BrandBriefAsset['kind']) => void
  onPick: (file: File, kind: BrandBriefAsset['kind']) => Promise<void>
  onRemoveMultiple: (ids: string[]) => void
}

interface AssetGroupRowProps {
  assets: BrandBriefAsset[]
  disabled: boolean
  draggedId: null | string
  draggedKind: BrandBriefAsset['kind'] | null
  dragOverKind: BrandBriefAsset['kind'] | null
  kind: BrandBriefAsset['kind']
  label: string
  makeDragStartHandler: (
    id: string,
    kind: BrandBriefAsset['kind'],
  ) => React.DragEventHandler<HTMLDivElement>
  onDragEnd: React.DragEventHandler<HTMLDivElement>
  onDragLeave: React.DragEventHandler<HTMLDivElement>
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
  onPick: (file: File, kind: BrandBriefAsset['kind']) => Promise<void>
  onToggleSelect: (id: string) => void
  selectedIds: Set<string>
}

interface AssetThumbnailProps {
  asset: BrandBriefAsset
  disabled: boolean
  isDragging: boolean
  onDragEnd: React.DragEventHandler<HTMLDivElement>
  onDragStart: React.DragEventHandler<HTMLDivElement>
  onToggleSelect: () => void
  selected: boolean
  tileStyle?: React.CSSProperties
}

const MOBILE_COLUMNS = 4 // must match the Tailwind 'grid-cols-4' class used on the container
const MOBILE_GAP_PX = 8 // gap-2: 2 * 4px = 8px
const MOBILE_TILE_MIN_PX = 48 // min-w-12: 12 * 4px = 48px

const ASSET_GROUPS: { kind: BrandBriefAsset['kind']; label: string }[] = [
  { kind: 'logo', label: 'Logo' },
  { kind: 'character', label: 'Character' },
  { kind: 'product', label: 'Product and others' },
]

const LABEL_CLASSES = 'text-xs font-medium uppercase tracking-wider text-primary/50'

export function AssetsSection({
  assets,
  disabled,
  onChangeKind,
  onPick,
  onRemoveMultiple,
}: AssetsSectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const {
    draggedId,
    draggedKind,
    dragOverKind,
    handleDragEnd,
    handleDragLeave,
    makeDragOverHandler,
    makeDragStartHandler,
    makeDropHandler,
  } = useAssetDragDrop(onChangeKind)

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) {
        return prev
      }
      const currentIds = new Set(assets.map((a) => a.id))
      const next = new Set([...prev].filter((id) => currentIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [assets])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Project-only removal (assets stay saved in the brand library), so it takes
  // effect immediately with no confirm dialog.
  const handleRemoveSelected = useCallback(() => {
    if (selectedIds.size === 0) {
      return
    }
    onRemoveMultiple([...selectedIds])
    setSelectedIds(new Set())
  }, [onRemoveMultiple, selectedIds])

  const selectedCount = selectedIds.size

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className={LABEL_CLASSES} style={FONT_FEATURE_SETTINGS}>
          Assets
        </span>
        {!disabled && (
          <div className="flex items-center gap-2">
            {/* Always-visible hint doubles as the disabled-button explainer
                (Figma annotation: no tooltip, this persistent text replaces it).
                It is also the only feedback that the count changed, and it sits far from the tile
                checkbox that changes it, so it announces itself rather than waiting to be found. */}
            <span
              aria-live="polite"
              className="flex h-9.5 items-center px-2.5 text-sm font-medium text-primary"
              data-testid="uip-asset-remove-hint"
              role="status"
              style={FONT_FEATURE_SETTINGS}
            >
              {selectedCount === 0
                ? 'Select to remove'
                : `${selectedCount} ${selectedCount === 1 ? 'asset' : 'assets'} selected`}
            </span>
            <button
              aria-label="Remove selected assets"
              className="flex h-9.5 items-center justify-center rounded-[10px] bg-white/10 px-2.5 text-sm font-medium text-primary transition hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-white/10"
              disabled={selectedCount === 0}
              onClick={handleRemoveSelected}
              style={FONT_FEATURE_SETTINGS}
              type="button"
            >
              Remove
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {ASSET_GROUPS.filter(({ kind }) => !disabled || assets.some((a) => a.kind === kind)).map(
          ({ kind, label }) => (
            <AssetGroupRow
              assets={assets.filter((a) => a.kind === kind)}
              disabled={disabled}
              draggedId={draggedId}
              draggedKind={draggedKind}
              dragOverKind={dragOverKind}
              key={kind}
              kind={kind}
              label={label}
              makeDragStartHandler={makeDragStartHandler}
              onDragEnd={handleDragEnd}
              onDragLeave={handleDragLeave}
              onDragOver={makeDragOverHandler(kind)}
              onDrop={makeDropHandler(kind)}
              onPick={onPick}
              onToggleSelect={handleToggleSelect}
              selectedIds={selectedIds}
            />
          ),
        )}
      </div>
    </div>
  )
}

function AssetGroupRow({
  assets,
  disabled,
  draggedId,
  draggedKind,
  dragOverKind,
  onDragEnd,
  kind,
  label,
  makeDragStartHandler,
  onDragLeave,
  onDragOver,
  onDrop,
  onPick,
  onToggleSelect,
  selectedIds,
}: AssetGroupRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const [tileSize, setTileSize] = useState<null | number>(null)
  const isDragging = draggedId !== null
  const isSource = draggedKind === kind
  const isHovered = dragOverKind === kind
  const showSlot = isDragging && !isSource

  // On mobile, measure the grid container and derive a square tile size.
  // Inline style is legitimate here: the value is runtime-computed and
  // cannot be expressed as a Tailwind class.
  // useLayoutEffect so the tile size is committed before the first paint,
  // preventing a one-frame flash with unsized tiles.
  useLayoutEffect(() => {
    if (!isMobile) {
      setTileSize(null)
      return
    }
    const el = containerRef.current
    if (!el) {
      return
    }
    const compute = (width: number) => {
      setTileSize(
        Math.max(
          MOBILE_TILE_MIN_PX,
          Math.floor((width - MOBILE_GAP_PX * (MOBILE_COLUMNS - 1)) / MOBILE_COLUMNS),
        ),
      )
    }
    compute(el.offsetWidth)
    const ro = new ResizeObserver(([entry]) => {
      compute(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile])

  const tileStyle: React.CSSProperties | undefined =
    isMobile && tileSize !== null ? { width: tileSize, height: tileSize } : undefined

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      for (const file of files) {
        void onPick(file, kind)
      }
    },
    [kind, onPick],
  )

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-secondary" style={FONT_FEATURE_SETTINGS}>
        {label}
      </span>
      <div
        className={cn(
          'grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:rounded-sm sm:p-2',
          showSlot && isHovered && 'bg-white/4 outline outline-2 outline-white/25',
          showSlot && !isHovered && 'outline outline-2 outline-dashed outline-white/15',
        )}
        data-testid={`asset-group-row-${kind}`}
        onDragLeave={disabled ? undefined : onDragLeave}
        onDragOver={disabled ? undefined : onDragOver}
        onDrop={disabled ? undefined : onDrop}
        ref={containerRef}
      >
        {!disabled && (
          <div className="relative min-w-12 sm:size-22.5 sm:shrink-0" style={tileStyle}>
            <button
              aria-label={`Add ${label} asset`}
              className="absolute inset-0 flex items-center justify-center rounded-sm border-2 border-dashed border-secondary text-secondary transition-colors hover:border-primary hover:text-primary"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <Plus className="size-6" />
            </button>
          </div>
        )}
        {assets.map((asset) => (
          <AssetThumbnail
            asset={asset}
            disabled={disabled}
            isDragging={draggedId === asset.id}
            key={asset.id}
            onDragEnd={onDragEnd}
            onDragStart={makeDragStartHandler(asset.id, asset.kind)}
            onToggleSelect={() => onToggleSelect(asset.id)}
            selected={selectedIds.has(asset.id)}
            tileStyle={tileStyle}
          />
        ))}
        {showSlot && (
          <div
            className={cn(
              'min-w-12 rounded-sm border-2 border-dashed sm:size-22.5 sm:shrink-0',
              isHovered
                ? 'animate-drop-slot-pulse border-white/60 bg-white/7'
                : 'border-white/22 bg-white/3',
            )}
            data-testid={`asset-drop-slot-${kind}`}
            style={tileStyle}
          />
        )}
      </div>
      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={handleChange}
        ref={fileInputRef}
        type="file"
      />
    </div>
  )
}

function AssetThumbnail({
  asset,
  disabled,
  isDragging,
  onDragEnd,
  onDragStart,
  onToggleSelect,
  selected,
  tileStyle,
}: AssetThumbnailProps) {
  const [failed, setFailed] = useState(false)
  const alt = asset.description ?? ''
  const {
    close: closeLightbox,
    isOpen: isLightboxOpen,
    triggerProps: lightboxTriggerProps,
  } = useImageLightbox(!failed && Boolean(asset.previewUrl))
  useEffect(() => {
    setFailed(false)
  }, [asset.previewUrl])
  if (failed) {
    return null
  }
  return (
    // The span is the flex child once the row wraps, so the unconditional shrink-0 sits here --
    // the tile's own is sm-only, since mobile sizes it from a measured tileStyle instead.
    <span className="inline-flex shrink-0">
      {/* The select checkbox overlays the card as a sibling rather than a child, so it stays clear
          of the card's own frame and interactive surface. The tile carries the expand affordance
          itself: it already contains the checkbox, and a button may not nest another. */}
      <div
        aria-label={lightboxTriggerProps.role ? `Expand ${alt || 'asset'}` : undefined}
        className={cn(
          'group relative min-w-12 sm:size-22.5 sm:shrink-0',
          isDragging && 'opacity-40',
          lightboxTriggerProps.role && 'cursor-zoom-in',
        )}
        draggable={!disabled}
        onDragEnd={disabled ? undefined : onDragEnd}
        onDragStart={disabled ? undefined : onDragStart}
        style={tileStyle}
        {...lightboxTriggerProps}
      >
        <MediaCard aspectRatio={1}>
          <TransparentImage
            alt={alt}
            className="absolute inset-0 size-full object-cover"
            crossOrigin="anonymous"
            draggable={false}
            loading="lazy"
            onError={() => setFailed(true)}
            referrerPolicy="no-referrer"
            src={asset.previewUrl}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/80 to-transparent to-[26%]" />
          {/* Hover brightens the card's border. Layered as an inset ring inside the frame rather
              than restyling MediaCard, whose border is fixed for every surface that shares it.
              An editable tile can be dragged to another kind and selected for removal; a disabled
              one can do neither, so it stays flat. */}
          {!disabled && (
            <div className="pointer-events-none absolute inset-0 rounded-lg opacity-0 ring-1 ring-inset ring-white/30 transition-opacity duration-150 group-hover:opacity-100" />
          )}
        </MediaCard>
        {!disabled && (
          <button
            aria-label={selected ? 'Deselect asset' : 'Select asset'}
            className={cn(
              'absolute right-1 top-1 flex size-4 items-center justify-center rounded border transition-colors',
              selected
                ? 'border-white bg-white'
                : 'border-white/50 bg-transparent hover:border-white',
            )}
            onClick={(event) => {
              // The tile itself opens the lightbox; selecting must not also expand.
              event.stopPropagation()
              onToggleSelect()
            }}
            type="button"
          >
            {selected && <CheckMark className="size-3 text-black" />}
          </button>
        )}
        {isLightboxOpen && asset.previewUrl && (
          // Most assets carry no description, and the tile's own alt is empty because the
          // trigger already names it. Expanded, the image is the dialog's whole content, so
          // it needs a name of its own.
          <ImageLightbox
            alt={alt || `${asset.kind} brand asset`}
            onClose={closeLightbox}
            src={asset.previewUrl}
          />
        )}
      </div>
    </span>
  )
}
