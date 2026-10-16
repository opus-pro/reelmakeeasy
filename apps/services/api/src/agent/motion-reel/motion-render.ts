import fs from 'node:fs'
import path from 'node:path'

import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { detectCuts, remotionBrowserPath } from './motion-reference'
import { run, runtimeDir } from './motion-runtime'

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
 * Renders stills of a reel with one bundle: `node motion-still.mjs <projectDir> <outDir> <frame>...`.
 * Written into the runtime folder, so it resolves Remotion from there.
 */
export function stillScript(): string {
  return `// Written by ReelMakeEasy: renders stills of a Motion Reel from one bundle.
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const [projectDir, outDir, ...frames] = process.argv.slice(2)
const browserExecutable = process.env.REMOTION_BROWSER || null
const serveUrl = await bundle({
  entryPoint: path.join(projectDir, 'src', 'index.ts'),
  publicDir: path.join(projectDir, 'public'),
  rootDir: projectDir,
})
const composition = await selectComposition({ browserExecutable, id: 'Reel', serveUrl })
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

/** The time of beat `n` (fractions allowed), as grid.ts's `beat()` reckons it. */
export function beatTime(reel: ReelJson, n: number): number {
  const beatSec = 60 / reel.bpm
  const whole = Math.floor(n)
  const at = (i: number) => {
    const beats = reel.beats
    if (i < beats.length) return beats[i] as number
    const last = beats.length - 1
    return (last >= 0 ? (beats[last] as number) : 0) + (i - Math.max(last, 0)) * beatSec
  }
  return at(whole) + (n - whole) * (at(whole + 1) - at(whole))
}

/** Beat number of a time (the inverse of `beatTime`, to two decimals). */
export function beatAt(reel: ReelJson, seconds: number): number {
  const { beats } = reel
  const beatSec = 60 / reel.bpm
  if (!beats.length) return Math.round((seconds / beatSec) * 100) / 100
  let i = 0
  while (i + 1 < beats.length && (beats[i + 1] as number) <= seconds) i++
  const next = i + 1 < beats.length ? (beats[i + 1] as number) : (beats[i] as number) + beatSec
  const from = beats[i] as number
  return Math.round((i + (seconds - from) / (next - from)) * 100) / 100
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

export type ReelRender = {
  /** The delivered video (loudness evened out). */
  file: string
  poster: string
  /** One line: how the cuts sit on the grid. */
  report: string
}

/** Renders the stills of `frames` into `outDir` (cleared first); returns their files in order. */
export async function renderStills(
  projectDir: string,
  frames: number[],
  outDir: string,
): Promise<string[]> {
  fs.rmSync(outDir, { force: true, recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  const script = path.join(runtimeDir(), STILL_SCRIPT)
  fs.writeFileSync(script, stillScript())
  const browser = remotionBrowserPath()
  await run(
    process.execPath,
    [script, projectDir, outDir, ...frames.map(String)],
    projectDir,
    5 * 60_000,
    20_000,
    browser ? { REMOTION_BROWSER: browser } : {},
  )
  return frames.map((frame) => path.join(outDir, `frame-${frame}.png`))
}

/** Renders the whole reel, evens out its loudness, takes a poster and checks its cuts. */
export async function renderReel(projectDir: string): Promise<ReelRender> {
  const out = path.join(projectDir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const raw = path.join(out, 'raw.mp4')
  const file = path.join(out, 'reel.mp4')
  const poster = path.join(out, 'poster.jpg')
  const browser = remotionBrowserPath()
  await run(
    path.join(projectDir, 'node_modules', '.bin', 'remotion'),
    [
      'render',
      'src/index.ts',
      'Reel',
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
  const reel = readReelJson(projectDir)
  // The poster is the end card: the last bar's middle.
  const lastBar = reel.downbeats[reel.downbeats.length - 1] ?? 0
  const posterAt = Math.min(reel.lengthSec - 0.1, lastBar + (reel.lengthSec - lastBar) / 2)
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      String(posterAt),
      '-i',
      file,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      poster,
    ],
    out,
  )
  const cuts = await detectCuts(file, out)
  return { file, poster, report: gridReport(reel, cuts) }
}

/**
 * How a render's cuts sit on the grid, in one line: on a beat, on a half beat, or off it (with the
 * beat numbers of those, so the agent can fix them). A cut is on the grid within a frame and a half.
 */
export function gridReport(reel: ReelJson, cuts: number[]): string {
  const tolerance = 1.5 / reel.fps
  const beatSec = 60 / reel.bpm
  const total = Math.ceil(reel.lengthSec / beatSec) + 1
  const beats = Array.from({ length: total }, (_, i) => beatTime(reel, i))
  const halves = beats.map((b, i) => (b + (beats[i + 1] ?? b + beatSec)) / 2)
  const near = (t: number, grid: number[]) => grid.some((g) => Math.abs(g - t) <= tolerance)
  const inside = cuts.filter((t) => t > tolerance && t < reel.lengthSec - tolerance)
  const onBeat = inside.filter((t) => near(t, beats))
  const onHalf = inside.filter((t) => !near(t, beats) && near(t, halves))
  const off = inside.filter((t) => !near(t, beats) && !near(t, halves))
  if (!inside.length)
    return 'No hard cuts found (only moves and fades): nothing to check against the beat.'
  const parts = [`${inside.length} cuts: ${onBeat.length} on a beat`]
  if (onHalf.length) parts.push(`${onHalf.length} on a half beat`)
  parts.push(
    off.length
      ? `${off.length} off the grid (at beats ${off.map((t) => beatAt(reel, t)).join(', ')})`
      : 'none off the grid',
  )
  return `${parts.join(', ')}.`
}
