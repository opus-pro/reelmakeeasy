'use client'

import { cn, toast } from '@shared/ui'
import type { CSSProperties, DragEvent, ReactNode, TransitionEvent } from 'react'
import { useMemo, useRef, useState } from 'react'

import { DRAG_PROTOCOLS } from '@/components/dnd/drag-protocol'
import { AddImage, Image, ObjectCube, Plus, User } from '@/components/icons/core'

import {
  isSupportedStoryModeImage,
  STORY_MODE_IMAGE_ACCEPT,
  STORY_MODE_SUPPORTED_FORMATS_LABEL,
} from '../../omni-chat-box-shared/anchor-asset-formats'

import type { AnchorAssetCategory, AnchorAssetPromptItem } from './anchor-assets.types'
import { ANCHOR_ASSET_CATEGORY_LABELS, ANCHOR_ASSET_CATEGORY_ORDER } from './anchor-assets.utils'
import { AnchorAssetCard } from './AnchorAssetCard'
import { AnchorAssetCategoryCard } from './AnchorAssetCategoryCard'

type AnchorAssetsBoxProps = {
  assets: AnchorAssetPromptItem[]
  className?: string
  disabled?: boolean
  maxImageAttachments?: number
  onHoverChange?: (isHovered: boolean) => void
  onRemove?: (asset: AnchorAssetPromptItem) => void
  onSelect?: (asset: AnchorAssetPromptItem) => void
  onUpload: (category: AnchorAssetCategory, files: File[]) => void
}

const categoryIconMap: Record<AnchorAssetCategory, ReactNode> = {
  actor: <User className="size-[18px] text-white" />,
  assets: <AddImage className="size-[18px] text-white" />,
  object: <ObjectCube className="size-[18px] text-white" />,
  logo: <Image className="size-[18px] text-white" />,
}

