import fs from 'node:fs'
import path from 'node:path'

import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { detectCuts, remotionBrowserPath } from './motion-reference'
import { run, runtimeDir } from './motion-runtime'
import { beatTime, gridReport, measureChanges, type SyncReport, syncReport } from './motion-sync'

export { beatAt, beatTime, gridReport } from './motion-sync'

/** Loudness every reel is delivered at: streaming level, with headroom for the peaks. */
export const REEL_LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'
/** At most this many stills per call: enough to check a scene, few enough to look at. */
export const MAX_STILLS = 6

export const STILL_SCRIPT = 'motion-still.mjs'

export function readReelJson(projectDir: string): ReelJson {
  return JSON.parse(
    fs.readFileSync(path.join(projectDir, 'public', 'reel.json'), 'utf8'),
  ) as ReelJson
}

/**
 * Renders stills of a project with one bundle:
 * `node motion-still.mjs <projectDir> <outDir> <composition> <frame>...`. Written into the
 * runtime folder, so it resolves Remotion from there.
 */
export function stillScript(): string {
  return `// Written by ReelMakeEasy: renders stills of a Motion Reel or an animation from one bundle.
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const [projectDir, outDir, id, ...frames] = process.argv.slice(2)
const browserExecutable = process.env.REMOTION_BROWSER || null
const serveUrl = await bundle({
  entryPoint: path.join(projectDir, 'src', 'index.ts'),
  publicDir: path.join(projectDir, 'public'),
  rootDir: projectDir,
})
const composition = await selectComposition({ browserExecutable, id, serveUrl })
for (const frame of frames) {
  await renderStill({
    browserExecutable,
    composition,
    frame: Number(frame),
    output: path.join(outDir, 'frame-' + frame + '.png'),
    overwrite: true,
    serveUrl,
  })
}
`
}

/** The frame of a beat, clamped into the reel. */
export function frameOfBeat(reel: ReelJson, n: number): number {
  return Math.min(reel.durationInFrames - 1, Math.max(0, Math.round(beatTime(reel, n) * reel.fps)))
}

/** Type-checks the reel; null when it's clean, else the compiler's first errors. */
export async function typeCheck(projectDir: string): Promise<null | string> {
  try {
    await run(
      path.join(projectDir, 'node_modules', '.bin', 'tsc'),
      ['--noEmit', '-p', 'tsconfig.json'],
      projectDir,
      3 * 60_000,
    )
    return null
  } catch (error) {
    const text = ensureError(error).message
    const lines = text.split('\n').filter((line) => /error TS\d+/.test(line))
    return (lines.length ? lines.slice(0, 15).join('\n') : text).slice(0, 3000)
  }
}

/** ReelMakeEasy's own files under `src/` (the clock, the kit, the transitions, the root). */
const OWNED_SOURCE = new Set(['grid.ts', 'index.ts', 'kit.tsx', 'Root.tsx', 'transitions.tsx'])
/** A pulse on one of the music's whole event lists: a bump or flash on every kick, snare, hit,
 *  chord change or note. */
const PER_EVENT_PULSE = /\busePulse\(\s*(?:(?:kicks|snares|hitFrames|chordChanges)\(\s*\)|melody\()/

/**
 * Why the reel may not render (null: it may): a scene pulses on one of the music's whole event
 * lists (`usePulse(kicks())`, `usePulse(melody(0.8))`...). The owner rejected a card that scaled
 * and flashed on every melody note; the kit's `usePulse` also stops above a few accents. Reads the
 * reel's own sources (`src/` but ReelMakeEasy's files).
 */
export function pulseRefusal(projectDir: string): null | string {
  const src = path.join(projectDir, 'src')
  const found: string[] = []
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(entry.name) && !(dir === src && OWNED_SOURCE.has(entry.name)))
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (PER_EVENT_PULSE.test(line))
              found.push(
                `${path.relative(projectDir, file)}:${i + 1} (${line.trim().slice(0, 80)})`,
              )
          })
    }
  }
  walk(src)
  if (!found.length) return null
  const more = found.length > 5 ? ` and ${found.length - 5} more` : ''
  return `Not rendered: ${found.slice(0, 5).join('; ')}${more} pulses an element on every kick, snare or note. The owner rejected that (a card that scaled and flashed on every melody note). Take it out and answer the music with new things (an element arriving with usePopOn, a reveal, a cut, a counter step with useHitIndex); keep usePulse for a few chosen accents (the drop, the payoff: usePulse([bar(8)])), then render again.`
}

