import fs from 'node:fs'
import path from 'node:path'

import {
  analyseBeatGrid,
  type BeatGrid,
  fitReel,
  type ReelFit,
} from '@reelmakeeasy/common/motion-reel/beat-grid'
import { decodeAudioMono, rmsBetween } from '@reelmakeeasy/common/motion-reel/decode-audio'
import {
  buildReelJson,
  MOTION_MUSIC_ENGINE_INFO,
  type MotionMusicEngine,
  type MotionReelSetup,
  type ReelJson,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { motionReelStyle, renderStyleCard } from '@reelmakeeasy/common/motion-reel/styles'
import { presetPath } from '@reelmakeeasy/common/storage/presets'

import { run, runtimeDir, sfxDir } from './motion-runtime'

/** The reel's Remotion project, inside the chat's working folder. */
export const REEL_DIR = 'reel'

/** The files the template ships under these names (so the repo's tools never treat it as a project). */
const TEMPLATE_RENAMES: Record<string, string> = {
  'package.template.json': 'package.json',
  'tsconfig.template.json': 'tsconfig.json',
}

export type PreparedReel = {
  grid: BeatGrid | null
  projectDir: string
  reel: ReelJson
}

/** A music track to put under the reel: a file on this computer, with its known tempo when we
 *  have one, or its exact grid (a score the agent wrote: nothing to detect). */
export type ReelMusicSource = { bpm?: number; file: string; grid?: BeatGrid; title: string }

/**
 * Sets up the reel's project in `workspace/reel`: the template, a link to the shared runtime,
 * the sound pack, the music trimmed to whole bars with its beat grid (`public/reel.json`), the
 * style card and the brief. Safe to run again: the template and data are rewritten, the agent's
 * scenes (`src/scenes`) and plan are kept.
 */
export async function prepareReelProject(o: {
  music: null | ReelMusicSource
  /** Only the music changes (the agent composed a track): the template, links and style card
   *  stay as they are, so nothing the agent wrote is touched. */
  musicOnly?: boolean
  setup: MotionReelSetup
  workspace: string
}): Promise<PreparedReel> {
  const projectDir = path.join(o.workspace, REEL_DIR)
  const style = motionReelStyle(o.setup.styleId)
  if (!style) throw new Error(`Unknown Motion Reel style: ${o.setup.styleId}`)

  if (!o.musicOnly) {
    copyTemplate(projectDir)
    linkRuntime(projectDir)
    linkSfx(projectDir)
  }

  let grid: BeatGrid | null = null
  let fit: null | ReelFit = null
  if (o.music) {
    if (o.music.grid) {
      // A score: its grid is what was written, from its first bar.
      grid = o.music.grid
      fit = fitReel(grid, o.setup.lengthSec)
    } else {
      const samples = await decodeAudioMono(o.music.file)
      grid = analyseBeatGrid(samples)
      // A library track's tempo is known exactly; trust it over the estimate when they disagree.
      if (o.music.bpm && Math.abs(grid.bpm - o.music.bpm) > 2) grid = regrid(grid, o.music.bpm)
      fit = fitReel(grid, o.setup.lengthSec, (from, to) => rmsBetween(samples, from, to))
    }
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(fit.startSec),
        '-t',
        String(fit.lengthSec),
        '-i',
        o.music.file,
        '-ar',
        '48000',
        '-ac',
        '2',
        path.join(projectDir, 'public', 'music.wav'),
      ],
      projectDir,
    )
  } else {
    fs.rmSync(path.join(projectDir, 'public', 'music.wav'), { force: true })
  }

  const reel = buildReelJson({
    fit,
    grid,
    lengthSec: o.setup.lengthSec,
    musicFile: o.music ? 'music.wav' : null,
    ratio: o.setup.ratio,
    subject: o.setup.subject,
    // A reel without music still pulses at the style's own pace.
    fallbackBpm: Math.round((style.tempo.min + style.tempo.max) / 2),
  })
  fs.writeFileSync(
    path.join(projectDir, 'public', 'reel.json'),
    `${JSON.stringify(reel, null, 1)}\n`,
  )
  if (!o.musicOnly)
    fs.writeFileSync(path.join(projectDir, 'style.md'), `${renderStyleCard(style)}\n`)
  fs.writeFileSync(path.join(projectDir, 'brief.md'), renderBrief(o.setup, reel, o.music))
  return { grid, projectDir, reel }
}

