import { execFile } from 'node:child_process'

import { ensureError } from '../utils/error-handler'

import type { RenderFinalLogger } from './render-final.types'

// Cap the probe so a wedged ffprobe can never hang the render path; the probe is
// non-load-bearing, so a timeout just falls back to the expected canvas.
const PROBE_TIMEOUT_MS = 5_000

/**
 * Measure the actual width/height of a produced video via ffprobe so
 * the delivered-dimensions guard reflects the real output rather than the
 * expectation. Returns undefined on any probe failure (logged as a warning,
 * never thrown) so instrumentation is never load-bearing on the render path.
 */
export async function probeVideoDimensions(
  videoPath: string,
  logger: RenderFinalLogger,
  projectId: string,
): Promise<undefined | { height: number; width: number }> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0:s=x',
        videoPath,
      ],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          const err = ensureError(error)
          logger.warn(
            `[long-take] Failed to probe delivered dimensions projectId=${projectId} err=${err.message}`,
          )
          return resolve(undefined)
        }
        const out = stdout.trim()
        const [width, height] = out.split('x').map(Number)
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          logger.warn(
            `[long-take] Could not parse ffprobe dimensions projectId=${projectId} output=${out}`,
          )
          return resolve(undefined)
        }
        return resolve({ height, width })
      },
    )
  })
}
