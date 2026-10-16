import type { BeatGrid, ReelFit } from './beat-grid'
import type { MotionReelRatio, MotionReelStyleId } from './styles'

/** The reel lengths the setup card offers, in seconds (the grid rounds to whole bars). */
export const MOTION_REEL_LENGTHS = [10, 15, 30, 60] as const
export type MotionReelLength = (typeof MOTION_REEL_LENGTHS)[number]
export const DEFAULT_MOTION_REEL_LENGTH: MotionReelLength = 15

export const MOTION_REEL_RATIOS: readonly MotionReelRatio[] = ['16:9', '9:16', '1:1']
export const DEFAULT_MOTION_REEL_RATIO: MotionReelRatio = '16:9'

/** Frame sizes per ratio (1080p on the short side). */
export const MOTION_REEL_SIZES: Record<MotionReelRatio, { height: number; width: number }> = {
  '16:9': { height: 1080, width: 1920 },
  '1:1': { height: 1080, width: 1080 },
  '9:16': { height: 1920, width: 1080 },
}

export const MOTION_REEL_FPS = 30

/** The longest subject the setup card takes. */
export const MOTION_REEL_SUBJECT_MAX = 600

/** Where the reel's music comes from: a library track, one of the user's own tracks, none, or
 *  composed by the agent (`motion_music`) before it plans. */
export type MotionReelMusic =
  | { id: string; source: 'library' | 'upload' }
  | { source: 'agent' }
  | { source: 'none' }

/** A reference the agent learns the look from (style only, never the content). */
export type MotionReelReference = { kind: 'website' | 'youtube'; url: string }

/** What the setup card sends. */
export type MotionReelSetup = {
  lengthSec: MotionReelLength
  music: MotionReelMusic
  ratio: MotionReelRatio
  reference?: MotionReelReference
  styleId: MotionReelStyleId
  subject: string
}

/** `public/reel.json` in the reel's Remotion project: the template's `grid.ts` reads it. */
export type ReelJson = {
  bars: number
  beats: number[]
  beatsPerBar: number
  bpm: number
  downbeats: number[]
  durationInFrames: number
  fadeOutSec: number
  fps: number
  height: number
  lengthSec: number
  music: null | string
  ratio: MotionReelRatio
  strongHits: number[]
  subject: string
  width: number
}

/** The reel.json for a fitted track (or, with no music, a plain grid at `fallbackBpm`). */
export function buildReelJson(o: {
  fallbackBpm?: number
  fit: null | ReelFit
  grid: BeatGrid | null
  lengthSec: number
  musicFile: null | string
  ratio: MotionReelRatio
  subject: string
}): ReelJson {
  const { height, width } = MOTION_REEL_SIZES[o.ratio]
  if (!o.grid || !o.fit) {
    // No music: a steady grid so the reel still has a pulse to cut to.
    const bpm = o.fallbackBpm ?? 120
    const beatSec = 60 / bpm
    const bars = Math.max(1, Math.round(o.lengthSec / (beatSec * 4)))
    const lengthSec = round3(bars * 4 * beatSec)
    const beats = Array.from({ length: bars * 4 }, (_, i) => round3(i * beatSec))
    return {
      bars,
      beats,
      beatsPerBar: 4,
      bpm,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      durationInFrames: Math.round(lengthSec * MOTION_REEL_FPS),
      fadeOutSec: 0,
      fps: MOTION_REEL_FPS,
      height,
      lengthSec,
      music: null,
      ratio: o.ratio,
      strongHits: [],
      subject: o.subject,
      width,
    }
  }
  const { fit, grid } = o
  return {
    bars: fit.bars,
    beats: fit.reelBeats,
    beatsPerBar: grid.beatsPerBar,
    bpm: grid.bpm,
    downbeats: fit.reelDownbeats,
    durationInFrames: Math.round(fit.lengthSec * MOTION_REEL_FPS),
    fadeOutSec: fit.fadeOutSec,
    fps: MOTION_REEL_FPS,
    height,
    lengthSec: fit.lengthSec,
    music: o.musicFile,
    ratio: o.ratio,
    strongHits: grid.strongHits
      .filter((t) => t >= fit.startSec && t < fit.startSec + fit.lengthSec)
      .map((t) => round3(t - fit.startSec))
      .sort((a, b) => a - b),
    subject: o.subject,
    width,
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000
