'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import type { CSSProperties, DragEvent } from 'react'
import { useState } from 'react'

import { CrossSmall } from '@/components/icons/core'

import type { AnchorAssetPromptItem } from './anchor-assets.types'

type AnchorAssetCardProps = {
  asset: AnchorAssetPromptItem
  className?: string
  disabled?: boolean
  onClick?: (asset: AnchorAssetPromptItem) => void
  onDrag?: (asset: AnchorAssetPromptItem) => void
  onDragEnd?: (event: DragEvent<HTMLDivElement>, asset: AnchorAssetPromptItem) => void
  onDragStart?: (event: DragEvent<HTMLDivElement>, asset: AnchorAssetPromptItem) => void
  onRemove?: (asset: AnchorAssetPromptItem) => void
  overlayVisible?: boolean
  showTooltip?: boolean
  style?: CSSProperties
}

export function AnchorAssetCard({
  asset,
  className,
  disabled = false,
  onDrag,
  onDragEnd,
  onClick,
  onDragStart,
  onRemove,
  overlayVisible = false,
  showTooltip = true,
  style,
}: AnchorAssetCardProps) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const isClickable = Boolean(onClick) && !disabled
  const cardContent = (
    <div className="relative h-20 w-[60px] overflow-hidden rounded-[8px] border-2 border-white bg-[rgba(68,68,68,0.50)] p-0">
      {imageLoadFailed ? null : (
        <>
          {!imageLoaded && (
            <span
              aria-hidden
              className="absolute inset-0 z-0 animate-pulse rounded-[8px] bg-white/20"
            />
          )}
          <img
            alt={asset.displayName}
            className={cn(
              'size-full object-cover transition-opacity duration-200',
              imageLoaded ? 'opacity-100' : 'opacity-0',
            )}
            onError={() => {
              setImageLoadFailed(true)
            }}
            onLoad={() => setImageLoaded(true)}
            src={asset.previewUrl}
          />
        </>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[8px] bg-black/0 transition-colors duration-200 ease-out',
          overlayVisible && 'bg-black/30',
        )}
      />
    </div>
  )

  return (
    <div
      className={cn(
        'group/preview-card relative h-20 w-[60px] shrink-0 transition-transform duration-200 ease-out will-change-transform rounded-[8px]',
        isClickable && 'cursor-pointer',
        className,
      )}
      data-anchor-asset-card="true"
      draggable={!disabled}
      onClick={() => {
        if (!isClickable) {
          return
        }
        onClick?.(asset)
      }}
      onDrag={() => {
        if (disabled) {
          return
        }
        onDrag?.(asset)
      }}
      onDragEnd={(event) => {
        if (disabled) {
          return
        }
        onDragEnd?.(event, asset)
      }}
      onDragStart={(event) => {
        if (disabled) {
          return
        }
        onDragStart?.(event, asset)
      }}
      onKeyDown={(event) => {
        if (!isClickable) {
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        onClick?.(asset)
      }}
      role={isClickable ? 'button' : undefined}
      style={style}
      tabIndex={isClickable ? 0 : undefined}
    >
      {showTooltip ? (
        <Tooltip
          className="max-w-[220px] rounded-[8px] bg-[#444444] p-[6px] origin-center zoom-in data-[state=closed]:zoom-out data-[state=open]:duration-150 data-[state=open]:ease-out data-[state=closed]:duration-100 data-[state=closed]:ease-in data-[side=top]:slide-in-from-bottom-0 data-[side=right]:slide-in-from-left-0 data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0"
          content={
            <span className="block text-center text-sm font-medium leading-[17px] break-words text-primary">
              {asset.displayName}
            </span>
          }
          delayDuration={0}
          portal
          side="top"
          sideOffset={8}
        >
          {cardContent}
        </Tooltip>
      ) : (
        cardContent
      )}

      {showTooltip ? (
        <Button
          aria-label={`Remove ${asset.displayName}`}
          className={cn(
            'absolute right-[-6px] top-[-6px] size-5 min-w-5 rounded-full bg-white p-0 transition-opacity duration-200 ease-out',
            'pointer-events-none opacity-0 group-hover/preview-card:pointer-events-auto group-hover/preview-card:opacity-100',
          )}
          disabled={disabled || !onRemove}
          onClick={(event) => {
            event.stopPropagation()
            onRemove?.(asset)
          }}
          variant="secondary"
        >
          <CrossSmall className="size-4 text-black" />
        </Button>
      ) : null}
    </div>
  )
}
