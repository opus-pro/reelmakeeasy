'use client'

import { getGptAcceptAttribute } from '@reelmakeeasy/common/constant/gpt-file-types'
import { Button, cn, toast, Tooltip } from '@shared/ui'
import { useAtomValue } from 'jotai'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { activeAttachmentsAtom, attachmentsAtom } from '@/atom/inputBox'
import { Attachment } from '@/components/icons/core'
import { MAX_FILE_SIZE, MAX_FILE_SIZE_ERROR_MESSAGE } from '@/constants/file'

import { STORY_CARD_SURFACE, type StoryCardSurface } from './story-card-surface'

interface FileUploadButtonProps {
  accept?: string
  className?: string
  disabled?: boolean
  displayMode?: 'compact' | 'story-card'
  icon?: React.ReactNode
  label?: string
  maxFiles?: number
  mobileLayout?: boolean
  onClick?: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  supportingText?: string
  surface?: StoryCardSurface
  tooltipContent?: React.ReactNode
  triggerUploadToken?: number
}

interface StoryCardButtonContentProps {
  assetCount: number
  hasStoryCardAssets: boolean
  icon?: React.ReactNode
  isStoryCardAssetsEmpty: boolean
  label?: string
  latestStoryCardImageUrl: string
  mobileLayout?: boolean
  supportingText?: string
}

interface UseFileUploadValidationParams {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

interface UseUploadTooltipContentParams {
  effectiveMaxFiles?: number
  isMaxReached: boolean
  tooltipContentProp?: React.ReactNode
}

interface UseUploadTriggerParams {
  effectiveDisabled: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  triggerUploadToken?: number
}

// Bottom label of the story-card tile: empty CTA (label + supporting) or the
// uploaded-asset count.
function StoryCardBottomContent({
  assetCount,
  label,
  mobileLayout,
  showEmptyState,
  supportingText,
}: {
  assetCount: number
  label?: string
  mobileLayout: boolean
  showEmptyState: boolean
  supportingText?: string
}) {
  if (showEmptyState) {
    return (
      <span className="mb-0.5 ml-0.5 flex min-h-[27px] max-w-full flex-col items-start">
        <span
          className={cn(
            'font-medium text-white',
            mobileLayout ? 'text-base leading-[20px]' : 'text-xs leading-[15px]',
          )}
        >
          {label ?? 'Assets'}
        </span>
        {supportingText ? (
          <span
            className={cn(
              'font-medium',
              mobileLayout
                ? 'text-sm leading-[17px] text-white/60'
                : 'text-[10px] leading-[12px] text-secondary',
            )}
          >
            {supportingText}
          </span>
        ) : null}
      </span>
    )
  }
  return (
    <span className="mb-0.5 ml-0.5 flex min-h-[27px] max-w-full flex-col items-end">
      <span
        className={cn(
          'font-medium text-white',
          mobileLayout ? 'text-base leading-[20px]' : 'text-xs leading-[15px]',
        )}
      >
        {assetCount} {assetCount === 1 ? 'asset' : 'assets'}
      </span>
    </span>
  )
}

function StoryCardButtonContent({
  assetCount,
  hasStoryCardAssets,
  icon,
  isStoryCardAssetsEmpty,
  label,
  latestStoryCardImageUrl,
  mobileLayout = false,
  supportingText,
}: StoryCardButtonContentProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const backgroundUrl = hasStoryCardAssets ? latestStoryCardImageUrl : ''
  const showBackground = Boolean(backgroundUrl) && hasStoryCardAssets
  const showEmptyState = isStoryCardAssetsEmpty

  useEffect(() => {
    setImageLoaded(false)
  }, [backgroundUrl])

  return (
    <>
      {showBackground ? (
        <>
          {!imageLoaded && (
            <span
              aria-hidden
              className="absolute inset-0 z-0 animate-pulse rounded-xs bg-white/20"
            />
          )}
          <img
            alt={hasStoryCardAssets ? 'Latest uploaded asset preview' : 'Brand asset preview'}
            className={cn(
              'absolute inset-0 z-0 size-full object-cover transition-opacity duration-200',
              imageLoaded ? 'opacity-100' : 'opacity-0',
            )}
            loading="eager"
            onLoad={() => setImageLoaded(true)}
            src={backgroundUrl}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/55 via-black/20 to-black/5"
          />
        </>
      ) : null}
      <span className="relative z-[2] flex size-full flex-col items-start justify-between">
        <span
          className={cn(
            'mt-0.5 ml-0.5 flex items-center justify-center text-white',
            showEmptyState && 'opacity-50',
          )}
        >
          {icon ?? (
            <Attachment
              className={mobileLayout ? 'size-[var(--mobile-icon-size)]' : 'size-[18px]'}
            />
          )}
        </span>
        <StoryCardBottomContent
          assetCount={assetCount}
          label={label}
          mobileLayout={mobileLayout}
          showEmptyState={showEmptyState}
          supportingText={supportingText}
        />
      </span>
    </>
  )
}

function useFileUploadValidation({ fileInputRef, onFileChange }: UseFileUploadValidationParams) {
  const resetInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [fileInputRef])

  const validateFileSizes = useCallback(
    (files: File[]) => {
      const hasOversizedFile = files.some((file) => file.size > MAX_FILE_SIZE)
      if (!hasOversizedFile) {
        return true
      }

      toast.warning(MAX_FILE_SIZE_ERROR_MESSAGE)
      resetInput()
      return false
    },
    [resetInput],
  )

