'use client'
import Dialog from '@shared/ui/dialog'
import { cn } from '@shared/ui/lib/utils'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import LottieCanvas from '@/components/animated/LottieCanvas'
import { CrossSmall, Info, Pause, Play } from '@/components/icons/core'
import { Button, Input } from '@/components/ui/kit'
import { useBreakpoint } from '@/util/browserUtils'

import { type VoiceOption } from '../components/voice-over-selection'

interface VoicePreviewDialogProps {
  audioFile: File | null
  dialogContentClassName?: string
  dialogOverlayClassName?: string
  isSavingVoice?: boolean
  isVoiceLoading?: boolean
  isVoicePlaying?: (voiceId: string) => boolean
  onBack?: () => void
  onClose?: () => void
  onContinue?: (voiceName: string) => void
  onPlayVoice?: (voice: VoiceOption) => Promise<void>
  open: boolean
  pause?: () => void
  playingId?: null | string
  previewAudioUrl?: string
  selectedVoiceOption?: VoiceOption
  toggle?: (id: string, url: string) => void
}

interface VoicePreviewFooterProps {
  isBelowMd: boolean
  isBusy: boolean
  onBack: () => void
  onContinue: () => void
  voiceName: string
}

export function VoicePreviewDialog({
  audioFile,
  dialogContentClassName,
  dialogOverlayClassName,
  isVoiceLoading = false,
  isSavingVoice = false,
  isVoicePlaying,
  onBack,
  onClose,
  onContinue,
  onPlayVoice,
  open,
  pause,
  playingId,
  previewAudioUrl,
  selectedVoiceOption,
  toggle,
}: VoicePreviewDialogProps) {
  const [voiceName, setVoiceName] = useState('')
  const audioBlobUrlRef = useRef<null | string>(null)
  const isProcessingRef = useRef(false)
  const isBusy = isVoiceLoading || isSavingVoice
  const isSuccessState = Boolean(selectedVoiceOption) && !isVoiceLoading && !isSavingVoice
  const dialogTitle = isVoiceLoading
    ? 'Cloning your voice...'
    : isSavingVoice
      ? 'Saving your voice...'
      : 'Custom voice'
  const { isBelowMd } = useBreakpoint('md')

  const cleanupAudioBlobUrl = useCallback(() => {
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setVoiceName('')
      cleanupAudioBlobUrl()
      isProcessingRef.current = false
    }
  }, [open, cleanupAudioBlobUrl])

  useEffect(() => {
    return () => {
      cleanupAudioBlobUrl()
    }
  }, [cleanupAudioBlobUrl])

  // Reset processing flag when loading completes (success or error)
  useEffect(() => {
    if (!isBusy && isProcessingRef.current) {
      isProcessingRef.current = false
    }
  }, [isBusy])

  const handlePlayPause = useCallback(() => {
    // If we have a selected voice option, use the voice playback handler
    if (selectedVoiceOption && onPlayVoice) {
      onPlayVoice(selectedVoiceOption)
      return
    }

    // Use global audio system for file-based audio
    if (toggle && audioFile) {
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

      // Use a unique ID for this audio file
      const audioId = `preview-${audioFile.name}-${audioFile.size}`
      toggle(audioId, audioUrl)
    }
  }, [audioFile, previewAudioUrl, onPlayVoice, selectedVoiceOption, toggle, cleanupAudioBlobUrl])

  const handleContinue = useCallback(() => {
    if (isProcessingRef.current) {
      return
    }
    isProcessingRef.current = true
    if (voiceName.trim()) {
      onContinue?.(voiceName.trim())
    }
  }, [voiceName, onContinue])

  const handleBack = useCallback(() => {
    // Pause any currently playing audio
    if (pause) {
      pause()
    }
    cleanupAudioBlobUrl()
    isProcessingRef.current = false
    onBack?.()
  }, [onBack, pause, cleanupAudioBlobUrl])

  const isCurrentlyPlaying = (() => {
    // Check if voice clone is playing
    if (selectedVoiceOption && isVoicePlaying?.(selectedVoiceOption.value)) {
      return true
    }

    // Check if file-based audio is playing using global state
    if (playingId && toggle && audioFile) {
      const audioId = `preview-${audioFile.name}-${audioFile.size}`
      return playingId === audioId
    }

    return false
  })()

  return (
    <Dialog
      classNames={{
        content: cn(
          'flex flex-col w-full max-w-[560px] h-full md:h-auto gap-4 border-none bg-menu-background backdrop-blur-2xl backdrop-filter rounded-t-3xl md:rounded-2xl p-6 z-[64]',
          dialogContentClassName,
        ),
        overlay: cn('z-[63]', dialogOverlayClassName),
      }}
      footer={
        <VoicePreviewFooter
          isBelowMd={isBelowMd}
          isBusy={isBusy}
          onBack={handleBack}
          onContinue={handleContinue}
          voiceName={voiceName}
        />
      }
      ignoreInteractOutside={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          // Clear any audio playback when dialog closes
          pause?.()
          if (onClose) {
            onClose()
          } else {
            onBack?.()
          }
        }
      }}
      open={open}
      showClose={!isBelowMd}
    >
      {/* ==================== Top Section ==================== */}
      {/* Contains: Title + Info Box */}
      <div className="flex flex-col gap-4 shrink-0">
        <div className="flex items-start gap-4">
          <h2 className="flex-1 pt-2 md:pt-0 text-lg leading-tight font-semibold text-primary">
            {isBelowMd && !isBusy ? 'Voice clone ready' : dialogTitle}
          </h2>
          {isBelowMd && (
            <button
              aria-label="Close"
              className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors md:hover:bg-white/[0.18]"
              onClick={() => {
                pause?.()
                if (onClose) {
                  onClose()
                } else {
                  onBack?.()
                }
              }}
              type="button"
            >
              <CrossSmall className="size-[var(--mobile-icon-size)] text-white" />
            </button>
          )}
        </div>
        <div className="flex flex-row gap-2.5 items-center bg-fill-secondary rounded-sm p-2">
          <Info className="shrink-0 size-[var(--mobile-icon-size)] md:size-5 text-secondary" />
          <p className="text-xs md:text-sm text-secondary">
            Check the cloned voice&apos;s pacing, tone, and likeness. If it feels off, try
            re-recording or uploading a new audio for best results.
          </p>
        </div>
      </div>

      {/* ==================== Middle Section ==================== */}
      {/* Contains: Play Button + Status Text + Voice Name Input + Terms */}
      <div className="flex flex-col flex-1 items-center justify-center md:justify-start gap-4 min-h-0 overflow-y-auto bg-fill-secondary p-4 rounded-lg md:bg-transparent md:p-0 md:rounded-none">
        {/* Play Button & Status */}
        <div className="flex flex-col gap-4 items-center w-fit min-w-[128px]">
          {/* Play button with optional lottie loader */}
          <div className="size-[100px]">
            {isVoiceLoading ? (
              // Cloning: subtle slate gradient disc + faint ring with the animated waveform inside
              // The gradient is a one-off decorative value with no design token.
              <div className="flex size-full items-center justify-center overflow-hidden rounded-full border border-subtle bg-gradient-to-b from-[#99a2b414] to-[#99a2b433]">
                <LottieCanvas className="z-10" size={80} type="voiceloading" />
              </div>
            ) : (
              /* Play/pause button */
              <div className="flex size-full items-center justify-center rounded-full border-4 border-secondary">
                <button
                  className="flex size-24 items-center justify-center rounded-full transition-colors"
                  onClick={handlePlayPause}
                  style={
                    isSuccessState
                      ? undefined
                      : { background: 'linear-gradient(135deg, #CEBA48 0%, #85CC00 100%)' }
                  }
                  type="button"
                >
                  {isCurrentlyPlaying ? (
                    <Pause className="size-7 text-primary" />
                  ) : (
                    <Play className="ml-0.5 size-7" />
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Status message */}
          <div className="text-center">
            {isVoiceLoading ? (
              <p className="text-base md:text-sm text-secondary">Cloning your voice...</p>
            ) : isSavingVoice ? (
              <p className="text-base md:text-sm text-secondary">Saving your voice...</p>
            ) : selectedVoiceOption ? (
              <p className="text-sm text-primary whitespace-nowrap">Successfully cloned!</p>
            ) : null}
          </div>
        </div>

        {/* Voice Name Input */}
        <div className="w-full">
          <Input
            className="flex items-center justify-center w-full bg-black/15 text-primary rounded-lg px-4 h-12 border-none"
            classNames={{
              input: 'placeholder:text-white/40 !text-base caret-primary rounded-none',
            }}
            maxLength={50}
            onChange={(value) => setVoiceName(value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && voiceName.trim() && !isBusy) {
                handleContinue()
              }
            }}
            placeholder="Enter voice name"
            suffix={
              isBelowMd &&
              voiceName.length > 0 && (
                <Button
                  aria-label="Clear name"
                  className="size-5 rounded-full bg-white/20 hover:bg-white/30 p-0 shrink-0"
                  onClick={() => setVoiceName('')}
                  variant="ghost"
                >
                  <CrossSmall className="size-3.5 text-white" />
                </Button>
              )
            }
            type="text"
            value={voiceName}
          />
        </div>

        <div className="flex items-center md:px-6 text-tertiary text-center text-xs leading-relaxed">
          <p>
            By continuing, you confirm that you have the rights to upload these voice samples, agree
            to the Terms of Service, and will not use the generated content for any illegal or
            harmful purposes.
          </p>
        </div>
      </div>
    </Dialog>
  )
}

