'use client'

import type { CSSProperties, MouseEvent } from 'react'

import { PlaybackIconButton } from '@/components/shared/PlaybackIconButton'

type AudioPlaybackIconButtonProps = {
  disabled?: boolean
  isPlaying?: boolean
  mobileLayout?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  /** Aria label for the pause state; defaults to the voice-preview copy. */
  pauseAriaLabel?: string
  /** Aria label for the play state; defaults to the voice-preview copy. */
  playAriaLabel?: string
  toneColor?: string
}

const DEFAULT_ICON_BACKGROUND = {
  background: 'radial-gradient(90% 90% at 28% 24%, #d8f4ff 0%, #9cc5d8 56%, #789fb5 100%)',
} as const

export function AudioPlaybackIconButton({
  disabled = false,
  isPlaying = false,
  mobileLayout = false,
  onClick,
  pauseAriaLabel = 'Pause selected voice preview',
  playAriaLabel = 'Play selected voice preview',
  toneColor,
}: AudioPlaybackIconButtonProps) {
  const iconBackground: CSSProperties = toneColor
    ? { background: toneColor }
    : DEFAULT_ICON_BACKGROUND

  return (
    <PlaybackIconButton
      ariaLabel={isPlaying ? pauseAriaLabel : playAriaLabel}
      className={mobileLayout ? 'size-6' : 'size-[18px]'}
      disabled={disabled}
      iconClassName={mobileLayout ? '!size-3 !text-white' : '!size-[8.526px] !text-white'}
      isPlaying={isPlaying}
      onClick={onClick}
      style={iconBackground}
    />
  )
}
