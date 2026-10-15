'use client'

import { Button, cn, toast } from '@shared/ui'
import type { ChangeEvent, DragEvent } from 'react'
import { useRef, useState } from 'react'

import RiveCanvas from '@/components/animated/RiveCanvas'
import { Add, AddImage, CrossSmall, ObjectCube, UserAdd } from '@/components/icons/core'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import {
  isSupportedStoryModeImage,
  STORY_MODE_IMAGE_ACCEPT,
  STORY_MODE_SUPPORTED_FORMATS_LABEL,
} from '../../omni-chat-box-shared/anchor-asset-formats'

import type { AnchorAssetCategory, AnchorAssetPromptItem } from './anchor-assets.types'
import { ANCHOR_ASSET_CATEGORY_ORDER } from './anchor-assets.utils'

const FONT_FEATURE_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const
const STORY_MODE_ASSET_TUTORIAL_RIVE_SRC = getPublicCdnUrl(
  'agent/rive/story_mode_style_animation.riv',
)

const CATEGORY_ADD_LABELS: Record<AnchorAssetCategory, string> = {
  actor: 'Add character',
  assets: 'Add assets',
  logo: 'Add logo',
  object: 'Add object',
}

// Per-category glyph for the mobile filled tiles (the cube has no "add" variant).
const CATEGORY_ICON: Record<AnchorAssetCategory, typeof Add> = {
  actor: UserAdd,
  assets: Add,
  logo: AddImage,
  object: ObjectCube,
}

type AddAssetsDialogProps = {
  assets: AnchorAssetPromptItem[]
  disabled?: boolean
  maxImageAttachments?: number
  mobileLayout?: boolean
  onClose: () => void
  onRemove?: (asset: AnchorAssetPromptItem) => void
  onSelect?: (asset: AnchorAssetPromptItem) => void
  onUpload: (category: AnchorAssetCategory, files: File[]) => void
}

const formatAssetLabel = (displayName: string): string => {
  const normalized = displayName.trim()
  if (!normalized) {
    return 'asset image'
  }
  return `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`
}