export function AnchorAssetsBox({
  assets,
  className,
  disabled = false,
  maxImageAttachments = Number.POSITIVE_INFINITY,
  onHoverChange,
  onRemove,
  onSelect,
  onUpload,
}: AnchorAssetsBoxProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isCategoryAnimating, setIsCategoryAnimating] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingCategoryRef = useRef<AnchorAssetCategory>('assets')
  const shouldCollapseOnDragRef = useRef(false)

  const topPreviewAsset = assets[assets.length - 1]

  const categories = useMemo(
    () =>
      ANCHOR_ASSET_CATEGORY_ORDER.map((category) => ({
        category,
        icon: categoryIconMap[category],
        label: ANCHOR_ASSET_CATEGORY_LABELS[category],
      })),
    [],
  )

  const openFilePicker = (category: AnchorAssetCategory) => {
    if (disabled) {
      return
    }
    pendingCategoryRef.current = category
    inputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const allFiles = Array.from(event.target.files || [])
    const files = allFiles.filter(isSupportedStoryModeImage)
    const rejectedCount = allFiles.length - files.length
    if (rejectedCount > 0) {
      toast.error(`Unsupported file format. Please use ${STORY_MODE_SUPPORTED_FORMATS_LABEL}.`)
    }
    if (files.length > 0) {
      onUpload(pendingCategoryRef.current, files)
    }
    event.target.value = ''
  }

  const hasAssets = Boolean(topPreviewAsset)
  const isExpanded = hasAssets && isHovered
  const canUploadMoreImages = assets.length < maxImageAttachments
  const shouldAnimateCategories = hasAssets && canUploadMoreImages && categories.length > 0

  const getViewportClass = ({
    isAnimating,
    isExpanded,
  }: {
    isAnimating: boolean
    isExpanded: boolean
  }) =>
    cn(
      'relative min-w-0 pl-3 pr-3 -ml-3 -mr-3 pb-1 pt-10 -mt-10',
      isExpanded && !isAnimating
        ? 'overflow-x-auto overflow-y-visible [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.35)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/35 [&::-webkit-scrollbar-track]:bg-transparent'
        : 'overflow-x-hidden overflow-y-visible',
    )

  const getCardTransform = ({
    index,
    isExpanded,
    total,
  }: {
    index: number
    isExpanded: boolean
    total: number
  }): CSSProperties => {
    const depth = total - 1 - index
    const collapsedRotate = depth === 0 ? '0deg' : '-9deg'
    const translateX = isExpanded ? index * 70 : 0
    return {
      left: '0px',
      top: '8px',
      zIndex: index + 1,
      transform: `translate3d(${translateX}px, 0, 0) rotate(${isExpanded ? '0deg' : collapsedRotate})`,
      transformOrigin: '50% 50%',
    }
  }

  const handleTrackTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (!isAnimating) {
      return
    }
    if (event.propertyName !== 'transform') {
      return
    }
    const target = event.target as HTMLElement
    if (target.dataset.anchorAssetCard !== 'true') {
      return
    }
    setIsAnimating(false)
  }

  const handleAssetSelect = (asset: AnchorAssetPromptItem) => {
    onSelect?.(asset)
    setIsHovered(false)
    onHoverChange?.(false)
  }

  const handleAssetDrag = () => {
    if (!shouldCollapseOnDragRef.current) {
      return
    }
    shouldCollapseOnDragRef.current = false
    setIsHovered(false)
    onHoverChange?.(false)
  }

  const handleAssetDragStart = (event: DragEvent<HTMLDivElement>, asset: AnchorAssetPromptItem) => {
    event.dataTransfer.setData(
      DRAG_PROTOCOLS.anchorAsset.mime,
      DRAG_PROTOCOLS.anchorAsset.serialize({
        mime: asset.attachment.type,
        previewUrl: asset.previewUrl,
        resourceId: asset.attachment.id || asset.resourceId,
        title: asset.displayName,
      }),
    )
    event.dataTransfer.setData('text/plain', asset.displayName)
    event.dataTransfer.effectAllowed = 'copy'
    shouldCollapseOnDragRef.current = true
  }

  const handleAssetDragEnd = () => {
    shouldCollapseOnDragRef.current = false
  }

  const handleCategoryTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (!isCategoryAnimating) {
      return
    }
    if (event.propertyName !== 'opacity') {
      return
    }
    const target = event.target as HTMLElement
    if (target.dataset.anchorAssetCategoryCard !== 'true') {
      return
    }
    setIsCategoryAnimating(false)
  }

  const content = (
    <div
      className={cn(
        'relative flex min-w-0 items-center',
        hasAssets && 'w-full',
        hasAssets && (isHovered ? 'pr-0' : 'pr-4'),
      )}
    >
      {hasAssets && canUploadMoreImages
        ? categories.map((item) => (
            <div
              aria-hidden={!isHovered}
              className={cn(
                'shrink-0 transition-all duration-200 ease-out',
                isHovered
                  ? 'mr-[10px] opacity-100 translate-x-0 pointer-events-auto'
                  : '-mr-[60px] opacity-0 translate-x-1 pointer-events-none',
              )}
              data-anchor-asset-category-card="true"
              key={item.category}
              onTransitionEnd={handleCategoryTransitionEnd}
            >
              <AnchorAssetCategoryCard
                category={item.category}
                disabled={disabled || !isHovered}
                icon={item.icon}
                label={item.label}
                onClick={openFilePicker}
              />
            </div>
          ))
        : null}

      {hasAssets ? (
        <div className="relative min-w-0 flex-1">
          <div className={getViewportClass({ isAnimating, isExpanded })}>
            <div
              className="relative h-24 shrink-0 overflow-visible transition-[width] duration-200 ease-out"
              onTransitionEnd={handleTrackTransitionEnd}
              style={{ width: isExpanded ? `${assets.length * 70 - 10}px` : '76px' }}
            >
              {assets.map((asset, index) => {
                return (
                  <AnchorAssetCard
                    asset={asset}
                    className="absolute"
                    disabled={disabled}
                    key={asset.attachment.id}
                    onClick={handleAssetSelect}
                    onDrag={handleAssetDrag}
                    onDragEnd={handleAssetDragEnd}
                    onDragStart={handleAssetDragStart}
                    onRemove={onRemove}
                    overlayVisible={isExpanded}
                    showTooltip={isExpanded && !isAnimating && !isCategoryAnimating}
                    style={getCardTransform({ index, isExpanded, total: assets.length })}
                  />
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative h-20 w-0 shrink-0 overflow-visible">
          <div
            aria-hidden={isHovered}
            className={cn(
              'absolute left-0 top-0 h-20 w-[60px] min-w-[60px] rounded-[8px] bg-white/10 p-1.5 hover:bg-white/[0.16] flex flex-col items-start justify-between transition-opacity',
              isHovered ? 'opacity-0 duration-0 pointer-events-none' : 'opacity-100 duration-200',
            )}
          >
            <span className="mt-0.5">{categoryIconMap.assets}</span>
            <span className="flex flex-col items-start pb-0.5 text-left">
              <span className="text-xs font-medium leading-[15px] text-white">Assets</span>
              <span className="text-[10px] leading-[12px] text-white/50">Optional</span>
            </span>
          </div>

          <div className="absolute left-0 top-0 flex">
            {canUploadMoreImages
              ? categories.map((item) => (
                  <div
                    aria-hidden={!isHovered}
                    className={cn(
                      'shrink-0 transition-all duration-200 ease-out',
                      isHovered
                        ? 'mr-[10px] opacity-100 translate-x-0 pointer-events-auto'
                        : '-mr-[60px] opacity-0 translate-x-1 pointer-events-none',
                    )}
                    data-anchor-asset-category-card="true"
                    key={item.category}
                    onTransitionEnd={handleCategoryTransitionEnd}
                  >
                    <AnchorAssetCategoryCard
                      category={item.category}
                      disabled={disabled || !isHovered}
                      icon={item.icon}
                      label={item.label}
                      onClick={openFilePicker}
                    />
                  </div>
                ))
              : null}
          </div>
        </div>
      )}

      {hasAssets && canUploadMoreImages ? (
        <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-24 w-[76px]">
          <div
            className={cn(
              'absolute left-[30px] top-[58px] z-10 flex size-[38px] min-w-[38px] items-center justify-center rounded-full bg-[rgb(129,121,111)] p-0 transition-[transform,opacity] duration-200 ease-out origin-center will-change-transform',
              isExpanded
                ? 'opacity-0 translate-x-[11px] translate-y-[11px] scale-[0.55]'
                : 'opacity-100 translate-x-0 translate-y-0 scale-100',
            )}
          >
            <Plus className="size-[18px] text-primary" />
          </div>
        </div>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn(
        'group/anchor-assets pointer-events-none absolute left-2 right-2 top-2 z-20 flex h-24 items-center p-2 overflow-visible',
        className,
      )}
      data-onboarding-target="anchor-assets"
      data-testid="anchor-assets-box"
    >
      <input
        accept={STORY_MODE_IMAGE_ACCEPT}
        className="hidden"
        data-testid="anchor-assets-file-input"
        disabled={disabled}
        multiple
        onChange={handleFileChange}
        ref={inputRef}
        type="file"
      />

      <div
        className="pointer-events-auto flex w-fit min-w-0 items-center"
        onMouseEnter={() => {
          setIsHovered(true)
          setIsAnimating(hasAssets && assets.length > 1)
          setIsCategoryAnimating(shouldAnimateCategories)
          onHoverChange?.(true)
        }}
        onMouseLeave={() => {
          setIsAnimating(hasAssets && assets.length > 1)
          setIsCategoryAnimating(shouldAnimateCategories)
          setIsHovered(false)
          onHoverChange?.(false)
        }}
      >
        {content}
      </div>
    </div>
  )
}