/** What `renderReel` delivers: the video, its poster, and how it sits on the music. */
export type ReelRender = {
  /** The delivered video (loudness evened out). */
  file: string
  poster: string
  /** One line: how the cuts sit on the grid (a Motion Reel only). */
  report?: string
  /** How the picture moves with the music: section starts, melody, kick pulse, stills (a Motion
   *  Reel only). */
  sync?: SyncReport
}

/** Renders the stills of `frames` into `outDir` (made fresh); returns their files in order. */
export async function renderStills(
  projectDir: string,
  frames: number[],
  outDir: string,
  composition = 'Reel',
): Promise<string[]> {
  fs.rmSync(outDir, { force: true, recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  const script = path.join(runtimeDir(), STILL_SCRIPT)
  fs.writeFileSync(script, stillScript())
  const browser = remotionBrowserPath()
  await run(
    process.execPath,
    [script, projectDir, outDir, composition, ...frames.map(String)],
    projectDir,
    5 * 60_000,
    20_000,
    browser ? { REMOTION_BROWSER: browser } : {},
  )
  return frames.map((frame) => path.join(outDir, `frame-${frame}.png`))
}

/**
 * Renders the whole video, evens out its loudness and takes a poster. A Motion Reel (the default)
 * is also checked for its cuts and sync; an animation (`sync: false`, its own `composition` and
 * file `name`) isn't timed to a beat, so its poster is a second before the end.
 */
export async function renderReel(
  projectDir: string,
  o: { composition?: string; name?: string; sync?: boolean } = {},
): Promise<ReelRender> {
  const out = path.join(projectDir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const raw = path.join(out, 'raw.mp4')
  const file = path.join(out, `${o.name ?? 'reel'}.mp4`)
  const poster = path.join(out, 'poster.jpg')
  const browser = remotionBrowserPath()
  await run(
    path.join(projectDir, 'node_modules', '.bin', 'remotion'),
    [
      'render',
      'src/index.ts',
      o.composition ?? 'Reel',
      raw,
      ...(browser ? [`--browser-executable=${browser}`] : []),
    ],
    projectDir,
    20 * 60_000,
  )
  const hasAudio = (
    await run(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        raw,
      ],
      out,
    )
  ).trim()
  await run(
    'ffmpeg',
    hasAudio
      ? [
          '-v',
          'error',
          '-y',
          '-i',
          raw,
          '-c:v',
          'copy',
          '-af',
          REEL_LOUDNESS,
          '-ar',
          '48000',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          file,
        ]
      : ['-v', 'error', '-y', '-i', raw, '-c', 'copy', '-movflags', '+faststart', file],
    out,
  )
  fs.rmSync(raw, { force: true })
  if (o.sync === false) {
    const seconds = Number(
      await run(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        out,
      ),
    )
    await takePoster(file, poster, Math.max(0, seconds - 1), out)
    return { file, poster }
  }
  const reel = readReelJson(projectDir)
  // The poster is the end card: the last bar's middle.
  const lastBar = reel.downbeats[reel.downbeats.length - 1] ?? 0
  const posterAt = Math.min(reel.lengthSec - 0.1, lastBar + (reel.lengthSec - lastBar) / 2)
  await takePoster(file, poster, posterAt, out)
  const cuts = await detectCuts(file, out)
  const changes = await measureChanges(file, out, reel.fps)
  return { file, poster, report: gridReport(reel, cuts), sync: syncReport(reel, changes, cuts) }
}

/** A JPEG of `file` at `at` seconds. */
async function takePoster(file: string, poster: string, at: number, cwd: string): Promise<void> {
  await run(
    'ffmpeg',
    ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-q:v', '3', poster],
    cwd,
  )
}
