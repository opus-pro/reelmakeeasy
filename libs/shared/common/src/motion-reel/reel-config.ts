import type { BeatGrid, MusicEvents, ReelFit } from './beat-grid'
import { steadyEvents } from './music-events'
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

/**
 * How the agent makes a reel's own music (`motion_music`): composed note by note by the agent
 * itself (the `reelmakeeasy-music-composer` skill and the composer in `tools/motion-composer`,
 * run in its own shell; free, every hit exactly where it wrote it), or by a music model on fal
 * (ElevenLabs Music, or the cheaper ACE-Step). The recommended first.
 */
export const MOTION_MUSIC_ENGINES = ['composer', 'eleven-music', 'ace-step'] as const
export type MotionMusicEngine = (typeof MOTION_MUSIC_ENGINES)[number]
export const DEFAULT_MOTION_MUSIC_ENGINE: MotionMusicEngine = 'composer'

/** What each way of making the music is, as the setup card and the agent offer it. */
export const MOTION_MUSIC_ENGINE_INFO: Record<
  MotionMusicEngine,
  { cost: string; description: string; label: string }
> = {
  'ace-step': {
    cost: 'about $0.01',
    description: 'A quick, cheap generated track from style tags; rougher than ElevenLabs.',
    label: 'ACE-Step',
  },
  composer: {
    cost: 'free',
    description:
      'Written note by note by the agent with its composer skill: its own sound, harmony and motif for this reel, every hit exactly where the plan puts a cut.',
    label: 'Composed by the agent',
  },
  'eleven-music': {
    cost: '$0.60 a minute',
    description: 'A produced track from a description: the richest sound, its hits found by ear.',
    label: 'ElevenLabs Music',
  },
}

export const isMotionMusicEngine = (v: unknown): v is MotionMusicEngine =>
  (MOTION_MUSIC_ENGINES as readonly unknown[]).includes(v)

/** An engine read back from a card or a saved setup: anything else (none, or one no longer
 *  offered, such as the old "code", music written in code) reads as the default, the composer. */
export const motionMusicEngineOf = (v: unknown): MotionMusicEngine =>
  isMotionMusicEngine(v) ? v : DEFAULT_MOTION_MUSIC_ENGINE

/** Where the reel's music comes from: a library track, one of the user's own tracks, none, or
 *  made by the agent (`motion_music`, in its `engine`) before it plans. */
export type MotionReelMusic =
  | { engine: MotionMusicEngine; source: 'agent' }
  | { id: string; source: 'library' | 'upload' }
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
  /** What the music plays when, in reel time (seconds from the first frame). */
  events: MusicEvents
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
    const downbeats = beats.filter((_, i) => i % 4 === 0)
    return {
      bars,
      beats,
      beatsPerBar: 4,
      bpm,
      downbeats,
      durationInFrames: Math.round(lengthSec * MOTION_REEL_FPS),
      events: steadyEvents(beats, downbeats, lengthSec),
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
    events: fit.reelEvents,
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
