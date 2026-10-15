'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Button, cn, toast, Tooltip } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import React, { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { Voiceover } from '@/components/icons/core'
import { AudioPlaybackPill } from '@/components/shared/AudioPlaybackPill'
import type { VoiceOption } from '@/components/voice/components/voice-over-selection'
import { VOICE_PREVIEW_PLAYBACK_ERROR } from '@/components/voice/components/voice-preview-copy'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { AudioPlayer } from '@/util/audio-player'

const nsLogger = Logger.get('omni-chat-box.story-mode-voice-button')

type SelectedVoicePlaybackPillProps = {
  disabled: boolean
  onOpenVoiceDialog: () => void
  selectedVoice: VoiceOption
  variant?: 'default' | 'story-bar'
}

type StoryModeVoiceButtonProps = {
  disabled: boolean
  onOpenVoiceDialog: () => void
  selectedVoice: null | VoiceOption
  variant?: 'default' | 'story-bar'
}

export function StoryModeVoiceButton({
  disabled,
  onOpenVoiceDialog,
  selectedVoice,
  variant = 'default',
}: StoryModeVoiceButtonProps) {
  const isStoryBar = variant === 'story-bar'

  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
      content="Pick a voice"
      side="top"
      sideOffset={8}
    >
      {renderSelectedVoiceNode({
        disabled,
        isStoryBar,
        onOpenVoiceDialog,
        selectedVoice,
      }) ?? (
        <Button
          className={cn(
            isStoryBar
              ? 'h-9.5 min-w-9.5 gap-1.5 rounded-full bg-transparent px-2.5 py-0 text-sm font-medium leading-[17px] text-white transition-colors'
              : 'h-9.5 min-w-9.5 flex items-center justify-center gap-1.5 rounded-full bg-transparent px-2.5 text-sm font-medium text-primary transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-50'
              : isStoryBar
                ? 'hover:bg-white/[0.14]'
                : 'hover:bg-fill-hover hover:text-primary',
          )}
          disabled={disabled}
          onClick={onOpenVoiceDialog}
        >
          <Voiceover className="size-4.5 shrink-0" />
          <span className={cn(!isStoryBar && 'max-sm:hidden')}>Voice</span>
        </Button>
      )}
    </Tooltip>
  )
}

