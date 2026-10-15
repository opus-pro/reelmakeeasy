'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { cn, toast, Tooltip } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import type { VoiceOption } from '@/components/voice/components/voice-over-selection'
import { VOICE_PREVIEW_PLAYBACK_ERROR } from '@/components/voice/components/voice-preview-copy'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { AudioPlayer } from '@/util/audio-player'

import { STORY_CARD_SURFACE, type StoryCardSurface } from '../story-card-surface'

import { AudioPlaybackIconButton } from './AudioPlaybackIconButton'

const nsLogger = Logger.get('omni-chat-box.audio-card')
const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

type AudioCardProps = {
  className?: string
  disabled?: boolean
  mobileLayout?: boolean
  onOpenVoiceDialog: () => void
  selectedVoice: null | VoiceOption
  surface?: StoryCardSurface
  voiceSelectionEnabled?: boolean
}

/** The tile-wide button under the tile's content: it takes clicks on the label too, and
 *  shows keyboard focus as a ring inside the tile (the tile clips anything outside). */
export const TILE_BUTTON =
  'absolute inset-0 z-[1] cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default'

export function AudioCard({
  className,
  disabled = false,
  onOpenVoiceDialog,
  selectedVoice: configuredVoice,
  voiceSelectionEnabled = true,
  mobileLayout = false,
  surface = 'solid',
}: AudioCardProps) {
  const selectedVoice = voiceSelectionEnabled ? configuredVoice : null
  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const queryClient = useQueryClient()
  const [isPlaying, setIsPlaying] = useState(false)
  const [player, setPlayer] = useState<AudioPlayer>()
  const [progress, setProgress] = useState(0)
  const [audioUrl, setAudioUrl] = useState<null | string>(null)
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

  const hasSelectedVoice = Boolean(selectedVoice && selectedVoice.value !== 'auto-select')
  const audioKey = useMemo(
    () => [
      selectedVoice?.value ?? null,
      selectedVoice?.voiceCloneId ?? null,
      selectedVoice?.needsPresignedUrl ?? false,
    ],
    [selectedVoice?.needsPresignedUrl, selectedVoice?.value, selectedVoice?.voiceCloneId],
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
    if (!selectedVoice || selectedVoice.value === 'auto-select') {
      throw new Error('No voice is selected for preview playback')
    }

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
      queryKey: ['chatbox-story-audio-card-playback-url', ...audioKey],
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
      nsLogger.error('Failed to fetch playback URL for selected voice:', error)
      reportPlaybackFailure()
    }
  })

  useEffect(() => {
    if (!hasSelectedVoice) {
      cancelPendingPlayback()
      setIsPlaying(false)
      setAudioUrl('')
      return
    }
    if (isPlaying) {
      void refreshAudioUrl()
      return
    }
    setAudioUrl('')
  }, [audioKey, cancelPendingPlayback, hasSelectedVoice, isPlaying, refreshAudioUrl])

  const handleOpenVoiceDialog = useRefCallback(() => {
    cancelPendingPlayback()
    setIsPlaying(false)
    onOpenVoiceDialog()
  })

  const handlePlayPause = useRefCallback(() => {
    if (!hasSelectedVoice) {
      return
    }
    failedPlaybackRef.current = false
    // Whether this click starts or stops playback, any in-flight request is the previous
    // click's and must not resolve into this one.
    cancelPendingPlayback()
    setIsPlaying((prev) => !prev)
  })

  const progressWidth = `${Math.max(Math.min(1, Math.max(0, progress)), isPlaying ? 0.01 : 0) * 100}%`
  const voiceName = useMemo(() => {
    if (!hasSelectedVoice) {
      return ''
    }
    return selectedVoice?.name?.trim() || ''
  }, [hasSelectedVoice, selectedVoice?.name])

  const caption = voiceName || (voiceSelectionEnabled ? '' : 'Optional')

  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1 z-20"
      content={voiceSelectionEnabled ? 'Add audio or pick a voice' : 'Add audio'}
      portal
      side="top"
      sideOffset={8}
      trigger="hover"
    >
      {/* Two sibling buttons, never one inside the other: the tile-wide button opens the voices,
          and the play button sits on top of it. */}
      <div
        aria-disabled={disabled || undefined}
        className={cn(
          'relative flex h-auto aspect-square md:aspect-[3/4] w-[60px] min-w-[60px] min-h-[60px] cursor-pointer flex-col items-start justify-between overflow-hidden rounded-xs p-1 text-left text-white shadow-none transition-colors',
          STORY_CARD_SURFACE[surface].rest,
          disabled ? 'cursor-default opacity-50' : STORY_CARD_SURFACE[surface].hover,
          isPlaying && STORY_CARD_SURFACE[surface].active,
          className,
        )}
      >
        {hasSelectedVoice && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-white/[0.15]"
            style={{ width: progressWidth }}
          />
        )}
        <button
          aria-label={
            caption ? `Audio: ${caption}. Add audio or pick a voice` : 'Add audio or pick a voice'
          }
          className={TILE_BUTTON}
          disabled={disabled}
          onClick={handleOpenVoiceDialog}
          type="button"
        />
        <span className="pointer-events-none relative z-[2] flex size-full min-w-px flex-col items-start justify-between">
          <span
            className={cn(
              'pointer-events-auto mt-0.5 ml-0.5 flex shrink-0 items-center justify-center',
              mobileLayout ? 'size-[var(--mobile-icon-size)]' : 'size-[18px]',
            )}
          >
            <AudioPlaybackIconButton
              disabled={disabled || !hasSelectedVoice}
              isPlaying={isPlaying}
              mobileLayout={mobileLayout}
              onClick={(event) => {
                event.stopPropagation()
                handlePlayPause()
              }}
              toneColor={selectedVoice?.color}
            />
          </span>
          <span className="mb-0.5 ml-0.5 flex min-h-[27px] max-w-full flex-col items-start">
            <span
              className={cn(
                'max-w-full truncate font-medium text-white',
                mobileLayout ? 'text-base leading-[20px]' : 'text-xs leading-[15px]',
              )}
              style={FF_STYLE}
              title="Audio"
            >
              Audio
            </span>
            {caption ? (
              <span
                className={cn(
                  'max-w-full truncate font-medium',
                  mobileLayout
                    ? 'text-sm leading-[17px] text-white/60'
                    : 'text-[10px] leading-[12px] text-secondary',
                )}
                style={FF_STYLE}
                title={caption}
              >
                {caption}
              </span>
            ) : null}
          </span>
        </span>
      </div>
    </Tooltip>
  )
}
