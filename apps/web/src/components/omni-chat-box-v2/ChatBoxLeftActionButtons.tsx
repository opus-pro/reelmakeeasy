'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import React, { useEffect, useState } from 'react'

import { Color, Image, Loading } from '@/components/icons/core'

import { STORY_CARD_SURFACE, type StoryCardSurface } from './story-card-surface'

export type LongTakeStyleButtonProps = {
  className?: string
  disabled: boolean
  isPreviewGenerating?: boolean
  mobileLayout?: boolean
  onClick: () => void
  styleName?: string
  styleText?: string
  supportingText?: string
  surface?: StoryCardSurface
  thumbnailUrl?: string
  variant?: 'default' | 'story-card'
  visible: boolean
}

const StyleCardBackground = React.memo(function StyleCardBackground({
  hasThumbnail,
  isPreviewGenerating,
  isStyleEmpty,
  thumbnailUrl,
}: {
  hasThumbnail: boolean
  isPreviewGenerating: boolean
  isStyleEmpty: boolean
  thumbnailUrl: string
}) {
  const [imageLoaded, setImageLoaded] = useState(false)

  useEffect(() => {
    setImageLoaded(false)
  }, [thumbnailUrl])

  if (isStyleEmpty) {
    return null
  }

  if (hasThumbnail) {
    return (
      <>
        {!imageLoaded && (
          <span aria-hidden className="absolute inset-0 z-0 animate-pulse rounded-xs bg-white/20" />
        )}
        <img
          alt="Selected style preview"
          className={cn(
            'absolute inset-0 z-0 size-full object-cover transition-opacity duration-200',
            imageLoaded ? 'opacity-100' : 'opacity-0',
          )}
          loading="eager"
          onLoad={() => setImageLoaded(true)}
          src={thumbnailUrl}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/55 via-black/20 to-black/5"
        />
      </>
    )
  }

  if (isPreviewGenerating) {
    return (
      <span
        aria-hidden
        className="absolute inset-0 z-0 flex items-center justify-center rounded-xs bg-white/10"
      >
        <Loading className="size-5 animate-spin text-white" />
      </span>
    )
  }

  return <span aria-hidden className="absolute inset-0 z-0 animate-pulse rounded-xs bg-white/10" />
})

function StyleCardContent({
  hasThumbnail,
  mobileLayout,
  isPreviewGenerating,
  isStyleEmpty,
  styleName,
  styleThumbnailUrl,
  supportingText,
}: {
  hasThumbnail: boolean
  isPreviewGenerating: boolean
  isStyleEmpty: boolean
  mobileLayout: boolean
  styleName?: string
  styleThumbnailUrl: string
  supportingText?: string
}) {
  return (
    <>
      <StyleCardBackground
        hasThumbnail={hasThumbnail}
        isPreviewGenerating={isPreviewGenerating}
        isStyleEmpty={isStyleEmpty}
        thumbnailUrl={styleThumbnailUrl}
      />
      <span className="relative z-[2] flex size-full flex-col items-start justify-between">
        <span
          className={cn(
            'mt-0.5 ml-0.5 flex items-center justify-center text-white',
            isStyleEmpty && 'opacity-50',
          )}
        >
          <Color
            className={cn(
              'shrink-0',
              mobileLayout ? 'size-[var(--mobile-icon-size)]' : 'size-[18px]',
            )}
          />
        </span>
        <StyleCardLabel
          hasThumbnail={hasThumbnail}
          isStyleEmpty={isStyleEmpty}
          mobileLayout={mobileLayout}
          styleName={styleName}
          supportingText={supportingText}
        />
      </span>
    </>
  )
}

// Bottom label of the story-card: empty -> "Style" + supporting text; selected on
// mobile -> the style name (truncated); generating -> "Creating..."; otherwise the
// thumbnail speaks for itself.
function StyleCardLabel({
  hasThumbnail,
  isStyleEmpty,
  mobileLayout,
  styleName,
  supportingText,
}: {
  hasThumbnail: boolean
  isStyleEmpty: boolean
  mobileLayout: boolean
  styleName?: string
  supportingText?: string
}) {
  if (isStyleEmpty) {
    return (
      <span className="mb-0.5 ml-0.5 flex min-h-[27px] max-w-full flex-col items-start">
        <span
          className={cn(
            'font-medium text-white',
            mobileLayout ? 'text-base leading-[20px]' : 'text-xs leading-[15px]',
          )}
        >
          Style
        </span>
        {supportingText ? (
          <span
            className={cn(
              'font-medium',
              mobileLayout
                ? 'text-sm leading-[17px] text-secondary'
                : 'text-[10px] leading-[12px] text-secondary',
            )}
          >
            {supportingText}
          </span>
        ) : null}
      </span>
    )
  }

  if (mobileLayout && styleName?.trim()) {
    return (
      <span className="mb-0.5 w-full truncate text-base font-medium leading-[20px] text-white">
        {styleName}
      </span>
    )
  }

  if (hasThumbnail) {
    return null
  }

  return (
    <span
      className={cn(
        'mb-0.5 ml-0.5 font-medium text-white/50',
        mobileLayout ? 'text-sm' : 'text-[10px] leading-[12px]',
      )}
    >
      Creating...
    </span>
  )
}

export const LongTakeStyleButton: React.FC<LongTakeStyleButtonProps> = ({
  className,
  disabled,
  isPreviewGenerating = false,
  onClick,
  mobileLayout = false,
  styleName,
  styleText,
  supportingText,
  surface = 'solid',
  thumbnailUrl,
  variant = 'default',
  visible,
}) => {
  if (!visible) {
    return null
  }

  const isStoryCard = variant === 'story-card'
  const styleThumbnailUrl = thumbnailUrl?.trim() || ''
  const hasThumbnail = styleThumbnailUrl.length > 0
  const hasStyleText = Boolean(styleText?.trim())
  const isStyleEmpty = !hasThumbnail && !hasStyleText

  return (
    <Tooltip
      align="start"
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
      content="Choose a visual style"
      portal
      side="top"
      sideOffset={8}
      trigger="hover"
    >
      <Button
        className={cn(
          isStoryCard
            ? cn(
                'relative flex h-auto aspect-square md:aspect-[3/4] w-[60px] min-w-[60px] min-h-[60px] flex-col items-start justify-between overflow-hidden rounded-xs p-1 text-left text-white shadow-none transition-colors',
                STORY_CARD_SURFACE[surface].rest,
                disabled ? '' : STORY_CARD_SURFACE[surface].hover,
              )
            : 'h-[38px] min-w-[38px] px-2.5 gap-0 rounded-full flex items-center justify-center font-medium bg-transparent text-sm leading-[17px] transition-colors text-primary md:hover:bg-fill-hover md:hover:text-primary',
          isStoryCard && className,
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {isStoryCard ? (
          <StyleCardContent
            hasThumbnail={hasThumbnail}
            isPreviewGenerating={isPreviewGenerating}
            isStyleEmpty={isStyleEmpty}
            mobileLayout={mobileLayout}
            styleName={styleName}
            styleThumbnailUrl={styleThumbnailUrl}
            supportingText={supportingText}
          />
        ) : (
          <>
            <Image className="size-4.5 shrink-0" />
            <span className="max-sm:hidden">Style</span>
          </>
        )}
      </Button>
    </Tooltip>
  )
}
