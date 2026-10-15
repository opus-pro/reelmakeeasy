/** Pure helpers over model capabilities. Browser-safe. */
import type { GenerationProvider, ModelRegistryFile, VideoCaps } from './schema'

const RESOLUTION_ORDER = ['480p', '720p', '768p', '1080p', '4K'] as const

type DurationCaps = Pick<VideoCaps, 'durationRangeSec' | 'durationsSec'>

/** The supported duration closest to `sec`; the longer one on a tie. */
export function nearestDuration(caps: Pick<VideoCaps, 'durationsSec'>, sec: number): number {
  const sorted = [...caps.durationsSec].sort((a, b) => a - b)
  return sorted.reduce(
    (best, d) => (Math.abs(d - sec) <= Math.abs(best - sec) ? d : best),
    sorted[0] ?? sec,
  )
}

/** The smallest supported duration at or above `sec`; the longest one when `sec` exceeds them all. */
export function snapDuration(caps: Pick<VideoCaps, 'durationsSec'>, sec: number): number {
  const sorted = [...caps.durationsSec].sort((a, b) => a - b)
  return sorted.find((d) => d >= sec) ?? sorted[sorted.length - 1] ?? sec
}

/** Whether the model makes a clip of exactly `sec` seconds: a listed length, or one inside `durationRangeSec`. */
export function takesDuration(caps: DurationCaps, sec: number): boolean {
  const range = caps.durationRangeSec
  return caps.durationsSec.includes(sec) || (range ? sec >= range[0] && sec <= range[1] : false)
}

/**
 * `sec` itself, for a caller that needs exactly that length (a loop's 4 s
 * clip, where snapping 4 to H3's 5 would break the beat). Throws, naming the
 * lengths the model makes, rather than send another length.
 */
export function exactDuration(caps: DurationCaps, sec: number, modelKey: string): number {
  if (takesDuration(caps, sec)) return sec
  throw new Error(
    `Model "${modelKey}" can't make a clip of exactly ${sec} s: it makes ${describeDurations(caps)}`,
  )
}

/** "0.92 to 15 s", "whole seconds from 3 to 10" or "4, 6 or 8 s". */
function describeDurations(caps: DurationCaps): string {
  if (caps.durationRangeSec) return `${caps.durationRangeSec[0]} to ${caps.durationRangeSec[1]} s`
  const sorted = [...caps.durationsSec].sort((a, b) => a - b)
  const first = sorted[0] ?? 0
  const consecutive =
    sorted.length > 2 && sorted.every((d, i) => Number.isInteger(d) && d === first + i)
  if (consecutive) return `whole seconds from ${first} to ${sorted[sorted.length - 1]}`
  return `${sorted.slice(0, -1).join(', ')}${sorted.length > 1 ? ' or ' : ''}${sorted.at(-1)} s`
}

/**
 * The clip models for loop shorts (`beatLoop.video`), in order, keeping those
 * whose provider can run (its key is set). fal Veo isn't listed: it missed the
 * 1-2-3-4 beat on every test clip.
 */
export function beatLoopVideoKeys(
  registry: Pick<ModelRegistryFile, 'beatLoop' | 'models'>,
  canRun: (provider: GenerationProvider) => boolean,
): string[] {
  return (registry.beatLoop?.video ?? []).filter((key) => {
    const entry = registry.models[key]
    return entry?.kind === 'video' && canRun(entry.provider)
  })
}

/** Caps a requested video resolution at the model's maximum. Unknown values pass through. */
export function clampResolution(
  caps: Pick<VideoCaps, 'maxResolution'>,
  resolution: string,
): string {
  const requested = RESOLUTION_ORDER.indexOf(resolution as (typeof RESOLUTION_ORDER)[number])
  const max = RESOLUTION_ORDER.indexOf(caps.maxResolution)
  if (requested === -1) return resolution
  return requested > max ? caps.maxResolution : resolution
}

export function supportsAspect(caps: { aspectRatios: string[] }, aspectRatio: string): boolean {
  return caps.aspectRatios.includes(aspectRatio)
}

/** The longest clip (video) or track (music, lipsync) the model produces. */
export function maxDurationSec(
  caps: { durationsSec: number[] } | { maxDurationSec: number } | { maxVideoSec: number },
): number {
  if ('durationsSec' in caps) return Math.max(...caps.durationsSec)
  if ('maxDurationSec' in caps) return caps.maxDurationSec
  return caps.maxVideoSec
}
