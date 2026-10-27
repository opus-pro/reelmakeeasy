import fs from 'node:fs'
import path from 'node:path'

import { ANIMATION_SFX_NAMES, synthesiseAnimationSfx } from '@reelmakeeasy/common/animation/sfx'
import {
  analyseBeatGrid,
  ANALYSIS_SAMPLE_RATE,
  type BeatGrid,
} from '@reelmakeeasy/common/motion-reel/beat-grid'
import { decodeAudioMono } from '@reelmakeeasy/common/motion-reel/decode-audio'
import { analyseMusicEvents } from '@reelmakeeasy/common/motion-reel/music-events'
import { encodeWav } from '@reelmakeeasy/common/motion-reel/sfx'

import { sfxDir } from '../motion-reel/motion-runtime'

/**
 * An animation's sound beyond the voice: the music's beat grid (`public/music.json`, so the
 * picture can move with the music) and the sound effects (`public/sfx/`).
 */

/** `public/music.json`: when the music's beats, bars and hits fall, in seconds from the first
 *  frame (the music starts with the video). Empty with no music. */
export type AnimationMusicJson = {
  /** The loudest hits, in time order. */
  accents: number[]
  beats: number[]
  beatsPerBar: number
  /** Null: no music. */
  bpm: null | number
  downbeats: number[]
  kicks: number[]
  sections: { endSec: number; energy: number; name: string; startSec: number }[]
  snares: number[]
}

export const NO_MUSIC: AnimationMusicJson = {
  accents: [],
  beats: [],
  beatsPerBar: 4,
  bpm: null,
  downbeats: [],
  kicks: [],
  sections: [],
  snares: [],
}

/** The grid as the project reads it, kept to the music's first `lengthSec` seconds. */
export function musicJsonOf(grid: BeatGrid, lengthSec: number): AnimationMusicJson {
  const inside = (t: number) => t >= 0 && t < lengthSec
  const events = grid.events
  return {
    accents: grid.strongHits.filter(inside).sort((a, b) => a - b),
    beats: grid.beats.filter(inside),
    beatsPerBar: grid.beatsPerBar,
    bpm: grid.bpm,
    downbeats: grid.downbeats.filter(inside),
    kicks: (events?.kicks ?? []).filter(inside),
    sections: (events?.sections ?? []).filter((s) => s.startSec < lengthSec),
    snares: (events?.snares ?? []).filter(inside),
  }
}

/** The beat grid of a music file (a composed score's own grid when given, else measured). */
export async function musicGrid(file: string, known?: BeatGrid): Promise<BeatGrid> {
  if (known) return known
  const samples = await decodeAudioMono(file)
  const grid = analyseBeatGrid(samples)
  return grid.events
    ? grid
    : { ...grid, events: analyseMusicEvents(samples, ANALYSIS_SAMPLE_RATE, grid) }
}

export function writeMusicJson(projectDir: string, json: AnimationMusicJson): void {
  fs.writeFileSync(path.join(projectDir, 'public', 'music.json'), `${JSON.stringify(json)}\n`)
}

/** Puts every sound effect in `public/sfx/` (synthesised once into the shared folder; copies,
 *  as Remotion may refuse a link out of the project). */
export function placeSfx(projectDir: string): void {
  const shared = sfxDir()
  fs.mkdirSync(shared, { recursive: true })
  const target = path.join(projectDir, 'public', 'sfx')
  fs.mkdirSync(target, { recursive: true })
  for (const name of ANIMATION_SFX_NAMES) {
    const file = path.join(shared, `${name}.wav`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, encodeWav(synthesiseAnimationSfx(name)))
    fs.copyFileSync(file, path.join(target, `${name}.wav`))
  }
}
