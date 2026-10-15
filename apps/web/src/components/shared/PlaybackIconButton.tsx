import { cn } from '@shared/ui'
import type { CSSProperties } from 'react'

import { Pause, Play } from '@/components/icons/core'

interface PlaybackIconButtonProps {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  iconClassName?: string
  isPlaying?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  style?: CSSProperties
}

/**
 * Pure playback icon button styles extracted from VoiceItem.
 * This component is intentionally stateless and business-agnostic.
 */
export function PlaybackIconButton({
  ariaLabel,
  className,
  disabled = false,
  iconClassName,
  isPlaying = false,
  onClick,
  style,
}: PlaybackIconButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full p-0',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      style={style}
      type="button"
    >
      {isPlaying ? (
        <Pause className={cn('size-3.5 text-white', iconClassName)} />
      ) : (
        <Play className={cn('ml-0.5 size-3.5 text-white', iconClassName)} />
      )}
    </button>
  )
}