/** How the brief says the agent makes the music. */
function makeWith(engine: MotionMusicEngine): string {
  if (engine === 'code') return 'written as a score (engine "code")'
  return `with ${MOTION_MUSIC_ENGINE_INFO[engine].label} (engine "${engine}")`
}

/** The brief the agent reads first: what the user chose, in plain words. */
export function renderBrief(
  setup: MotionReelSetup,
  reel: ReelJson,
  music: null | ReelMusicSource,
): string {
  const style = motionReelStyle(setup.styleId)
  const musicLine = music
    ? `"${music.title}", trimmed to the reel and fading out over the last ${reel.fadeOutSec} s`
    : setup.music.source === 'agent'
      ? `none yet: make it with motion_music before you plan, ${makeWith(setup.music.engine)} (the grid below is a placeholder at ${reel.bpm} BPM until then)`
      : `none (a silent reel on a steady ${reel.bpm} BPM grid; sound effects still work)`
  const referenceKind =
    setup.reference?.kind === 'youtube'
      ? 'a video; take its look and rhythm, never its content'
      : "a website; its look, and its words and screenshots when it is the subject's own"
  return [
    '# Motion Reel brief',
    '',
    `- **Subject:** ${setup.subject}`,
    `- **Style:** ${style?.label ?? setup.styleId} (see style.md)`,
    `- **Length:** ${reel.lengthSec} s: ${reel.bars} bars of ${reel.beatsPerBar} beats at ${reel.bpm} BPM (asked for about ${setup.lengthSec} s; the length is whole bars)`,
    `- **Frame:** ${setup.ratio}, ${reel.width}×${reel.height}, ${reel.fps} fps`,
    `- **Music:** ${musicLine}`,
    setup.reference
      ? `- **Reference:** ${referenceKind} (${setup.reference.url})`
      : '- **Reference:** none',
    '',
  ].join('\n')
}

/** Copies the template in (its `*.template.json` under their real names); keeps the agent's Reel.tsx. */
function copyTemplate(projectDir: string): void {
  const template = presetPath('motion-reel/template')
  fs.mkdirSync(path.join(projectDir, 'public'), { recursive: true })
  for (const entry of walk(template)) {
    const relative = path.relative(template, entry)
    const target = path.join(projectDir, TEMPLATE_RENAMES[relative] ?? relative)
    // The agent's starter Reel.tsx is only written once: later runs keep its work.
    if (relative === path.join('src', 'Reel.tsx') && fs.existsSync(target)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(entry, target)
  }
}

function linkRuntime(projectDir: string): void {
  const link = path.join(projectDir, 'node_modules')
  fs.rmSync(link, { force: true, recursive: true })
  fs.symlinkSync(path.join(runtimeDir(), 'node_modules'), link, 'dir')
}

function linkSfx(projectDir: string): void {
  const target = path.join(projectDir, 'public', 'sfx')
  fs.rmSync(target, { force: true, recursive: true })
  fs.mkdirSync(target, { recursive: true })
  // Copies, not links: Remotion's bundler serves public/ files and a link outside the project can be refused.
  for (const file of fs.readdirSync(sfxDir()))
    fs.copyFileSync(path.join(sfxDir(), file), path.join(target, file))
}

/** Moves a grid to a known tempo: same first beat and bar phase, beats every 60/bpm seconds. */
function regrid(grid: BeatGrid, bpm: number): BeatGrid {
  const first = grid.beats[0] ?? 0
  const beatSec = 60 / bpm
  const count = Math.floor((grid.durationSec - first) / beatSec) + 1
  const beats = Array.from(
    { length: Math.max(0, count) },
    (_, i) => Math.round((first + i * beatSec) * 1000) / 1000,
  )
  const firstDownbeat = grid.downbeats[0] ?? first
  const phase = Math.round((firstDownbeat - first) / beatSec) % grid.beatsPerBar
  return {
    ...grid,
    beats,
    bpm,
    downbeats: beats.filter((_, i) => i >= phase && (i - phase) % grid.beatsPerBar === 0),
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}