  const handleFileChangeWithValidation = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0 || !validateFileSizes(files)) {
        return
      }

      onFileChange(e)
      resetInput()
    },
    [onFileChange, resetInput, validateFileSizes],
  )

  return { handleFileChangeWithValidation }
}

function useUploadTooltipContent({
  effectiveMaxFiles,
  isMaxReached,
  tooltipContentProp,
}: UseUploadTooltipContentParams) {
  return useMemo(() => {
    if (tooltipContentProp) {
      if (isMaxReached && typeof effectiveMaxFiles === 'number') {
        return `Only ${effectiveMaxFiles} file${effectiveMaxFiles > 1 ? 's' : ''} allowed`
      }
      return tooltipContentProp
    }
    return 'Add photos & files'
  }, [tooltipContentProp, isMaxReached, effectiveMaxFiles])
}

function useUploadTrigger({
  effectiveDisabled,
  fileInputRef,
  triggerUploadToken,
}: UseUploadTriggerParams) {
  const prevTriggerRef = useRef<number | undefined>(undefined)

  React.useEffect(() => {
    if (triggerUploadToken === undefined) {
      return
    }

    const isFirstTrigger = prevTriggerRef.current === undefined
    const isSameTrigger = prevTriggerRef.current === triggerUploadToken
    prevTriggerRef.current = triggerUploadToken

    if (isFirstTrigger || isSameTrigger || effectiveDisabled) {
      return
    }

    fileInputRef.current?.click()
  }, [effectiveDisabled, fileInputRef, triggerUploadToken])
}

export const FileUploadButton = React.forwardRef<HTMLInputElement, FileUploadButtonProps>(
  function FileUploadButton(
    {
      accept,
      className,
      disabled = false,
      displayMode = 'compact',
      icon,
      label,
      maxFiles,
      onFileChange,
      mobileLayout = false,
      surface = 'solid',
      triggerUploadToken,
      supportingText,
      tooltipContent: tooltipContentProp,
      onClick: onClickProp,
    },
    ref,
  ) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const activeAttachments = useAtomValue(activeAttachmentsAtom)
    const attachments = useAtomValue(attachmentsAtom)

    const effectiveMaxFiles = maxFiles
    const isMaxReached =
      typeof effectiveMaxFiles === 'number' && activeAttachments.length >= effectiveMaxFiles

    const effectiveDisabled = disabled || isMaxReached
    const isStoryCard = displayMode === 'story-card'
    const storyCardImageAttachments = useMemo(
      () => attachments.filter((attachment) => attachment.type.startsWith('image/')),
      [attachments],
    )
    const latestStoryCardImageUrl =
      storyCardImageAttachments[storyCardImageAttachments.length - 1]?.url?.trim() || ''
    const hasStoryCardAssets = storyCardImageAttachments.length > 0
    const isStoryCardAssetsEmpty = isStoryCard && !hasStoryCardAssets

    const tooltipContent = useUploadTooltipContent({
      effectiveMaxFiles,
      isMaxReached,
      tooltipContentProp,
    })

    const { handleFileChangeWithValidation } = useFileUploadValidation({
      fileInputRef,
      onFileChange,
    })

    const handleClick = useCallback(
      () => (onClickProp ? onClickProp() : fileInputRef.current?.click()),
      [onClickProp],
    )

    useUploadTrigger({ effectiveDisabled, fileInputRef, triggerUploadToken })

    React.useImperativeHandle(ref, () => fileInputRef.current as HTMLInputElement, [])

    return (
      <>
        <input
          accept={accept ?? getGptAcceptAttribute('all')}
          disabled={effectiveDisabled}
          multiple={typeof maxFiles === 'number' ? maxFiles > 1 : true}
          onChange={handleFileChangeWithValidation}
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
        />

        <Tooltip
          className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1 z-20"
          content={tooltipContent}
          open={isStoryCard ? false : undefined}
          portal
          side="top"
          sideOffset={8}
        >
          <span>
            <Button
              className={cn(
                isStoryCard
                  ? cn(
                      'relative flex h-auto aspect-square md:aspect-[3/4] w-[60px] min-w-[60px] min-h-[60px] flex-col items-start justify-between overflow-hidden rounded-xs p-1 text-left text-white shadow-none transition-colors',
                      STORY_CARD_SURFACE[surface].rest,
                      effectiveDisabled ? '' : STORY_CARD_SURFACE[surface].hover,
                    )
                  : 'size-[38px] min-w-[38px] rounded-full bg-transparent p-0 text-primary transition-colors hover:bg-fill-hover hover:text-primary',
                effectiveDisabled && 'opacity-50',
                isStoryCard && className,
              )}
              disabled={effectiveDisabled}
              onClick={handleClick}
            >
              {isStoryCard ? (
                <StoryCardButtonContent
                  assetCount={storyCardImageAttachments.length}
                  hasStoryCardAssets={hasStoryCardAssets}
                  icon={icon}
                  isStoryCardAssetsEmpty={isStoryCardAssetsEmpty}
                  label={label}
                  latestStoryCardImageUrl={latestStoryCardImageUrl}
                  mobileLayout={mobileLayout}
                  supportingText={supportingText}
                />
              ) : (
                (icon ?? <Attachment className="size-[18px]" />)
              )}
            </Button>
          </span>
        </Tooltip>
      </>
    )
  },
)

export default FileUploadButton
