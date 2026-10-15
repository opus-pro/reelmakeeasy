'use client'

import { Button, cn, Textarea } from '@shared/ui'
import React from 'react'

import { Image, Loading } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

import { type ReferenceUploadButtonValue } from './ReferenceUploadButton'
import { STORY_MODE_STYLE_IMAGE_FORMAT_LABEL } from './story-mode-style-image'

export type LongTakeStylePickerProps = {
  customStyle: string
  isApplyEnabled?: boolean
  isApplySaving?: boolean
  isGeneratePreviewEnabled?: boolean
  isPreviewGenerating?: boolean
  onApply?: () => void
  onBrowseClick?: () => void
  onClose?: () => void
  onCustomStyleChange: (value: string) => void
  onCustomStyleClear?: () => void
  onGeneratePreview?: () => void
  onStyleImageClear?: () => void
  onStyleImageSelect?: (file: File) => void
  onStyleNameChange: (value: string) => void
  previewImageUrl?: null | string
  styleImageError?: null | string
  styleImageValue?: null | ReferenceUploadButtonValue
  styleInputMode?: 'image' | 'none' | 'preset' | 'text'
  styleName: string
}

export type LongTakeStylePreset = {
  id: string
  label: string
  text: string
  thumbnailUrl?: string
}

const InstructionText = React.memo(function InstructionText() {
  const isMobile = useIsMobile()
  return (
    <p className="text-center text-sm font-medium leading-[17px] text-white/50">
      {isMobile ? (
        <>
          Upload an image as a reference or
          <br />
          enter custom style text
        </>
      ) : (
        'Upload an image as a reference or enter custom style text'
      )}
    </p>
  )
})

const PreviewPanel = React.memo(function PreviewPanel({
  isPreviewGenerating,
  isProcessingImage,
  previewImageUrl,
}: {
  isPreviewGenerating: boolean
  isProcessingImage: boolean
  previewImageUrl: null | string
}) {
  if (isPreviewGenerating || isProcessingImage) {
    return (
      <div className="flex size-full items-center justify-center">
        <Loading className="size-8 animate-spin text-white" />
      </div>
    )
  }
  if (previewImageUrl) {
    return (
      <img
        alt="Style preview"
        className="size-full object-cover object-center"
        src={previewImageUrl}
      />
    )
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <Image className="size-6 text-white/50" />
      <p className="text-center text-sm font-normal leading-[22px] text-white/50">Style preview</p>
    </div>
  )
})

export const LongTakeStylePicker: React.FC<LongTakeStylePickerProps> = ({
  customStyle,
  isApplyEnabled = false,
  isApplySaving = false,
  isGeneratePreviewEnabled = false,
  isPreviewGenerating = false,
  onApply,
  onBrowseClick,
  onClose,
  onCustomStyleChange,
  onCustomStyleClear,
  onGeneratePreview,
  onStyleImageClear,
  onStyleImageSelect,
  onStyleNameChange,
  previewImageUrl = null,
  styleImageError,
  styleImageValue,
  styleInputMode = 'preset',
  styleName,
}) => {
  // On mobile the wrapping studio dialog already shows this instruction in its
  // header, so suppress the duplicate here. Desktop keeps it (its header copy differs).
  const isMobile = useIsMobile()
  const hasImage = styleInputMode === 'image' && Boolean(styleImageValue?.file)
  const isProcessingImage = styleInputMode === 'image' && Boolean(styleImageValue?.isProcessing)
  const isLocked = isPreviewGenerating || isApplySaving || isProcessingImage

  const showUploadArea = !hasImage
  const showUploadedBlock = hasImage

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Content: desktop = horizontal (preview + panel), mobile = vertical stack */}
      <div className="flex gap-4 h-[356px] shrink-0 max-sm:flex-col max-sm:h-auto max-sm:flex-1 max-sm:min-h-0">
        {/* Preview container: desktop 200x356, mobile 100x178 centered */}
        <div className="flex h-[356px] w-[200px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-sm border border-tertiary max-sm:h-[178px] max-sm:w-[100px] max-sm:self-center max-sm:px-2">
          <PreviewPanel
            isPreviewGenerating={isPreviewGenerating}
            isProcessingImage={isProcessingImage}
            previewImageUrl={previewImageUrl}
          />
        </div>

        {/* Right content column (desktop: flex-1 side panel, mobile: stacked below preview) */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 h-full justify-center max-sm:h-auto max-sm:min-h-0">
          {showUploadArea && <UploadZone isLocked={isLocked} onBrowseClick={onBrowseClick} />}
          {showUploadedBlock && (
            <UploadedBlock
              fileName={styleImageValue?.file?.name ?? 'Image'}
              isLocked={isLocked}
              isProcessingImage={isProcessingImage}
              onReplace={onStyleImageClear ? onBrowseClick : undefined}
              previewUrl={styleImageValue?.previewUrl ?? null}
            />
          )}
          {styleImageError && <p className="text-xs text-red-400">{styleImageError}</p>}
          {!isMobile && <InstructionText />}

          {/* Textarea + style name */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <Textarea
                className={cn(
                  'min-h-[76px] flex-1 w-full resize-none rounded-sm border border-tertiary bg-black/15 px-3 py-2 text-sm leading-[22px] text-white placeholder:text-white/25 caret-white hover:border-secondary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring focus:ring-0 focus:outline-none transition-colors max-sm:text-base',
                  isProcessingImage &&
                    'pointer-events-none placeholder:animate-pulse placeholder:text-white/40',
                  isLocked && 'pointer-events-none opacity-50',
                )}
                disabled={isLocked}
                onChange={(value) => onCustomStyleChange(value)}
                placeholder={
                  isProcessingImage
                    ? ''
                    : 'Fast-paced cinematic edit, bold captions, punchy zooms, dramatic lighting…'
                }
                value={isProcessingImage ? '' : customStyle}
              />
              {isProcessingImage && (
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start pt-2 pl-3">
                  <span className="text-sm leading-[22px] text-white/50 animate-pulse">
                    Analyzing image...
                  </span>
                </div>
              )}
            </div>
            <input
              className={cn(
                'h-9.5 w-full rounded-sm border border-tertiary bg-black/15 px-2.5 py-2 text-sm text-white placeholder:text-white/25 caret-white hover:border-secondary focus:border-secondary focus:ring-0 focus:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring transition-colors max-sm:text-base',
                isLocked && 'pointer-events-none opacity-50',
              )}
              disabled={isLocked}
              onChange={(e) => onStyleNameChange(e.target.value)}
              placeholder="Style name"
              value={styleName}
            />
          </div>
        </div>
      </div>

      {/* Footer: swaps between Apply and Generate based on whether current preview is up-to-date */}
      <div className="flex gap-3 items-center pt-4 shrink-0 max-sm:gap-4">
        <div className="flex-1 max-sm:hidden" />
        {isApplyEnabled ? (
          <Button
            className={cn(
              'h-9.5 rounded-sm px-2.5 text-sm font-medium leading-[17px] max-sm:flex-1 disabled:opacity-100',
              isApplySaving || isPreviewGenerating
                ? 'bg-fill-secondary text-white/25'
                : 'bg-white text-black hover:bg-white/90',
            )}
            disabled={isApplySaving || isPreviewGenerating}
            loading={isApplySaving}
            onClick={onApply}
            type="button"
            variant="base"
          >
            Apply
          </Button>
        ) : (
          <Button
            className={cn(
              'h-9.5 rounded-sm px-2.5 text-sm font-medium leading-[17px] max-sm:flex-1 disabled:opacity-100',
              isGeneratePreviewEnabled && !isPreviewGenerating && !isApplySaving
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-fill-secondary text-white/25',
            )}
            disabled={!isGeneratePreviewEnabled || isPreviewGenerating || isApplySaving}
            loading={isPreviewGenerating}
            onClick={onGeneratePreview}
            type="button"
            variant="base"
          >
            Generate
          </Button>
        )}
      </div>
    </div>
  )
}

