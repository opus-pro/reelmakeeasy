import fs from 'node:fs'
import path from 'node:path'

import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import { REEL_DIR } from './motion-project'
import { detectCuts } from './motion-reference'
import { run } from './motion-runtime'
import { MotionSetupError } from './motion-setup'
import {
  beatAt,
  LONG_SHOT_SEC,
  MAX_SHOT_SEC,
  measureMotion,
  type PaceFindings,
  paceFindings,
  pulsingLine,
  shotsLine,
  STALL_SEC,
  stallsLine,
} from './motion-sync'

/**
 * `motion_review`: the render laid out as contact sheets (a frame every half second or second, 8
 * to a row, a few rows to a sheet) for the agent to look at side by side, with a pace report: the
 * shots and how long each runs, and every stall. What the sync check measures, the review shows;
 * both read the same measurements (`paceFindings`).
 */

/** The steps a review may take between frames (seconds). */
export const REVIEW_STEPS = [0.5, 1] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]
/** Frames to a row: 4 s at a frame every half second. */
export const REVIEW_PER_ROW = 8
/** At most this many rows to a sheet: a 30 s reel is three sheets at a frame every half second. */
export const REVIEW_MAX_ROWS = 3
/** A sheet is at most this wide (pixels), so it reads as one picture. */
export const REVIEW_SHEET_WIDTH = 1600
/** The gap between frames on a sheet (pixels). */
const GAP = 4

/** What the review covers: a frame every `every` seconds from `from` to `to`. */
export type ReviewRange = { every: ReviewStep; from: number; to: number }

/** One contact sheet: its rows, each with the time of its first frame and how many frames. */
export type ReviewSheet = {
  frames: number
  rows: { frames: number; start: number }[]
  start: number
}

/** The review's arguments, checked against the reel's length; a `MotionSetupError` says what's off. */
export function parseReviewArgs(raw: unknown, lengthSec: number): ReviewRange {
  const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const number = (key: string): number | undefined => {
    const value = args[key]
    if (value === undefined || value === null || value === '') return undefined
    const n = typeof value === 'string' ? Number(value) : value
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
      throw new MotionSetupError(`${key} is a number of seconds, 0 or more.`)
    return n
  }
  const every = number('every') ?? 0.5
  if (!REVIEW_STEPS.includes(every as ReviewStep))
    throw new MotionSetupError(`every is ${REVIEW_STEPS.join(' or ')} (seconds between frames).`)
  const from = number('from') ?? 0
  const to = Math.min(number('to') ?? lengthSec, lengthSec)
  if (from >= to)
    throw new MotionSetupError(`from must come before to, inside the reel (0-${lengthSec} s).`)
  return { every: every as ReviewStep, from, to }
}

/** The frame times of a review: every `every` seconds from `from`, before `to`. */
export function reviewTimes({ every, from, to }: ReviewRange): number[] {
  const count = Math.floor((to - from) / every - 1e-6) + 1
  return Array.from({ length: Math.max(0, count) }, (_, i) => round2(from + i * every))
}

/**
 * The frames laid out on sheets: REVIEW_PER_ROW to a row and rows shared evenly over as few
 * sheets as hold them at REVIEW_MAX_ROWS each (a 30 s reel at a frame every half second is
 * 3 + 3 + 2 rows; at a frame a second, 2 + 2).
 */
export function sheetLayout(range: ReviewRange): ReviewSheet[] {
  const times = reviewTimes(range)
  const rows = Math.ceil(times.length / REVIEW_PER_ROW)
  const sheets = Math.ceil(rows / REVIEW_MAX_ROWS)
  const perSheet = Math.ceil(rows / Math.max(1, sheets))
  const out: ReviewSheet[] = []
  for (let row = 0; row < rows; row += perSheet) {
    const sheetRows = Array.from({ length: Math.min(perSheet, rows - row) }, (_, i) => {
      const first = (row + i) * REVIEW_PER_ROW
      return {
        frames: Math.min(REVIEW_PER_ROW, times.length - first),
        start: times[first] as number,
      }
    })
    out.push({
      frames: sheetRows.reduce((n, r) => n + r.frames, 0),
      rows: sheetRows,
      start: sheetRows[0]?.start ?? range.from,
    })
  }
  return out
}

/** The size of one frame on a sheet (even, as FFmpeg's scaler wants), keeping the reel's shape. */
export function frameSize(width: number, height: number): { height: number; width: number } {
  const w = Math.floor((REVIEW_SHEET_WIDTH - GAP * (REVIEW_PER_ROW - 1)) / REVIEW_PER_ROW / 2) * 2
  return { height: Math.max(2, Math.round((w * height) / width / 2) * 2), width: w }
}

/**
 * Why the reel can't be reviewed yet (null: it can): no render, or scenes (or the music's grid)
 * changed after it. `projectDir` is the reel's folder.
 */
export function reviewBlocker(projectDir: string): null | string {
  const video = path.join(projectDir, 'out', 'reel.mp4')
  const rendered = mtimeOf(video)
  if (!rendered)
    return 'Nothing to review yet: render the reel with motion_render first, then call motion_review.'
  const newer = newestFile([
    path.join(projectDir, 'src'),
    path.join(projectDir, 'public', 'reel.json'),
  ])
  if (newer && newer.mtime > rendered)
    return `${path.relative(projectDir, newer.file)} changed after the last render: render again with motion_render, then review that render.`
  return null
}

/**
 * The pace report's lines: the shots (each with its start, length, and whether it runs long or
 * too long), every stall, every stretch of repeated pulsing/flashing, and a one-line verdict.
 */
