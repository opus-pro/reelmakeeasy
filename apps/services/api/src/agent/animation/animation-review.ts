import fs from 'node:fs'
import path from 'node:path'

import { detectCuts } from '../motion-reel/motion-reference'
import {
  frameSize,
  parseReviewArgs,
  REVIEW_PER_ROW,
  sheetLayout,
} from '../motion-reel/motion-review'
import { run } from '../motion-reel/motion-runtime'
import { measureMotion, shotStarts, STALL_SEC, stallRuns } from '../motion-reel/motion-sync'

import { ANIMATION_DIR } from './animation-project'

/**
 * `animation_review`, the check after a render: the render laid out as contact sheets (Motion
 * Reel's layout) for Claude to look at side by side, and what can be measured in a narrated
 * animation: where nothing moves (stalls) and scenes that hold too long. Claude writes what it
 * finds in `animation/review.md`, fixes it and renders again.
 */

/** The rendered video, as animation_render leaves it. */
const VIDEO = path.join('out', 'animation.mp4')
/** A scene held this long (seconds) is worth a camera move or a cut. */
export const LONG_SCENE_SEC = 10
/** The last seconds may hold still (the end card). */
const END_HOLD_SEC = 2
const FPS = 30

/** Why the animation can't be checked yet (null: it can): no render, or scenes or the voices
 *  changed after it. `projectDir` is the animation's folder. */
export function animationReviewBlocker(projectDir: string): null | string {
  const rendered = mtimeOf(path.join(projectDir, VIDEO))
  if (!rendered)
    return 'Nothing to check yet: render the animation with animation_render first, then call animation_review.'
  const newer = newestFile([path.join(projectDir, 'src'), path.join(projectDir, 'public', 'voice')])
  if (newer && newer.mtime > rendered)
    return `${path.relative(projectDir, newer.file)} changed after the last render: render again with animation_render, then check that render.`
  return null
}

export type AnimationReview = {
  sheets: string[]
  /** Where nothing moves for STALL_SEC or more, before the end card ([from, to] seconds). */
  stalls: [number, number][]
  text: string
}

/** Checks the render in `projectDir` (call `animationReviewBlocker` first). */
export async function reviewAnimation(projectDir: string, raw: unknown): Promise<AnimationReview> {
  const video = path.join(projectDir, VIDEO)
  const lengthSec = Number(
    await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video],
      projectDir,
    ),
  )
  const range = parseReviewArgs(raw, lengthSec)
  // A folder per call: the chat keeps showing the earlier sheets after the next check.
  const outDir = path.join(projectDir, 'out', 'review', String(Date.now()))
  fs.mkdirSync(outDir, { recursive: true })
  const layout = sheetLayout(range)
  const size = frameSize(1080, 1920)
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
        `fps=${1 / range.every}:round=up,scale=${size.width}:${size.height},tile=${REVIEW_PER_ROW}x${sheet.rows.length}:padding=4:color=0x3a3a3a`,
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
  const { changes, moves } = await measureMotion(video, outDir, FPS)
  const endFrame = Math.round(Math.max(0, lengthSec - END_HOLD_SEC) * FPS)
  const at = (frame: number) => Math.round((frame / FPS) * 10) / 10
  const stalls = stallRuns(changes, moves, FPS, endFrame).map(
    ([from, to]) => [at(from), at(to)] as [number, number],
  )
  const starts = shotStarts(changes, cuts, FPS)
  const end = changes.length
  const long = starts
    .map((f, i) => ({ from: at(f), length: at((starts[i + 1] ?? end) - f) }))
    .filter((s) => s.length > LONG_SCENE_SEC)
  const legend = layout.map(
    (sheet, i) =>
      `- ${ANIMATION_DIR}/${path.relative(projectDir, sheets[i] as string)}: rows start at ${sheet.rows.map((r) => `${r.start} s`).join(', ')}`,
  )
  const text = [
    `Made ${sheets.length} contact sheet${sheets.length === 1 ? '' : 's'} of the render (the user sees them too): a frame every ${range.every} s from ${range.from} s to ${range.to} s, ${REVIEW_PER_ROW} to a row, left to right. Open every sheet and look for: a speaker whose mouth doesn't move, faces, labels or diagrams under the speech bubble or the captions, text cut off or too small, a label off its part, a picture that doesn't change on the word it shows, empty or crowded frames, colours off the look, and anything that doesn't match the script:`,
    ...legend,
    '',
    stalls.length
      ? `Stalls (${STALL_SEC} s or more where nothing moves): ${stalls.length}, at ${stalls.map(([a, b]) => `${a}-${b} s`).join(', ')}. Keep something moving through each (a blink, a gesture, a camera push, the next element arriving).`
      : `Stalls (${STALL_SEC} s or more where nothing moves): none before the end card.`,
    long.length
      ? `Scenes held over ${LONG_SCENE_SEC} s: ${long.map((s) => `${s.from} s (${s.length} s)`).join(', ')}. Cut to another shot or move the camera on a line start.`
      : `Scenes held over ${LONG_SCENE_SEC} s: none.`,
    '',
    `Write what you find in ${ANIMATION_DIR}/review.md by time, each with its fix, fix it, render again with animation_render and check that render (up to 3 rounds). Say what is still off if anything is after the third.`,
  ].join('\n')
  return { sheets, stalls, text }
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
