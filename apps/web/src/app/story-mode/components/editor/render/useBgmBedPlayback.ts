import { resolveBgmLiveBedGain } from '@reelmakeeasy/common/long-take/bgm-volume'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useEffect, useRef } from 'react'

const nsLogger = Logger.get('story-editor.bgm-bed', 'story-editor')

// How far the bed element may drift from the engine clock before snapping. Both clocks
// run at 1x, so drift beyond this means a stall, a seek, or a fresh play: small enough
// to stay inaudible as an offset, large enough that progress-event jitter never snaps.
export const BED_DRIFT_TOLERANCE_MS = 300

export type BedSyncAction = 'none' | 'pause' | 'seek' | 'seek-and-play'

export interface BedSyncInput {
  audioCurrentMs: number
  audioPaused: boolean
  engineMs: number
  /** A bed that repeats with the engine: drift is measured around the loop of this length. */
  loopMs?: number
  shouldPlay: boolean
}

interface UseBgmBedPlaybackParams {
  /** Measured bed-to-voice parity gain (`bgmBedGainDb`); null falls back to a linear curve. */
  bedGainDb?: null | number
  /** The music toggle; false parks the bed. */
  enabled: boolean
  /** The engine playhead in ms (the engine store's `currentTime`). */
  engineMs: number
  /**
   * The loop's length, for a bed as long as a looping video (a loop short's clip sound): it
   * repeats on its own, so the engine's wrap needs no seek.
   */
  loopMs?: number
  /** Whether the engine is advancing (playing and not buffering). */
  playing: boolean
  url: null | string | undefined
  /** The 0-100 volume. */
  volume: number
}

/**
 * The sync decision between the engine clock (the source of truth) and the DOM bed
 * element; pure, so the policy is testable without an HTMLAudioElement.
 */
export function resolveBedSyncAction({
  audioCurrentMs,
  audioPaused,
  engineMs,
  loopMs,
  shouldPlay,
}: BedSyncInput): BedSyncAction {
  const drifted = bedDriftMs(audioCurrentMs, engineMs, loopMs) > BED_DRIFT_TOLERANCE_MS
  if (shouldPlay) {
    if (audioPaused) return 'seek-and-play'
    return drifted ? 'seek' : 'none'
  }
  if (!audioPaused) return 'pause'
  // Parked: follow scrubbing while paused so a resume starts at the playhead.
  return drifted ? 'seek' : 'none'
}

/** How far apart the bed and the engine are; around the loop for a looping bed, so a bed just
 *  past the loop's start is close to an engine just before its end. */
function bedDriftMs(audioMs: number, engineMs: number, loopMs?: number): number {
  const apart = Math.abs(audioMs - engineMs)
  if (!loopMs) return apart
  const around = apart % loopMs
  return Math.min(around, loopMs - around)
}

/**
 * The element gain for the live bed. With a measured bed-to-voice gain the level follows
 * the export's duck curve, so what plays matches the downloaded mix; without one (an
 * older project, a failed measurement) it falls back to a linear map of the volume.
 */
export function resolveBedVolume(volume: number, bedToVoiceGainDb?: null | number): number {
  if (bedToVoiceGainDb == null) return Math.max(0, Math.min(volume, 100)) / 100
  return resolveBgmLiveBedGain(volume, bedToVoiceGainDb)
}

/**
 * Plays the music bed as a DOM audio element clock-synced to the engine. The shipped
 * engine does not audibly mix a second audio track in its plan, so the live layer sits
 * outside it: browser-native mixing, an instant toggle and level, no plan rebuild. The
 * export bake remains the source of truth for the final mix. A loop short's clip sound
 * plays the same way (`loopMs`), on a loop with the engine.
 */
export function useBgmBedPlayback({
  bedGainDb,
  enabled,
  engineMs,
  loopMs,
  playing,
  url,
  volume,
}: UseBgmBedPlaybackParams): void {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!url) {
      audioRef.current = null
      return
    }
    const audio = new Audio(url)
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.loop = false
    audioRef.current = audio
    return () => {
      audio.pause()
      audioRef.current = null
    }
  }, [url])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = resolveBedVolume(volume, bedGainDb)
  }, [bedGainDb, volume, url])

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = !!loopMs
  }, [loopMs, url])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const action = resolveBedSyncAction({
      audioCurrentMs: audio.currentTime * 1000,
      audioPaused: audio.paused,
      engineMs,
      loopMs,
      shouldPlay: enabled && playing,
    })
    // Where the engine is in the bed: a looping one starts again at the loop's end.
    const bedMs = loopMs ? engineMs % loopMs : engineMs
    switch (action) {
      case 'pause': {
        audio.pause()
        break
      }
      case 'seek': {
        audio.currentTime = bedMs / 1000
        break
      }
      case 'seek-and-play': {
        audio.currentTime = bedMs / 1000
        audio.play().catch((error: unknown) => {
          nsLogger.warn(`BGM bed play was blocked: ${String(error)}`)
        })
        break
      }
      default: {
        break
      }
    }
  }, [enabled, engineMs, loopMs, playing, url])
}
