'use client'

import { Pause, Play } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from './lib/utils'
import { Input } from './primitives'
import { type VoiceOption } from './VoiceList'

interface VoiceNamingContentProps {
  audioFile: File
  isPlaying?: boolean
  isVoiceLoading?: boolean
  isVoicePlaying?: (voiceId: string) => boolean
  onBack?: () => void
  onContinue?: (voiceName: string) => void
  onPlayPause?: () => void
  onPlayVoice?: (voice: VoiceOption) => Promise<void>
  pause?: () => void
  playingId?: null | string
  previewAudioUrl?: string
  selectedVoiceOption?: VoiceOption
  toggle?: (id: string, url: string) => void
}

export function VoiceNamingContent({
  audioFile,
  onBack,
  onContinue,
  onPlayPause,
  onPlayVoice,
  isPlaying = false,
  isVoiceLoading = false,
  isVoicePlaying,
  pause,
  playingId,
  previewAudioUrl,
  selectedVoiceOption,
  toggle,
}: VoiceNamingContentProps) {
  const [voiceName, setVoiceName] = useState('')
  const audioBlobUrlRef = useRef<null | string>(null)

  const cleanupAudioBlobUrl = useCallback(() => {
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupAudioBlobUrl()
    }
  }, [cleanupAudioBlobUrl])

  const handlePlayPause = useCallback(() => {
    // If we have a selected voice option, use the voice playback handler
    if (selectedVoiceOption && onPlayVoice) {
      onPlayVoice(selectedVoiceOption)
      return
    }

    // Use global audio system for file-based audio
    if (toggle) {
      // Use preview URL if available, otherwise create blob URL from file
      const audioUrl =
        previewAudioUrl ||
        (() => {
          // Cleanup previous audio blob URL if it exists
          cleanupAudioBlobUrl()

          const blobUrl = URL.createObjectURL(audioFile)
          audioBlobUrlRef.current = blobUrl
          return blobUrl
        })()

      // Use a unique ID for this audio file (consistent with VoiceAddDialog)
      const audioId = `upload-${audioFile.name}-${audioFile.size}`
      toggle(audioId, audioUrl)
    }
    // Note: onPlayPause is not called here since we're using global audio system
  }, [audioFile, previewAudioUrl, onPlayVoice, selectedVoiceOption, toggle, cleanupAudioBlobUrl])

  const handleContinue = useCallback(() => {
    if (voiceName.trim()) {
      onContinue?.(voiceName.trim())
    }
  }, [voiceName, onContinue])

  const handleBack = useCallback(() => {
    pause?.()
    cleanupAudioBlobUrl()
    onBack?.()
  }, [onBack, pause, cleanupAudioBlobUrl])

  const isCurrentlyPlaying = (() => {
    // Check if voice clone is playing
    if (selectedVoiceOption && isVoicePlaying?.(selectedVoiceOption.value)) {
      return true
    }

    // Check if file-based audio is playing using global state
    if (playingId && toggle) {
      const audioId = `upload-${audioFile.name}-${audioFile.size}`
      return playingId === audioId
    }

    return false
  })()

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Audio Preview */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <button
            className="flex size-20 items-center justify-center rounded-full transition-colors disabled:opacity-50"
            disabled={isVoiceLoading && !previewAudioUrl && !selectedVoiceOption}
            onClick={handlePlayPause}
            style={{
              background: 'linear-gradient(180deg,#FF765B,#FF9770)',
            }}
            type="button"
          >
            {isCurrentlyPlaying ? (
              <Pause className="size-7 text-primary" fill="currentColor" />
            ) : (
              <Play className="ml-0.5 size-7 text-primary" fill="currentColor" />
            )}
          </button>

          {/* Spinner around play button - only visible during voice processing */}
          {isVoiceLoading && (
            <div className="absolute -inset-2 size-24 animate-spin rounded-full">
              <div className="to-primary size-full rounded-full bg-gradient-to-r from-transparent via-transparent p-0.5">
                <div className="bg-[var(--fill-tertiary)] size-full rounded-full" />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 items-center text-center">
          <p className="text-sm font-medium text-[var(--primary)] max-w-xs truncate">
            {audioFile.name}
          </p>
          <p className="text-xs text-[var(--secondary)]">
            {(audioFile.size / 1024 / 1024).toFixed(2)} MB
          </p>
          {isVoiceLoading && (
            <p className="text-xs text-[var(--secondary)] mt-1">Cloning your voice...</p>
          )}
        </div>
      </div>

      {/* Voice Name Input */}
      <div className="w-full">
        <Input
          className="rounded-xs text-[var(--primary)] bg-[var(--fill-secondary)] h-12 w-full border-none p-3"
          classNames={{
            input:
              'placeholder:text-[var(--secondary)] !text-base caret-[var(--primary)] rounded-none',
          }}
          onChange={(value) => setVoiceName(value)}
          placeholder="Enter voice name"
          type="text"
          value={voiceName}
        />
      </div>

      {/* Terms */}
      <div className="text-[var(--secondary)] text-center text-xs leading-relaxed">
        By continuing, you confirm you have the rights to upload these voice samples, will follow
        the Terms of Service, and will not use generated content for illegal or harmful purposes.
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 items-center justify-end w-full">
        <button
          className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-[var(--fill-secondary)] hover:bg-[var(--fill-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isVoiceLoading}
          onClick={handleBack}
          type="button"
        >
          <span className="text-sm font-medium text-[var(--primary)]">Back</span>
        </button>
        <button
          className={cn(
            'flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm transition-colors',
            voiceName.trim()
              ? 'bg-[var(--accent)] hover:bg-[var(--accent)]/90'
              : 'bg-[var(--accent)] opacity-50 cursor-not-allowed',
          )}
          disabled={!voiceName.trim() || isVoiceLoading}
          onClick={handleContinue}
          type="button"
        >
          <span className="text-sm font-medium text-[var(--primary-foreground)]">Continue</span>
        </button>
      </div>
    </div>
  )
}
