import React from 'react'

import { CrossSmall } from '@/components/icons/core'

interface VoiceDialogHeaderProps {
  context?: 'avatar' | 'voice-clone'
  description?: string
  isRecording: boolean
  /** Shortest recording accepted, in seconds. */
  minSeconds?: number
  onClose?: () => void
  recordingState: 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
  title?: string
}

export function VoiceDialogHeader({
  context = 'avatar',
  isRecording,
  minSeconds = 15,
  onClose,
  recordingState,
  title,
  description,
}: VoiceDialogHeaderProps) {
  const fallbackTitle = isRecording
    ? 'Record your voice'
    : recordingState === 'recorded'
      ? 'Preview your voice'
      : context === 'avatar'
        ? 'Add a voice to your avatar'
        : 'Create voice clone'
  const fallbackDescription = isRecording
    ? `Read the script below and keep speaking for at least ${minSeconds} seconds.`
    : recordingState === 'recorded'
      ? 'Play your audio or upload a new one.'
      : context === 'avatar'
        ? 'Upload audio or select a voice to narrate your video'
        : 'Upload or record your voice to generate a custom voice.'

  return (
    <div className="flex items-start gap-4 shrink-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-lg font-semibold text-primary leading-[21.8px]">
          {title || fallbackTitle}
        </h2>
        <p className="text-sm md:text-xs text-secondary">{description || fallbackDescription}</p>
      </div>
      {onClose && (
        <button
          aria-label="Close"
          className="flex md:hidden size-[38px] shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors md:hover:bg-white/[0.18]"
          onClick={onClose}
          type="button"
        >
          <CrossSmall className="size-[var(--mobile-icon-size)] text-white" />
        </button>
      )}
    </div>
  )
}