export function AddAssetsDialog({
  assets,
  disabled = false,
  maxImageAttachments = Number.POSITIVE_INFINITY,
  mobileLayout = false,
  onClose,
  onRemove,
  onSelect,
  onUpload,
}: AddAssetsDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingCategoryRef = useRef<AnchorAssetCategory>('actor')
  const canUploadMoreImages = assets.length < maxImageAttachments
  // The reference video is a separate slot outside the image budget, so a full
  // image grid must not lock the picker when a video is still addable; image
  // overflow past the cap is still rejected downstream with its own toast.
  const canUpload = !disabled && canUploadMoreImages
  // Which category slot a native-OS file drag is currently hovering, for the highlight cue.
  const [dragOverCategory, setDragOverCategory] = useState<AnchorAssetCategory | null>(null)
  const openPicker = (category: AnchorAssetCategory) => {
    if (!canUpload) {
      return
    }
    pendingCategoryRef.current = category
    inputRef.current?.click()
  }

  // Shared acceptance gate for both the file picker and per-slot drops: keep
  // supported image formats (plus a reference video when allowed), toast on
  // rejects, route to the slot's category.
  const acceptAndUpload = (category: AnchorAssetCategory, candidateFiles: File[]) => {
    const files = candidateFiles.filter((file) => isSupportedStoryModeImage(file))
    const rejectedCount = candidateFiles.length - files.length
    if (rejectedCount > 0) {
      toast.error(`Unsupported file format. Please use ${STORY_MODE_SUPPORTED_FORMATS_LABEL}.`)
    }
    if (files.length > 0) {
      onUpload(category, files)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptAndUpload(pendingCategoryRef.current, Array.from(event.target.files || []))
    event.target.value = ''
  }

  const isNativeFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes('Files')

  const handleSlotDragEnter = (category: AnchorAssetCategory) => (event: DragEvent) => {
    if (!canUpload || !isNativeFileDrag(event)) {
      return
    }
    event.preventDefault()
    setDragOverCategory(category)
  }

  const handleSlotDragOver = (event: DragEvent) => {
    if (!canUpload || !isNativeFileDrag(event)) {
      return
    }
    event.preventDefault()
  }

  const handleSlotDragLeave = (category: AnchorAssetCategory) => (event: DragEvent) => {
    if (!isNativeFileDrag(event)) {
      return
    }
    const related = event.relatedTarget as Node | null
    if (related == null || !event.currentTarget.contains(related)) {
      setDragOverCategory((current) => (current === category ? null : current))
    }
  }

  const handleSlotDrop = (category: AnchorAssetCategory) => (event: DragEvent) => {
    if (!canUpload || !isNativeFileDrag(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setDragOverCategory(null)
    acceptAndUpload(category, Array.from(event.dataTransfer.files))
  }

  const fileInput = (
    <input
      accept={STORY_MODE_IMAGE_ACCEPT}
      className="hidden"
      disabled={disabled || !canUploadMoreImages}
      multiple
      onChange={handleFileChange}
      ref={inputRef}
      type="file"
    />
  )

  if (mobileLayout) {
    return (
      <section className="flex size-full flex-col overflow-hidden rounded-t-2xl bg-panel px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        {fileInput}

        <header className="flex shrink-0 items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2
              className="text-[18px] font-semibold leading-[21.8px] text-white"
              style={FONT_FEATURE_STYLE}
            >
              Add assets
            </h2>
            <p
              className="text-sm font-normal leading-[22px] text-white/50"
              style={FONT_FEATURE_STYLE}
            >
              Upload assets for personalized characters and products in your video
            </p>
          </div>
          <Button
            aria-label="Close add assets"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors active:bg-white/20 md:hover:bg-white/18"
            onClick={onClose}
            size="icon"
            type="button"
            variant="default"
          >
            <CrossSmall className="size-[var(--mobile-icon-size)] text-white" />
          </Button>
        </header>

        <div className="mt-4 grid shrink-0 grid-cols-3 gap-2">
          {ANCHOR_ASSET_CATEGORY_ORDER.map((category) => {
            const Icon = CATEGORY_ICON[category]
            return (
              <Button
                className={cn(
                  'flex h-[100px] w-full min-w-0 flex-col items-start justify-between rounded-3xl bg-white/10 p-3 pb-2.5 text-left transition-colors',
                  disabled || !canUploadMoreImages
                    ? 'cursor-not-allowed opacity-60'
                    : 'active:bg-white/20 md:hover:bg-white/15',
                  dragOverCategory === category && 'bg-white/18',
                )}
                disabled={disabled || !canUploadMoreImages}
                key={category}
                onClick={() => openPicker(category)}
                onDragEnter={handleSlotDragEnter(category)}
                onDragLeave={handleSlotDragLeave(category)}
                onDragOver={handleSlotDragOver}
                onDrop={handleSlotDrop(category)}
                type="button"
                variant="default"
              >
                <Icon className="size-[var(--mobile-icon-size)] text-white/50" />
                <span
                  className="whitespace-normal text-base font-medium leading-[22px] text-white"
                  style={FONT_FEATURE_STYLE}
                >
                  {CATEGORY_ADD_LABELS[category]}
                </span>
              </Button>
            )
          })}
        </div>

        <p
          className="mt-4 shrink-0 text-center text-sm font-normal leading-[22px] text-white/50"
          style={FONT_FEATURE_STYLE}
        >
          Supported formats: {STORY_MODE_SUPPORTED_FORMATS_LABEL}
        </p>

        <div className="-mx-1.5 mt-4 min-h-0 flex-1 overflow-y-auto px-1.5 pt-1.5">
          <div className="grid grid-cols-3 gap-2 pb-2">
            {assets.map((asset) => {
              const isInteractive = !disabled && Boolean(onSelect)
              return (
                <div
                  className="group/asset-card relative flex flex-col items-center gap-2"
                  key={asset.attachment.id}
                >
                  <Button
                    className={cn(
                      'relative aspect-[1/1] h-auto w-full overflow-hidden rounded-sm p-0',
                      isInteractive && 'cursor-pointer',
                    )}
                    onClick={() => onSelect?.(asset)}
                    title={asset.displayName}
                    type="button"
                    variant="ghost"
                  >
                    <img
                      alt={asset.displayName}
                      className="absolute inset-0 size-full object-cover object-center"
                      loading="eager"
                      src={asset.previewUrl}
                    />
                  </Button>
                  <p
                    className="w-full truncate text-center text-xs font-medium leading-[15px] text-white/50"
                    style={FONT_FEATURE_STYLE}
                  >
                    {formatAssetLabel(asset.displayName)}
                  </p>

                  {onRemove ? (
                    <Button
                      aria-label={`Remove ${asset.displayName}`}
                      className="absolute -right-1 -top-1 flex size-[18px] items-center justify-center rounded-full bg-white text-black opacity-0 transition-opacity group-hover/asset-card:opacity-100 focus-visible:opacity-100 group-focus-within/asset-card:opacity-100 [@media(hover:none)]:opacity-100"
                      disabled={disabled}
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemove(asset)
                      }}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <CrossSmall className="size-3" />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex w-full shrink-0">
          <Button
            className="h-12 w-full rounded-full px-6 text-base active:bg-primary/90"
            onClick={onClose}
            type="button"
            variant="primary"
          >
            Apply
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-[571px] w-[884px] max-h-[calc(100dvh-40px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[16px] bg-[rgba(68,68,68,0.5)] backdrop-blur-2xl max-sm:size-full max-sm:max-h-full max-sm:max-w-full max-sm:rounded-3xl">
      {fileInput}

      <header className="relative flex w-full items-center gap-6 px-6 py-5 max-sm:flex-col max-sm:items-start max-sm:gap-0">
        <h2
          className="flex-1 text-[18px] font-semibold leading-[21.8px] text-white max-sm:pr-12"
          style={FONT_FEATURE_STYLE}
        >
          Add assets
        </h2>
        <p
          className="hidden text-sm font-normal leading-[22px] text-white/50 max-sm:block max-sm:pr-12"
          style={FONT_FEATURE_STYLE}
        >
          Upload assets to keep characters, products, and branding consistent. Supported formats:{' '}
          {STORY_MODE_SUPPORTED_FORMATS_LABEL}.
        </p>
        <button
          aria-label="Close add assets"
          className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/[0.18]"
          onClick={onClose}
          type="button"
        >
          <CrossSmall className="size-6 text-white" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-start max-sm:flex-col">
        <div className="flex h-full w-[494px] flex-col items-center overflow-hidden pb-6 max-sm:w-full max-sm:flex-1 max-sm:px-2">
          <h3
            className="mb-1 w-[462px] pl-2 text-xs font-semibold uppercase leading-[15px] tracking-[0.04em] text-white max-sm:hidden"
            style={FONT_FEATURE_STYLE}
          >
            Uploaded assets
          </h3>
          <p
            className="mb-3 w-[462px] pl-2 text-xs font-normal leading-[18px] text-white/50 max-sm:hidden"
            style={FONT_FEATURE_STYLE}
          >
            Supported formats: {STORY_MODE_SUPPORTED_FORMATS_LABEL}
          </p>
          <div className="scrollbar-thin relative w-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-md md:w-[462px]">
            <div className="grid grid-cols-3 pb-5 max-sm:grid-cols-[repeat(2,154px)] max-sm:justify-start max-sm:pb-2">
              {ANCHOR_ASSET_CATEGORY_ORDER.map((category) => (
                <div className="flex flex-col items-center p-2" key={category}>
                  <button
                    className={cn(
                      'flex size-[138px] items-center justify-center rounded-sm border border-dashed border-white/[0.18] bg-[rgba(68,68,68,0.5)] transition-colors',
                      disabled || !canUploadMoreImages
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:bg-white/[0.08]',
                      dragOverCategory === category &&
                        'border-solid border-white/60 bg-white/[0.12]',
                    )}
                    disabled={disabled || !canUploadMoreImages}
                    onClick={() => openPicker(category)}
                    onDragEnter={handleSlotDragEnter(category)}
                    onDragLeave={handleSlotDragLeave(category)}
                    onDragOver={handleSlotDragOver}
                    onDrop={handleSlotDrop(category)}
                    type="button"
                  >
                    <Add className="size-6 text-white/50" />
                  </button>
                  <p
                    className="mt-2 text-center text-xs font-medium leading-[15px] text-white/50"
                    style={FONT_FEATURE_STYLE}
                  >
                    {CATEGORY_ADD_LABELS[category]}
                  </p>
                </div>
              ))}

              {assets.map((asset) => {
                const isInteractive = !disabled && Boolean(onSelect)
                return (
                  <div className="flex flex-col items-center p-2" key={asset.attachment.id}>
                    <div className="group/asset-card relative flex w-full flex-col items-center gap-2 rounded-md p-2 transition-colors hover:bg-white/[0.04]">
                      <button
                        className={cn(
                          'relative size-[138px] overflow-hidden rounded-sm',
                          isInteractive && 'cursor-pointer',
                        )}
                        onClick={() => onSelect?.(asset)}
                        title={asset.displayName}
                        type="button"
                      >
                        <img
                          alt={asset.displayName}
                          className="size-full rounded-sm object-contain object-center"
                          loading="eager"
                          src={asset.previewUrl}
                        />
                        {onRemove ? (
                          <span className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-white/10" />
                        ) : null}
                      </button>
                      <p
                        className="w-full truncate text-center text-xs font-medium leading-[15px] text-white/50"
                        style={FONT_FEATURE_STYLE}
                      >
                        {formatAssetLabel(asset.displayName)}
                      </p>

                      {onRemove ? (
                        <button
                          aria-label={`Remove ${asset.displayName}`}
                          className="absolute right-0 top-0 flex size-[28px] items-center justify-center rounded-full bg-white text-black opacity-0 transition-opacity group-hover/asset-card:opacity-100 focus-visible:opacity-100 group-focus-within/asset-card:opacity-100 [@media(hover:none)]:opacity-100"
                          disabled={disabled}
                          onClick={(event) => {
                            event.stopPropagation()
                            onRemove(asset)
                          }}
                          type="button"
                        >
                          <CrossSmall className="size-6" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-3 hidden w-full shrink-0 justify-end md:flex md:w-[462px] md:pr-1">
            <Button
              className="h-[38px] rounded-sm px-3 text-sm"
              onClick={onClose}
              type="button"
              variant="primary"
            >
              Apply
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start justify-center pb-6 pl-2 pr-6 max-sm:hidden">
          <div className="relative flex h-[493px] w-[358px] flex-col items-center justify-center gap-8 overflow-hidden rounded-md bg-black/25 px-8 py-6">
            <RiveCanvas
              autoplay
              className="absolute inset-0 size-full"
              showLoadingSkeleton={false}
              src={STORY_MODE_ASSET_TUTORIAL_RIVE_SRC}
            />
            <span className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_62%)]" />

            <p
              className="absolute bottom-[102px] left-1/2 z-[2] w-[250px] -translate-x-1/2 text-center text-sm font-medium leading-[17px] text-white/50"
              style={FONT_FEATURE_STYLE}
            >
              Upload assets for personalized characters and products in your video
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default AddAssetsDialog
