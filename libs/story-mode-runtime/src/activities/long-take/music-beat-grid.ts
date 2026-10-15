import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  getVideoDurationSeconds,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import type { BeatGrid } from './music-pacing'
import { createLongTakeStorage } from './storage'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

// The librosa beat-grid CLI lives in python/music_pacing/beat_grid.py. The dedicated analysis
// worker image (follow-up PR) sets these env vars to the bundled interpreter + package dir;
// the relative fallbacks only matter for local runs.
const PYTHON_BIN = process.env.MUSIC_PACING_PYTHON?.trim() || 'python3'
const PYTHON_DIR =
  process.env.MUSIC_PACING_PYTHON_DIR?.trim() || path.resolve(__dirname, '../../../../../python')
const RAW_TIMEOUT_MS = Number(process.env.MUSIC_PACING_TIMEOUT_MS)
// Honor an explicit 0 (child_process "no timeout" sentinel); fall back only when unset/invalid.
const ANALYSIS_TIMEOUT_MS = Number.isFinite(RAW_TIMEOUT_MS) ? RAW_TIMEOUT_MS : 240_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024 // beats + energy arrays for a long track stay well under this
// Probed (container metadata) vs decoded duration disagreement beyond this is logged as a
// duration mismatch -- the malformed-upload signature monitored in the logs.
const DURATION_MISMATCH_TOLERANCE_SEC = 1
// Sample rate / channel layout the librosa CLI loads at (librosa.load(sr=22050, mono=True)). We
// decode the wav to exactly this so librosa does no in-process resample/downmix -- a ~4x smaller
// buffer and lower peak memory. MUST stay in sync with DEFAULT_SR in python/music_pacing/beat_grid.py.
const ANALYSIS_SR = 22050

const execFileAsync = promisify(execFile)

export interface AnalyzeMusicBeatGridActivityParams {
  /** store:// / http(s):// / local URI of the audio to analyze */
  audioUri: string
  projectId: string
  userId?: string
}

export interface AnalyzeMusicBeatGridActivityResult {
  beatGrid: BeatGrid
}

function isBeatGrid(value: unknown): value is BeatGrid {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  // Validate every field read downstream (logger reads sections/bpm/isMusic) so malformed output
  // gives a clean rejection instead of a later TypeError.
  return (
    Array.isArray(v.beats) &&
    Array.isArray(v.downbeats) &&
    Array.isArray(v.onsets) &&
    Array.isArray(v.energy) &&
    Array.isArray(v.sections) &&
    typeof v.durationSec === 'number' &&
    typeof v.bpm === 'number' &&
    typeof v.isMusic === 'boolean'
  )
}

function parseErrorMessage(stdout: string): null | string {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}

/**
 * Full-decode the source audio to PCM wav before analysis. librosa's primary mp3 backend
 * (soundfile/libsndfile) trusts the container's frame-count metadata and silently returns a
 * truncated stream for malformed uploads (observed on Suno-generated mp3s: a 283.7s track
 * decoded as 157.2s, so the beat sheet -- and therefore the shot plan -- covered only 57% of
 * the transcript and tripped SHOT_PLAN_COVERAGE_INSUFFICIENT). ffmpeg decodes the entire
 * stream regardless of header lies, and a wav header always states the real PCM length, so
 * analyzing the wav keeps librosa's view consistent with the ASR transcript timeline.
 */
async function decodeAudioToWavForAnalysis(sourcePath: string, wavPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    // Decode straight to the analysis format: mono, ANALYSIS_SR Hz, 16-bit PCM. The CLI loads at
    // sr=ANALYSIS_SR mono regardless, so emitting it here makes the wav ~4x smaller and skips
    // librosa's in-process resample/downmix -- cutting peak memory per run (the OOM that killed the
    // beat-grid subprocess when several ran concurrently on one worker pod). Resampling preserves
    // duration, so the malformed-upload mismatch check below still holds.
    // prettier-ignore
    ['-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', String(ANALYSIS_SR), '-acodec', 'pcm_s16le', '-y', wavPath],
    { timeout: ANALYSIS_TIMEOUT_MS },
  )
}

/** Run the librosa beat-grid CLI and parse its JSON stdout into a BeatGrid. */
function runBeatGridPython(audioPath: string): Promise<BeatGrid> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      ['-m', 'music_pacing.beat_grid', audioPath],
      { cwd: PYTHON_DIR, maxBuffer: MAX_OUTPUT_BYTES, timeout: ANALYSIS_TIMEOUT_MS },
      (error, stdout, stderr) => {
        // The CLI exits 1 + prints {"error": "..."} on analysis failure; surface that if present.
        if (error) {
          const fromStdout = parseErrorMessage(stdout)
          if (fromStdout) {
            reject(new Error(fromStdout))
            return
          }
          // No structured {"error"} on stdout means the CLI never reached its own handler -- it was
          // killed by a signal (SIGKILL from an out-of-memory kill, SIGTERM from the execFile
          // timeout) or crashed natively. Surface signal/code/killed so the OOM signature is
          // visible in logs instead of a bare "Command failed" with empty stderr.
          const exec = error as Error & {
            code?: null | number | string
            killed?: boolean
            signal?: NodeJS.Signals | null
          }
          const details = [
            exec.signal ? `signal=${exec.signal}` : null,
            exec.code !== undefined && exec.code !== null ? `code=${exec.code}` : null,
            exec.killed ? 'killed=true' : null,
            stderr.trim() ? `stderr=${stderr.trim()}` : null,
          ].filter(Boolean)
          const suffix = details.length ? ` (${details.join(' ')})` : ''
          reject(new Error(`beat-grid analysis failed: ${error.message}${suffix}`))
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          reject(new Error('beat-grid analysis returned non-JSON output'))
          return
        }
        const errMessage = parseErrorMessage(stdout)
        if (errMessage) {
          reject(new Error(`beat-grid analysis error: ${errMessage}`))
          return
        }
        if (!isBeatGrid(parsed)) {
          reject(new Error('beat-grid analysis output missing required fields'))
          return
        }
        resolve(parsed)
      },
    )
  })
}

