import fs from 'node:fs'

import { presetPath } from '../storage/presets'

/**
 * Motion Reel's music library: instrumental tracks with a steady, known tempo, one or more per
 * style, listed in `presets/motion-reel/music/library.json` beside the files. A reel is cut to
 * whole bars of its track, so every track's tempo is stored (measured on the track).
 */
export interface MotionReelTrack {
  bpm: number
  credit: { artist: string; license: string; prompt?: string; source: string }
  durationSec: number
  /** Relative to `presets/`. */
  file: string
  id: string
  /** The styles it was made for (the setup card suggests it for them). */
  styles: string[]
  title: string
}

let cached: MotionReelTrack[] | undefined

export function motionReelTrack(id: string): MotionReelTrack | undefined {
  return motionReelTracks().find((track) => track.id === id)
}

export function motionReelTracks(): MotionReelTrack[] {
  cached ??= (
    JSON.parse(fs.readFileSync(presetPath('motion-reel/music/library.json'), 'utf8')) as {
      tracks: MotionReelTrack[]
    }
  ).tracks
  return cached
}

/** The track a style starts with on the setup card. */
export function defaultTrackFor(styleId: string): MotionReelTrack | undefined {
  const tracks = motionReelTracks()
  return tracks.find((track) => track.styles.includes(styleId)) ?? tracks[0]
}
