'use client'

import { cn, Tooltip } from '@shared/ui'
import { useState } from 'react'

import type { AnchorAssetPromptItem } from './anchor-assets.types'

type AnchorAssetPreviewProps = {
  assets: AnchorAssetPromptItem[]
  className?: string
}

const MAX_PREVIEW_ASPECT_RATIO = 34 / 25
const PREVIEW_HEIGHT = 50
const MAX_PREVIEW_WIDTH = PREVIEW_HEIGHT * MAX_PREVIEW_ASPECT_RATIO

export function AnchorAssetPreview({ assets, className }: AnchorAssetPreviewProps) {
  if (!assets.length) {
    return null
  }

  return (
    <div className={cn('rounded-[20px] bg-white/10 p-6', className)}>
      <div className="flex w-full items-start gap-4">
        <div className="min-w-0 flex-[0_1_auto] py-[3px]">
          <p className="text-[18px] leading-[21.8px] font-semibold text-white">Attached assets</p>
          <p className="text-sm leading-[22px] text-white/50">
            Will be used in the video creation process
          </p>
        </div>
        <div className="min-w-0 w-0 flex-[1_1_0] overflow-x-auto overflow-y-visible pb-2 -mb-2">
          <div className="flex min-w-full w-max items-center gap-2 before:flex-1 before:content-['']">
            {assets.map((asset) => (
              <AnchorAssetPreviewItem asset={asset} key={asset.resourceId} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnchorAssetPreviewItem({ asset }: { asset: AnchorAssetPromptItem }) {
  const [previewWidth, setPreviewWidth] = useState(MAX_PREVIEW_WIDTH)
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isTriggerHovered, setIsTriggerHovered] = useState(false)
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)
  const isHovered = isTriggerHovered || isTooltipHovered

  const tooltipContent = (
    <div
      className="flex max-w-[280px] flex-col items-center gap-2 pb-2"
      onMouseEnter={() => setIsTooltipHovered(true)}
      onMouseLeave={() => setIsTooltipHovered(false)}
    >
      <div className="max-w-full rounded-[8px] bg-[#444444] px-[10px] py-[6px]">
        <p className="text-center text-sm leading-[17px] font-medium text-white break-words">
          {asset.displayName}
        </p>
      </div>
      {imageLoadFailed ? null : (
        <img
          alt={asset.displayName}
          className="select-none h-[140px] w-auto max-w-[280px] rounded-[8px] object-contain"
          onError={() => setImageLoadFailed(true)}
          src={asset.previewUrl}
        />
      )}
    </div>
  )

  return (
    <Tooltip
      className="z-[100] border-0 bg-transparent p-0 shadow-none"
      content={tooltipContent}
      delayDuration={0}
      open={isHovered}
      portal
      side="top"
      sideOffset={0}
    >
      <div
        className="relative h-[50px] shrink-0 cursor-default select-none overflow-hidden rounded-[8px] bg-black/15"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseEnter={() => setIsTriggerHovered(true)}
        onMouseLeave={() => setIsTriggerHovered(false)}
        style={{ width: previewWidth }}
      >
        {!imageLoaded && (
          <span
            aria-hidden
            className="absolute inset-0 z-0 animate-pulse rounded-[8px] bg-white/20"
          />
        )}
        <img
          alt={asset.displayName}
          className={cn(
            'size-full rounded-[8px] object-cover transition-opacity duration-200',
            imageLoaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={(event) => {
            setImageLoaded(true)
            const { naturalHeight, naturalWidth } = event.currentTarget
            if (!naturalHeight || !naturalWidth) {
              return
            }
            const aspectRatio = naturalWidth / naturalHeight
            const nextWidth = Math.min(MAX_PREVIEW_WIDTH, PREVIEW_HEIGHT * aspectRatio)
            setPreviewWidth((previous) => (previous === nextWidth ? previous : nextWidth))
          }}
          src={asset.previewUrl}
          title={asset.displayName}
        />
      </div>
    </Tooltip>
  )
}