/* Desktop: centered vertical layout. Mobile: horizontal row (text left + button right) per Figma */
const UploadZone: React.FC<{ isLocked?: boolean; onBrowseClick?: () => void }> = ({
  isLocked,
  onBrowseClick,
}) => (
  <div
    className={cn(
      'flex h-[120px] w-full shrink-0 flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-tertiary max-sm:h-auto max-sm:flex-row max-sm:items-center max-sm:justify-center max-sm:p-4 max-sm:gap-3',
      isLocked ? 'cursor-not-allowed' : 'cursor-pointer',
    )}
    data-testid="style-upload-dropzone"
    onClick={() => {
      if (!isLocked) {
        onBrowseClick?.()
      }
    }}
  >
    <div className="flex flex-col items-center gap-0 text-center max-sm:flex-1 max-sm:items-start max-sm:text-left">
      <p className="text-sm font-medium leading-[17px] text-white">
        <span className="sm:inline max-sm:hidden">Choose a file or drag & drop it here</span>
        <span className="hidden max-sm:inline">Choose a file</span>
      </p>
      <p className="text-xs font-normal leading-[19px] text-white/50">
        {STORY_MODE_STYLE_IMAGE_FORMAT_LABEL}
      </p>
    </div>
    <Button
      className={cn(
        'h-9.5 shrink-0 px-2.5 text-sm font-medium leading-[17px] text-white',
        isLocked && 'cursor-not-allowed',
      )}
      disabled={isLocked}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onBrowseClick?.()
      }}
      type="button"
      variant="default"
    >
      Browse file
    </Button>
  </div>
)

type UploadedBlockProps = {
  fileName: string
  isLocked?: boolean
  isProcessingImage: boolean
  onReplace?: () => void
  previewUrl: null | string
}

const UploadedBlock: React.FC<UploadedBlockProps> = ({
  fileName,
  isLocked,
  isProcessingImage,
  onReplace,
  previewUrl,
}) => (
  <div className="flex gap-4 items-center shrink-0 max-sm:gap-3">
    <div className="size-[80px] shrink-0 overflow-hidden rounded-sm bg-black/20 max-sm:size-9.5">
      {previewUrl ? (
        <img alt="" className="size-full object-cover" src={previewUrl} />
      ) : isProcessingImage ? (
        <div className="flex size-full items-center justify-center">
          <Loading className="size-5 animate-spin text-white/50" />
        </div>
      ) : null}
    </div>
    <div className="flex min-w-0 flex-1 flex-col gap-4 justify-center max-sm:flex-row max-sm:items-center max-sm:gap-3">
      <p className="text-sm font-medium leading-[17px] text-white truncate max-sm:flex-1">
        {fileName}
      </p>
      {onReplace && (
        <Button
          className={cn(
            'h-9.5 w-fit shrink-0 px-2.5 text-sm font-medium leading-[17px]',
            isLocked && 'cursor-not-allowed',
          )}
          disabled={isLocked}
          onClick={(e) => {
            e.preventDefault()
            onReplace()
          }}
          type="button"
          variant="default"
        >
          <span className="sm:inline max-sm:hidden">Replace Image</span>
          <span className="hidden max-sm:inline">Replace</span>
        </Button>
      )}
    </div>
  </div>
)
