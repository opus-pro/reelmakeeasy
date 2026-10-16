'use client'

import { Button, cn, Textarea } from '@shared/ui'
import React from 'react'

import { Image, Loading, Sparkle } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

import { type ReferenceUploadButtonValue } from './ReferenceUploadButton'
import { STORY_MODE_STYLE_IMAGE_FORMAT_LABEL } from './story-mode-style-image'

export type LongTakeStylePickerProps = {
  customStyle: string
  isApplyEnabled?: boolean
  isApplySaving?: boolean
  isGeneratePreviewEnabled?: boolean
  isPreviewGenerating?: boolean
  /** The AI is writing the title and description from the uploaded image. */
  isWritingWithAi?: boolean
  onApply?: () => void
  onBrowseClick?: () => void
  onClose?: () => void
  onCustomStyleChange: (value: string) => void
  onCustomStyleClear?: () => void
  onGeneratePreview?: () => void
  onStyleImageClear?: () => void
  onStyleImageSelect?: (file: File) => void
  onStyleNameChange: (value: string) => void
  /** Fills the empty title/description from the uploaded image (or rewrites both when filled). */
  onWriteWithAi?: () => void
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
  fitWholeImage = false,
  isPreviewGenerating,
  isProcessingImage,
  previewImageUrl,
}: {
  /** The user's own picture: show all of it (letterboxed) rather than crop it to the tall box. */
  fitWholeImage?: boolean
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
        className={cn('size-full object-center', fitWholeImage ? 'object-contain' : 'object-cover')}
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
  isWritingWithAi = false,
  onApply,
  onBrowseClick,
  onClose,
  onCustomStyleChange,
  onCustomStyleClear,
  onGeneratePreview,
  onStyleImageClear,
  onStyleImageSelect,
  onStyleNameChange,
  onWriteWithAi,
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
  const isLocked = isPreviewGenerating || isApplySaving || isProcessingImage || isWritingWithAi
  // An image style is the user's own picture: show it, and let them name and describe it
  // themselves or have the AI write both.
  const isImageStyle = hasImage
  const panelImageUrl = isImageStyle ? (styleImageValue?.previewUrl ?? null) : previewImageUrl

  const showUploadArea = !hasImage
  const showUploadedBlock = hasImage

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Content: desktop = horizontal (preview + panel), mobile = vertical stack */}
      <div className="flex gap-4 h-[356px] shrink-0 max-sm:flex-col max-sm:h-auto max-sm:flex-1 max-sm:min-h-0">
        {/* Preview container: desktop 200x356, mobile 100x178 centered */}
        <div className="flex h-[356px] w-[200px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-sm border border-tertiary max-sm:h-[178px] max-sm:w-[100px] max-sm:self-center max-sm:px-2">
          <PreviewPanel
            fitWholeImage={isImageStyle}
            isPreviewGenerating={isPreviewGenerating}
            isProcessingImage={isProcessingImage}
            previewImageUrl={panelImageUrl}
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

          <StyleDetailsFields
            customStyle={customStyle}
            isImageStyle={isImageStyle}
            isLocked={isLocked}
            isProcessingImage={isProcessingImage}
            isWritingWithAi={isWritingWithAi}
            onCustomStyleChange={onCustomStyleChange}
            onStyleNameChange={onStyleNameChange}
            styleName={styleName}
          />
        </div>
      </div>

      {/* Footer: swaps between Apply and Generate based on whether current preview is up-to-date */}
      <div className="flex gap-3 items-center pt-4 shrink-0 max-sm:gap-4">
        {isImageStyle && onWriteWithAi ? (
          <WriteWithAiButton
            isLocked={isLocked}
            isWritingWithAi={isWritingWithAi}
            onClick={onWriteWithAi}
          />
        ) : null}
        <div className="flex-1 max-sm:hidden" />
        {isApplyEnabled ? (
          <Button
            className={cn(
              'h-9.5 rounded-sm px-2.5 text-sm font-medium leading-[17px] max-sm:flex-1 disabled:opacity-100',
              isApplySaving || isPreviewGenerating || isWritingWithAi
                ? 'bg-fill-secondary text-white/25'
                : 'bg-white text-black hover:bg-white/90',
            )}
            disabled={isApplySaving || isPreviewGenerating || isWritingWithAi}
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

/** The style's description (textarea) and name, with the AI's in-progress state over them. */
const StyleDetailsFields: React.FC<{
  customStyle: string
  isImageStyle: boolean
  isLocked: boolean
  isProcessingImage: boolean
  isWritingWithAi: boolean
  onCustomStyleChange: (value: string) => void
  onStyleNameChange: (value: string) => void
  styleName: string
}> = ({
  customStyle,
  isImageStyle,
  isLocked,
  isProcessingImage,
  isWritingWithAi,
  onCustomStyleChange,
  onStyleNameChange,
  styleName,
}) => {
  const isBusyWriting = isProcessingImage || isWritingWithAi
  // Typed text stays visible while the AI works; the status shows only over an empty field.
  const showWritingStatus = isProcessingImage || (isWritingWithAi && !customStyle.trim())
  const descriptionPlaceholder = isImageStyle
    ? 'Describe the style, or leave it empty and the AI writes it from your image'
    : 'Fast-paced cinematic edit, bold captions, punchy zooms, dramatic lighting…'
  return (
    // Textarea + style name
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Textarea
          aria-label="Style description"
          className={cn(
            'min-h-[76px] flex-1 w-full resize-none rounded-sm border border-tertiary bg-black/15 px-3 py-2 text-sm leading-[22px] text-white placeholder:text-white/25 caret-white hover:border-secondary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring focus:ring-0 focus:outline-none transition-colors max-sm:text-base',
            isBusyWriting &&
              'pointer-events-none placeholder:animate-pulse placeholder:text-white/40',
            isLocked && 'pointer-events-none opacity-50',
          )}
          disabled={isLocked}
          onChange={(value) => onCustomStyleChange(value)}
          placeholder={showWritingStatus ? '' : descriptionPlaceholder}
          value={isProcessingImage ? '' : customStyle}
        />
        {showWritingStatus && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start pt-2 pl-3">
            <span className="text-sm leading-[22px] text-white/50 animate-pulse">
              {isWritingWithAi ? 'Writing from your image...' : 'Analyzing image...'}
            </span>
          </div>
        )}
      </div>
      <input
        aria-label="Style name"
        className={cn(
          'h-9.5 w-full rounded-sm border border-tertiary bg-black/15 px-2.5 py-2 text-sm text-white placeholder:text-white/25 caret-white hover:border-secondary focus:border-secondary focus:ring-0 focus:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring transition-colors max-sm:text-base',
          isLocked && 'pointer-events-none opacity-50',
        )}
        disabled={isLocked}
        onChange={(e) => onStyleNameChange(e.target.value)}
        placeholder={isImageStyle ? 'Style name (optional, the AI can name it)' : 'Style name'}
        value={styleName}
      />
    </div>
  )
}

const WriteWithAiButton: React.FC<{
  isLocked: boolean
  isWritingWithAi: boolean
  onClick: () => void
}> = ({ isLocked, isWritingWithAi, onClick }) => (
  <Button
    className="h-9.5 gap-1.5 rounded-sm px-2.5 text-sm font-medium leading-[17px] text-white max-sm:flex-1"
    disabled={isLocked}
    loading={isWritingWithAi}
    onClick={onClick}
    type="button"
    variant="default"
  >
    {isWritingWithAi ? null : <Sparkle className="size-4" />}
    Write with AI
  </Button>
)

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
