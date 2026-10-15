import { rename } from 'node:fs/promises'
import path from 'node:path'

import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'

import { getVideoDurationSeconds, logger } from '../common'

const FADE_OUT_SEC = 2

/** ffmpeg `-af` value: fade to silence over the final FADE_OUT_SEC seconds. */
export function fadeFilter(targetSec: number): string {
  const start = Math.max(0, targetSec - FADE_OUT_SEC)
  return `afade=t=out:st=${String(start)}:d=${String(FADE_OUT_SEC)}`
}

/**
 * Sizes the BGM clip at `srcPath` to exactly `targetSec` in place, always
 * re-encoding with a 2s fade-out. Loops when the target exceeds the source
 * (only a >3min video outruns the ~3min Pro clip; a Clip <=30s is only ever
 * trimmed), otherwise trims. It is deliberately NEVER a no-op -- the usual
 * +/-1s deadband is dropped -- because a BGM bed must always get its fade-out to
 * avoid an abrupt cutoff, and the libmp3lame re-encode also normalises Lyria
 * output that can arrive as WAV/PCM bytes mislabelled as mp3. ffmpeg can't
 * read+write one file, so we render to a sibling temp file and rename over it.
 */
export async function matchDurationLoopTrimFade(srcPath: string, targetSec: number): Promise<void> {
  const srcDuration = await getVideoDurationSeconds(srcPath)
  if (srcDuration <= 0) {
    throw new Error(`Cannot measure BGM duration for ${srcPath}`)
  }

  const tmpPath = path.join(path.dirname(srcPath), `.bgm-match-${path.basename(srcPath)}`)
  const fade = fadeFilter(targetSec)

  if (srcDuration < targetSec) {
    logger.info(`[bgm] Looping ${srcDuration.toFixed(1)}s -> ${targetSec.toFixed(1)}s`)
    await runFfmpeg(
      '-stream_loop',
      '-1',
      '-i',
      srcPath,
      '-t',
      String(targetSec),
      '-af',
      fade,
      '-q:a',
      '2',
      tmpPath,
    )
  } else {
    logger.info(`[bgm] Trimming ${srcDuration.toFixed(1)}s -> ${targetSec.toFixed(1)}s`)
    await runFfmpeg('-i', srcPath, '-t', String(targetSec), '-af', fade, '-q:a', '2', tmpPath)
  }
  await rename(tmpPath, srcPath)
}
