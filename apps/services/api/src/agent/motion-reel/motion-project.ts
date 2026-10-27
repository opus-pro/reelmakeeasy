import fs from 'node:fs'
import path from 'node:path'

import {
  analyseBeatGrid,
  ANALYSIS_SAMPLE_RATE,
  type BeatGrid,
  fitReel,
  type ReelFit,
} from '@reelmakeeasy/common/motion-reel/beat-grid'
import { decodeAudioMono, rmsBetween } from '@reelmakeeasy/common/motion-reel/decode-audio'
import { analyseMusicEvents, renderMusicMap } from '@reelmakeeasy/common/motion-reel/music-events'
import {
  buildReelJson,
  MOTION_MUSIC_ENGINE_INFO,
  type MotionMusicEngine,
  type MotionReelSetup,
  type ReelJson,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import {
  MOTION_REEL_FALLBACK_BPM,
  MOTION_REEL_TYPE_INFO,
} from '@reelmakeeasy/common/motion-reel/reel-type'
import { presetPath } from '@reelmakeeasy/common/storage/presets'

import { composerTitle, installComposer } from './motion-composer'
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
 *  have one, or its exact grid with its events (a score the agent composed: nothing is found by
 *  ear, and the reel starts at its first bar). */
export type ReelMusicSource = { bpm?: number; file: string; grid?: BeatGrid; title: string }

/**
 * Sets up the reel's project in `workspace/reel`: the template, a link to the shared runtime,
 * the sound pack, the music trimmed to whole bars with its beat grid (`public/reel.json`) and the
 * brief. Safe to run again: the template and data are rewritten, the agent's
 * scenes (`src/scenes`) and plan are kept.
 */
export async function prepareReelProject(o: {
  music: null | ReelMusicSource
  /** Only the music changes (the agent composed a track): the links and the agent's files stay
   *  as they are; only ReelMakeEasy's own source files are refreshed. */
  musicOnly?: boolean
  setup: MotionReelSetup
  workspace: string
}): Promise<PreparedReel> {
  const projectDir = path.join(o.workspace, REEL_DIR)

  // ReelMakeEasy's own source files are refreshed every time, so a reel set up earlier gets the
  // current helpers when its music is re-made.
  copyTemplate(projectDir, o.musicOnly)
  if (!o.musicOnly) {
    linkRuntime(projectDir)
    linkSfx(projectDir)
  }

  let grid: BeatGrid | null = null
  let fit: null | ReelFit = null
  if (o.music?.grid) {
    // A composed score: its grid is what was written, from its first bar.
    grid = o.music.grid
    fit = fitReel(grid, o.setup.lengthSec)
  } else if (o.music) {
    const samples = await decodeAudioMono(o.music.file)
    grid = analyseBeatGrid(samples)
    // A library track's tempo is known exactly; trust it over the estimate when they disagree,
    // and find its events again on that grid (the estimate's spacing rules thinned them wrongly).
    if (o.music.bpm && Math.abs(grid.bpm - o.music.bpm) > 2) {
      const moved = regrid(grid, o.music.bpm)
      grid = { ...moved, events: analyseMusicEvents(samples, ANALYSIS_SAMPLE_RATE, moved) }
    }
    fit = fitReel(grid, o.setup.lengthSec, (from, to) => rmsBetween(samples, from, to))
  }
  if (o.music && fit) {
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
    // A reel without music still pulses, at its type's tempo.
    fallbackBpm: MOTION_REEL_FALLBACK_BPM[o.setup.type],
  })
  fs.writeFileSync(
    path.join(projectDir, 'public', 'reel.json'),
    `${JSON.stringify(reel, null, 1)}\n`,
  )
  // A reel set up when reels had styles: its old style card goes, as the brief no longer names it.
  if (!o.musicOnly) fs.rmSync(path.join(projectDir, 'style.md'), { force: true })
  fs.writeFileSync(path.join(projectDir, 'brief.md'), renderBrief(o.setup, reel, o.music))
  fs.writeFileSync(path.join(projectDir, 'music-map.md'), renderMusicMap(reel))
  // The agent composes the music itself: the composer and its config, in reel/music/.
  if (o.setup.music.source === 'agent' && o.setup.music.engine === 'composer')
    installComposer(projectDir, {
      bpm: reel.bpm,
      lengthSec: o.setup.lengthSec,
      title: composerTitle(o.setup.subject),
    })
  return { grid, projectDir, reel }
}

/** How the brief says the agent makes the music. */
function makeWith(engine: MotionMusicEngine): string {
  if (engine === 'composer')
    return 'composed by you with the reelmakeeasy-music-composer skill in `music/` (engine "composer")'
  return `with ${MOTION_MUSIC_ENGINE_INFO[engine].label} (engine "${engine}")`
}

/** The brief the agent reads first: what the user chose, in plain words. */
export function renderBrief(
  setup: MotionReelSetup,
  reel: ReelJson,
  music: null | ReelMusicSource,
): string {
  const type = MOTION_REEL_TYPE_INFO[setup.type]
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
    `- **Type:** ${type.label}: ${type.description}`,
    `- **Length:** ${reel.lengthSec} s: ${reel.bars} bars of ${reel.beatsPerBar} beats at ${reel.bpm} BPM (asked for about ${setup.lengthSec} s; the length is whole bars)`,
    `- **Frame:** ${setup.ratio}, ${reel.width}×${reel.height}, ${reel.fps} fps`,
    `- **Music:** ${musicLine}`,
    setup.reference
      ? `- **Reference:** ${referenceKind} (${setup.reference.url})`
      : '- **Reference:** none',
    '',
  ].join('\n')
}

/** The template's files ReelMakeEasy owns (the agent uses them, never edits them): refreshed on
 *  every prepare, also when only the music changes. */
const OWNED_TEMPLATE_FILES = new Set(
  ['grid.ts', 'index.ts', 'kit.tsx', 'Root.tsx', 'transitions.tsx'].map((file) =>
    path.join('src', file),
  ),
)

/**
 * Copies the template in (its `*.template.json` under their real names); keeps the agent's
 * Reel.tsx and scenes. `ownedOnly`: copy only ReelMakeEasy's own source files (the clock, the kit,
 * the transitions, the root), so a reel set up earlier gets the current helpers.
 */
function copyTemplate(projectDir: string, ownedOnly = false): void {
  const template = presetPath('motion-reel/template')
  fs.mkdirSync(path.join(projectDir, 'public'), { recursive: true })
  for (const entry of walk(template)) {
    const relative = path.relative(template, entry)
    if (ownedOnly && !OWNED_TEMPLATE_FILES.has(relative)) continue
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

/** Moves a grid to a known tempo: same first beat and bar phase, beats every 60/bpm seconds (its
 *  music events are left out: they are found again on the new grid). */
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
    beats,
    beatsPerBar: grid.beatsPerBar,
    bpm,
    downbeats: beats.filter((_, i) => i >= phase && (i - phase) % grid.beatsPerBar === 0),
    durationSec: grid.durationSec,
    strongHits: grid.strongHits,
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}
