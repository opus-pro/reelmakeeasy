import fs from 'node:fs'

import { presetPath } from '../storage/presets'

/**
 * Motion Reel's music library: instrumental tracks with a steady, known tempo, listed in
 * `presets/motion-reel/music/library.json` beside the files (the first is the setup card's
 * default). A reel is cut to whole bars of its track, so every track's tempo is stored (measured
 * on the track).
 */
export interface MotionReelTrack {
  bpm: number
  credit: { artist: string; license: string; prompt?: string; source: string }
  durationSec: number
  /** Relative to `presets/`. */
  file: string
  id: string
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