/**
 * Analyze a music track into a BeatGrid (tempo, beats, downbeats, energy, sections) via the
 * librosa CLI. Downloads the audio to a temp file, runs the Python extractor, and returns the
 * parsed grid. DORMANT: not registered on a worker or called by any workflow yet.
 */
export async function analyzeMusicBeatGrid(
  params: AnalyzeMusicBeatGridActivityParams,
): Promise<AnalyzeMusicBeatGridActivityResult> {
  const { audioUri, projectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      if (!audioUri) {
        throw new Error('audioUri is required')
      }
      const startedAt = Date.now()
      // Strip any query string (signed URLs) before deriving the extension, and cap its length.
      const cleanUri = audioUri.split(/[?#]/)[0] ?? audioUri
      const ext =
        (cleanUri.split('.').pop() || 'mp3')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 5) || 'mp3'
      const localPath = path.join(os.tmpdir(), `beat-grid-${randomUUID()}.${ext}`)
      const localWavPath = path.join(os.tmpdir(), `beat-grid-${randomUUID()}.wav`)
      try {
        // audioUri may be a store:// URI, an http(s) URL, an absolute local path, or a project-relative
        // storage key (workflows pass voiceOverPath = 'story_loader/audio/voice_over.mp3'). Full URIs and
        // absolute local paths go through downloadAssetToLocal (it fs.copyFile's a local path); only a
        // relative key is downloaded via the project storage, which resolves it to projects/{projectId}/<key>.
        const isFullUri =
          isStoreUri(audioUri) || audioUri.startsWith('http://') || audioUri.startsWith('https://')
        if (isFullUri || path.isAbsolute(audioUri)) {
          await downloadAssetToLocal(audioUri, localPath)
        } else {
          await createLongTakeStorage(projectId).downloadFile(audioUri, localPath)
        }

        // Container-metadata duration of the source, for the mismatch log below. Best-effort:
        // getVideoDurationSeconds returns 0 (it never throws) when ffprobe fails or reports no
        // duration -- treat that as "no probe" so a probe failure cannot fire a spurious
        // mismatch warn against the real decoded duration.
        const probedDurationSec = await getVideoDurationSeconds(localPath).catch(() => 0)
        const sourceProbeDurationSec = probedDurationSec > 0 ? probedDurationSec : null

        let analysisPath = localPath
        try {
          await decodeAudioToWavForAnalysis(localPath, localWavPath)
          analysisPath = localWavPath
        } catch (error) {
          // If ffmpeg cannot decode it, fall back to handing librosa the original file
          // (pre-decode behavior) rather than failing the whole music route here.
          logger.warn(
            `[long-take] music beat-grid wav decode failed, analyzing source directly ${formatLogFields(
              { projectId, err: formatError(error) },
            )}`,
          )
        }

        const beatGrid = await runBeatGridPython(analysisPath)
        if (
          sourceProbeDurationSec !== null &&
          Math.abs(sourceProbeDurationSec - beatGrid.durationSec) > DURATION_MISMATCH_TOLERANCE_SEC
        ) {
          // Malformed-upload signature: the container claims a different length than the stream
          // actually decodes to (e.g. Suno mp3s with lying headers). The decode-to-wav step above
          // keeps the analysis correct; this line exists for monitoring the rate in the logs.
          logger.warn(
            `[long-take] music beat-grid duration mismatch ${formatLogFields({
              projectId,
              audioUri,
              sourceProbeDurationSec,
              decodedDurationSec: beatGrid.durationSec,
            })}`,
          )
        }
        logger.info(
          `[long-take] music beat-grid analyzed ${formatLogFields({
            projectId,
            userId,
            bpm: beatGrid.bpm,
            beatCount: beatGrid.beats.length,
            sectionCount: beatGrid.sections.length,
            isMusic: beatGrid.isMusic,
            durationSec: beatGrid.durationSec,
            sourceProbeDurationSec,
            decodedToWav: analysisPath === localWavPath,
            durationMs: Date.now() - startedAt,
          })}`,
        )
        return { beatGrid }
      } catch (error) {
        logger.error(
          `[long-take] music beat-grid failed ${formatLogFields({ projectId, err: formatError(error) })}`,
        )
        throw error
      } finally {
        await fs.promises.rm(localPath, { force: true }).catch(() => undefined)
        await fs.promises.rm(localWavPath, { force: true }).catch(() => undefined)
      }
    }),
  )
}