function VoicePreviewFooter({
  isBelowMd,
  isBusy,
  onBack,
  onContinue,
  voiceName,
}: VoicePreviewFooterProps) {
  const canContinue = Boolean(voiceName.trim()) && !isBusy

  if (isBelowMd) {
    return (
      <div className="flex w-full shrink-0 gap-2">
        <button
          className="flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors bg-fill-secondary md:hover:bg-fill-hover disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isBusy}
          onClick={onBack}
          type="button"
        >
          <span className="text-base font-medium text-primary">Back</span>
        </button>
        <button
          className={cn(
            'flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors',
            canContinue
              ? 'bg-white md:hover:bg-white/90'
              : 'bg-white opacity-50 cursor-not-allowed',
          )}
          disabled={!canContinue}
          onClick={onContinue}
          type="button"
        >
          <span className="text-base font-medium text-black">Continue</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-full shrink-0 items-center justify-between">
      <button
        className="flex gap-1.5 items-center justify-center h-[38px] px-2.5 rounded-sm bg-fill-secondary hover:bg-fill-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[38px]"
        disabled={isBusy}
        onClick={onBack}
        type="button"
      >
        <span className="px-0.5 text-sm font-medium text-primary">Back</span>
      </button>
      <button
        className={cn(
          'flex gap-1.5 items-center justify-center h-[38px] min-w-[38px] px-[10px] rounded-sm transition-colors',
          canContinue
            ? 'bg-white hover:bg-white/90 text-black'
            : 'bg-white/10 cursor-not-allowed text-white/50',
        )}
        disabled={!canContinue}
        onClick={onContinue}
        type="button"
      >
        <span className="text-sm font-medium">Continue</span>
      </button>
    </div>
  )
}