export function paceReport(pace: PaceFindings): string[] {
  const shotLines = pace.shots.map((s) => {
    const mark =
      s.length > MAX_SHOT_SEC
        ? ` TOO LONG (over ${MAX_SHOT_SEC} s)`
        : s.length > LONG_SHOT_SEC
          ? ` long (over ${LONG_SHOT_SEC} s)`
          : ''
    return `- ${s.from} s (beat ${s.fromBeat}): ${s.length} s${mark}`
  })
  const tooLong = pace.shots.filter((s) => s.length > MAX_SHOT_SEC).length
  const long = pace.shots.filter((s) => s.length > LONG_SHOT_SEC).length - tooLong
  const problems = [
    tooLong ? `${tooLong} shot${tooLong === 1 ? '' : 's'} over ${MAX_SHOT_SEC} s` : '',
    pace.stalls.length ? `${pace.stalls.length} stall${pace.stalls.length === 1 ? '' : 's'}` : '',
    pace.pulsing.length
      ? `${pace.pulsing.length} stretch${pace.pulsing.length === 1 ? '' : 'es'} of repeated pulsing/flashing`
      : '',
  ].filter(Boolean)
  const info = long
    ? ` (${long} shot${long === 1 ? '' : 's'} over ${LONG_SHOT_SEC} s to consider splitting)`
    : ''
  const verdict = problems.length
    ? `Pace: ${problems.join(' and ')} to fix${info}.`
    : `Pace: no stalls, no shot over ${MAX_SHOT_SEC} s and no repeated pulsing/flashing${info}.`
  return [
    `Shots (from the cuts and big changes; one idea is at most ${LONG_SHOT_SEC} s, a shot over ${MAX_SHOT_SEC} s fails):`,
    ...shotLines,
    shotsLine(pace.shots).line,
    stallsLine(pace.stalls, pace.endHoldFrom, Infinity, pace.hold),
    pulsingLine(pace.pulsing, Infinity),
    verdict,
  ]
}

/** What `reviewReel` made: the sheets (in order) and the text the agent reads. */
export type ReviewResult = { pace: PaceFindings; sheets: string[]; text: string }

/**
 * Reviews the render in `projectDir` (check `reviewBlocker` first): the contact sheets into a
 * fresh folder under out/review/, and the pace report over the whole reel.
 */
export async function reviewReel(projectDir: string, raw: unknown): Promise<ReviewResult> {
  const reel = JSON.parse(
    fs.readFileSync(path.join(projectDir, 'public', 'reel.json'), 'utf8'),
  ) as ReelJson
  const range = parseReviewArgs(raw, reel.lengthSec)
  const video = path.join(projectDir, 'out', 'reel.mp4')
  // A folder per call: the chat keeps showing the earlier sheets after the next review.
  const outDir = path.join(projectDir, 'out', 'review', String(Date.now()))
  fs.mkdirSync(outDir, { recursive: true })
  const layout = sheetLayout(range)
  const size = frameSize(reel.width, reel.height)
  const sheets: string[] = []
  for (const [i, sheet] of layout.entries()) {
    const file = path.join(outDir, `sheet-${i + 1}.png`)
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(sheet.start),
        '-t',
        String(sheet.frames * range.every),
        '-i',
        video,
        '-an',
        '-vf',
        // round=up: each tile is the frame at its time (the default rounds to the nearest tick and
        // shows a frame up to half a step late).
        `fps=${1 / range.every}:round=up,scale=${size.width}:${size.height},tile=${REVIEW_PER_ROW}x${sheet.rows.length}:padding=${GAP}:color=0x3a3a3a`,
        '-frames:v',
        '1',
        file,
      ],
      outDir,
      5 * 60_000,
    )
    sheets.push(file)
  }
  const cuts = await detectCuts(video, outDir)
  const { changes, moves } = await measureMotion(video, outDir, reel.fps)
  const pace = paceFindings(reel, changes, cuts, moves)
  const at = (t: number) => `${t} s (beat ${beatAt(reel, t)})`
  const legend = layout.map(
    (sheet, i) =>
      `- ${REEL_DIR}/${path.relative(projectDir, sheets[i] as string)}: rows start at ${sheet.rows.map((r) => at(r.start)).join(', ')}`,
  )
  const text = [
    `Made ${sheets.length} contact sheet${sheets.length === 1 ? '' : 's'} of the render (the user sees them too): a frame every ${range.every} s from ${range.from} s to ${range.to} s, ${REVIEW_PER_ROW} to a row (${REVIEW_PER_ROW * range.every} s), left to right. Open every sheet and look for stalls, scenes over ${LONG_SHOT_SEC} s, transitions that land on an empty frame, depth used everywhere, repeated pulsing/flashing (the same element bumping or flashing on every beat, kick or note), empty or crowded frames, clipped text and moments off the music:`,
    ...legend,
    '',
    'Pace report (the whole reel):',
    ...paceReport(pace),
    '',
    `Write what you find in ${REEL_DIR}/review.md by time, each with the change of strategy that fixes it (more motion, new things arriving instead of a repeated pulse, split the scene, a better join), fix it, render and review again (up to 3 rounds). A stall is ${STALL_SEC} s in which nothing visibly moves.`,
  ].join('\n')
  return { pace, sheets, text }
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** The newest file under `roots` (folders walked, links not followed). */
function newestFile(roots: string[]): null | { file: string; mtime: number } {
  let newest: null | { file: string; mtime: number } = null
  const visit = (file: string, depth: number) => {
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(file)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      if (depth > 8 || path.basename(file) === 'node_modules') return
      for (const name of fs.readdirSync(file)) visit(path.join(file, name), depth + 1)
    } else if (stat.isFile() && (!newest || stat.mtimeMs > newest.mtime))
      newest = { file, mtime: stat.mtimeMs }
  }
  for (const root of roots) visit(root, 0)
  return newest
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
