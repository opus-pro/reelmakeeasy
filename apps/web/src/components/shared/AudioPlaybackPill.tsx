import { cn } from '@shared/ui'
import React, { forwardRef } from 'react'

import { CrossSmall } from '@/components/icons/core'

import { PlaybackIconButton } from './PlaybackIconButton'

interface AudioPlaybackPillProps {
  className?: string
  disabled?: boolean
  isHighlighted?: boolean
  isPlaying?: boolean
  leftToneColor?: string
  onClick?: () => void
  onClose?: () => void
  onMouseDown?: (e: React.MouseEvent<HTMLSpanElement>) => void
  onMouseUp?: () => void
  onPlayPause?: () => void
  progress?: number
  showClose?: boolean
  textClassName?: string
  title: string
  variant?: 'meta-tag' | 'pill' | 'story-bar'
}

export const AudioPlaybackPill = forwardRef<HTMLSpanElement, AudioPlaybackPillProps>(
  function AudioPlaybackPill(
    {
      className,
      disabled = false,
      isHighlighted = false,
      isPlaying = false,
      leftToneColor,
      onClick,
      onClose,
      onMouseDown,
      onMouseUp,
      onPlayPause,
      progress = 0,
      showClose = false,
      textClassName,
      title,
      variant = 'pill',
    },
    ref,
  ) {
    const isStoryBar = variant === 'story-bar'
    const isMetaTag = variant === 'meta-tag'
    const progressScale = Math.max(Math.min(1, Math.max(0, progress)), isPlaying ? 0.01 : 0)
    const progressTransform = `translateZ(0) scaleX(${progressScale})`
    const iconBackground = leftToneColor
      ? { background: leftToneColor }
      : {
          // Voice icon button base from the design.
          background: 'radial-gradient(90% 90% at 28% 24%, #d8f4ff 0%, #9cc5d8 56%, #789fb5 100%)',
        }

    return (
      <span
        className={cn(
          isStoryBar
            ? 'relative inline-flex h-[38px] min-w-[38px] select-none items-center gap-[6px] overflow-visible rounded-full bg-transparent py-0 pl-[7px] pr-[10px] align-middle'
            : isMetaTag
              ? 'relative inline-flex min-w-0 select-none items-center gap-1 overflow-hidden rounded-[10px] py-0.5 pl-1 pr-1.5 align-middle'
              : 'relative inline-flex h-[38px] min-w-[38px] select-none items-center gap-1.5 overflow-hidden rounded-full py-px pl-[7px] pr-[10px] align-middle',
          !isStoryBar && (isHighlighted ? 'bg-white/[0.16]' : 'bg-white/10'),
          onClick && !disabled ? 'cursor-pointer' : '',
          disabled ? 'cursor-not-allowed opacity-50' : '',
          className,
        )}
        onClick={disabled ? undefined : onClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        ref={ref}
        title={title}
      >
        {progress > 0 && !isStoryBar && !isMetaTag && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-l-full bg-white/[0.15] will-change-transform"
            style={{
              backfaceVisibility: 'hidden',
              transform: progressTransform,
              transformOrigin: 'left center',
            }}
          />
        )}
        {isPlaying && isStoryBar && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.22] will-change-transform"
            style={{
              backfaceVisibility: 'hidden',
              transform: progressTransform,
              transformOrigin: 'left center',
            }}
          />
        )}

        <span className={cn('relative z-10 inline-flex items-center gap-1.5')}>
          <PlaybackIconButton
            ariaLabel={isPlaying ? 'Pause' : 'Play'}
            className={isMetaTag ? 'size-[18px]' : 'size-6'}
            disabled={disabled || !onPlayPause}
            iconClassName={isMetaTag ? '!size-[8.5px] !text-white' : '!size-3 !text-white'}
            isPlaying={isPlaying}
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled) {
                onPlayPause?.()
              }
            }}
            style={iconBackground}
          />

          <span
            className={cn(
              isStoryBar
                ? 'max-w-[190px] truncate text-[14px] font-medium leading-[17px] text-white'
                : isMetaTag
                  ? 'max-w-[180px] truncate text-sm font-normal leading-[22px] text-primary'
                  : 'max-w-[180px] truncate text-sm font-medium leading-[17px] text-primary',
              textClassName,
            )}
          >
            {title}
          </span>

          {showClose && (
            <button
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-primary/80 transition-colors hover:bg-white/20 hover:text-primary"
              onClick={(e) => {
                e.stopPropagation()
                onClose?.()
              }}
              type="button"
            >
              <CrossSmall className="size-4" />
            </button>
          )}
        </span>
      </span>
    )
  },
)