const SelectedVoicePlaybackPill: React.FC<SelectedVoicePlaybackPillProps> = ({
  disabled,
  onOpenVoiceDialog,
  selectedVoice,
  variant = 'default',
}) => {
  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const [isPlaying, setIsPlaying] = useState(false)
  const [player, setPlayer] = useState<AudioPlayer>()
  const [progress, setProgress] = useState(0)
  const [audioUrl, setAudioUrl] = useState<null | string>(null)
  const queryClient = useQueryClient()
  // A single failing source reports twice: once from the media element's error event and
  // once from the rejected play promise. Latched per attempt so both produce one toast.
  const failedPlaybackRef = useRef(false)
  const reportPlaybackFailure = useRefCallback(() => {
    setIsPlaying(false)
    if (failedPlaybackRef.current) {
      return
    }
    failedPlaybackRef.current = true
    toast.error(VOICE_PREVIEW_PLAYBACK_ERROR)
  })
  const selectedVoiceLabel =
    selectedVoice.name?.trim().length > 0 ? `${selectedVoice.name}'s voice` : 'Selected voice'

  const audioKey = useMemo(
    () => [
      selectedVoice.value,
      selectedVoice.voiceCloneId ?? null,
      selectedVoice.needsPresignedUrl ?? false,
    ],
    [selectedVoice.value, selectedVoice.voiceCloneId, selectedVoice.needsPresignedUrl],
  )

  const fetchAudioUrlIdRef = useRef(0)
  // Every cancellation boundary advances this, so a URL request that lands after the user
  // paused, opened the picker, changed voice or left neither plays nor toasts.
  const cancelPendingPlayback = useRefCallback(() => {
    fetchAudioUrlIdRef.current += 1
  })

  useEffect(() => cancelPendingPlayback, [cancelPendingPlayback])

  useEffect(() => {
    if (audioUrl) {
      // reset() keeps the element and its listeners alive, so a media error can still
      // arrive after a pause. Only the attempt that created this player may report.
      const attempt = fetchAudioUrlIdRef.current
      const createdPlayer = new AudioPlayer(audioUrl, {
        onEnded: () => setIsPlaying(false),
        onError: () => {
          if (attempt !== fetchAudioUrlIdRef.current) {
            return
          }
          reportPlaybackFailure()
        },
        onPause: () => setIsPlaying(false),
        onPlay: () => setIsPlaying(true),
        onTimeUpdate: (currentTime, duration) => {
          setProgress(duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0)
        },
      })
      setPlayer(createdPlayer)
    } else {
      setPlayer(undefined)
    }
    setProgress(0)
  }, [audioUrl, reportPlaybackFailure])

  useEffect(() => {
    if (!player) {
      return
    }
    return () => player.destroy()
  }, [player])

  useEffect(() => {
    if (!player) {
      return
    }

    if (disabled) {
      player.reset()
      return
    }

    if (isPlaying) {
      player.play()
      return
    }

    player.reset()
    return () => player.reset()
  }, [disabled, isPlaying, player])

  const resolveVoicePlaybackUrl = useRefCallback(async (): Promise<string> => {
    if (selectedVoice.voiceCloneId) {
      const playbackRes = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
        voiceCloneId: string
      }>(`/api/voice-clones/${selectedVoice.voiceCloneId}/playback`, { method: 'GET' })

      if (
        playbackRes.ok &&
        typeof playbackRes.data?.signedUrl === 'string' &&
        playbackRes.data.signedUrl.trim()
      ) {
        return playbackRes.data.signedUrl
      }
      nsLogger.warn('Voice clone playback fetch failed, trying fallbacks')
    }

    if (selectedVoice.needsPresignedUrl) {
      try {
        const previewRes = await fetchWithProjectId<{
          expiresAt: string
          signedUrl: string
        }>(`/api/voice-over/${selectedVoice.value}/preview`, { method: 'GET' })

        if (
          previewRes.ok &&
          typeof previewRes.data?.signedUrl === 'string' &&
          previewRes.data.signedUrl.trim()
        ) {
          return previewRes.data.signedUrl
        }
      } catch {
        // fall through
      }

      nsLogger.warn('Presigned voice preview fetch failed, trying fallbacks')
    }

    if (selectedVoice.previewAudioUrl) {
      return selectedVoice.previewAudioUrl
    }

    throw new Error('No voice preview URL available')
  })

  // No eviction on failure: react-query never serves an errored query as fresh data, so
  // the next Play click refetches. retry is off because the app default of 1 would double
  // the wait before the failure toast.
  const getVoicePlaybackUrl = useRefCallback(async () =>
    queryClient.fetchQuery({
      queryFn: resolveVoicePlaybackUrl,
      queryKey: ['chatbox-selected-voice-playback-url', ...audioKey],
      retry: false,
      staleTime: 30 * 60 * 1000,
    }),
  )

  const refreshAudioUrl = useRefCallback(async () => {
    setAudioUrl('')
    const id = ++fetchAudioUrlIdRef.current

    try {
      const url = await getVoicePlaybackUrl()
      if (id !== fetchAudioUrlIdRef.current) {
        return
      }
      setAudioUrl(url)
    } catch (error) {
      if (id !== fetchAudioUrlIdRef.current) {
        return
      }
      nsLogger.error('Failed to playback URL for selected voice:', error)
      reportPlaybackFailure()
    }
  })

  useEffect(() => {
    if (isPlaying) {
      refreshAudioUrl()
      return
    }

    setAudioUrl('')
  }, [audioKey, isPlaying, refreshAudioUrl])

  const handlePlayPause = useRefCallback(() => {
    failedPlaybackRef.current = false
    // Whether this click starts or stops playback, any in-flight request is the previous
    // click's and must not resolve into this one.
    cancelPendingPlayback()
    setIsPlaying((prev) => !prev)
  })

  const handleOpenVoiceDialog = useRefCallback(() => {
    cancelPendingPlayback()
    setIsPlaying(false)
    onOpenVoiceDialog()
  })

  return (
    <AudioPlaybackPill
      className={cn(
        'max-w-[220px] !bg-transparent',
        variant === 'story-bar'
          ? disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer transition-colors hover:!bg-white/[0.14]'
          : disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer transition-colors hover:!bg-white/[0.18]',
        variant === 'story-bar' ? isPlaying && '!bg-white/[0.14]' : isPlaying && '!bg-white/10',
      )}
      disabled={disabled}
      isPlaying={isPlaying}
      leftToneColor={selectedVoice.color}
      onClick={disabled ? undefined : handleOpenVoiceDialog}
      onPlayPause={disabled ? undefined : handlePlayPause}
      progress={progress}
      showClose={false}
      title={selectedVoiceLabel}
      variant={variant === 'story-bar' ? 'story-bar' : 'pill'}
    />
  )
}

function renderSelectedVoiceNode({
  disabled,
  isStoryBar,
  onOpenVoiceDialog,
  selectedVoice,
}: {
  disabled: boolean
  isStoryBar: boolean
  onOpenVoiceDialog: () => void
  selectedVoice: null | VoiceOption
}): null | ReactNode {
  if (!selectedVoice || selectedVoice.value === 'auto-select') {
    return null
  }

  return (
    <SelectedVoicePlaybackPill
      disabled={disabled}
      onOpenVoiceDialog={onOpenVoiceDialog}
      selectedVoice={selectedVoice}
      variant={isStoryBar ? 'story-bar' : 'default'}
    />
  )
}
