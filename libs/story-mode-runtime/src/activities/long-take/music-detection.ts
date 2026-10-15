import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { MusicDetection } from './music-pacing/types'
import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_VOCAL_GENDER_VALIDATION_PATH } from './storage'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

// The YAMNet music-detector CLI lives in python/music_pacing/music_detector.py - the same python
// tree as the beat-grid CLI, so it reuses MUSIC_PACING_PYTHON / MUSIC_PACING_PYTHON_DIR. The
// classification threshold (default 0.3) is owned by the CLI via MUSIC_DETECTOR_THRESHOLD.
const PYTHON_BIN = process.env.MUSIC_PACING_PYTHON?.trim() || 'python3'
const PYTHON_DIR =
  process.env.MUSIC_PACING_PYTHON_DIR?.trim() || path.resolve(__dirname, '../../../../../python')
const RAW_TIMEOUT_MS = Number(process.env.MUSIC_DETECTOR_TIMEOUT_MS)
// Honor an explicit 0 (child_process "no timeout" sentinel); fall back only when unset/invalid.
const DETECTION_TIMEOUT_MS = Number.isFinite(RAW_TIMEOUT_MS) ? RAW_TIMEOUT_MS : 120_000
// execFile's maxBuffer caps stdout AND stderr independently. The JSON result is tiny, but the
// detector loads tensorflow/keras which emit verbose warnings to stderr, so size for stderr
// headroom (matching the beat-grid sibling) rather than the stdout payload.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export interface DetectIfMusicActivityParams {
  /** store:// / http(s):// / local URI of the audio to analyze */
  audioUri: string
  projectId: string
  userId?: string
}

export interface DetectIfMusicActivityResult {
  /**
   * Probability-band verdict for the tiered UIP detector: above
   * MUSIC_DETECTION_BAND_HIGH (default 0.6) -> 'music', below
   * MUSIC_DETECTION_BAND_LOW (default 0.2) -> 'not_music', in between ->
   * 'ambiguous' (callers escalate to the LLM tier). Computed activity-side so
   * the bands are env-tunable.
   */
  band: 'ambiguous' | 'music' | 'not_music'
  detection: MusicDetection
}

const DEFAULT_BAND_HIGH = 0.6
const DEFAULT_BAND_LOW = 0.2

function isMusicDetection(value: unknown): value is MusicDetection {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  // Validate every field of the CLI contract so malformed output gives a clean rejection
  // instead of a later TypeError (mirrors the beat-grid guard).
  return (
    typeof v.isMusic === 'boolean' &&
    isProbability(v.musicProbability) &&
    isProbability(v.speechProbability) &&
    typeof v.model === 'string' &&
    typeof v.durationSec === 'number' &&
    Array.isArray(v.topClasses) &&
    v.topClasses.every(
      (c: unknown) =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Record<string, unknown>).label === 'string' &&
        typeof (c as Record<string, unknown>).score === 'number',
    ) &&
    // Vocal-gender fields are optional (validation-only; a detector running an older CLI during a
    // rolling deploy omits them), but must be well-formed when present.
    isOptionalVocalGender(v.vocalGender) &&
    isOptionalProbability(v.maleScore) &&
    isOptionalProbability(v.femaleScore) &&
    isOptionalProbability(v.genderConfidence)
  )
}

function isOptionalProbability(value: unknown): boolean {
  return value === undefined || isProbability(value)
}

function isOptionalVocalGender(value: unknown): boolean {
  return value === undefined || value === 'female' || value === 'male' || value === 'unknown'
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function parseErrorMessage(stdout: string): null | string {
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}

function readBandBound(envName: string, fallback: number): number {
  // Explicit empty check: Number('') is 0, which would silently pass the
  // [0,1] range check and turn a blank env var into a 0 bound.
  const rawText = process.env[envName]?.trim()
  if (!rawText) {
    return fallback
  }
  const raw = Number(rawText)
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback
}

/** Exported for tests. */
export function resolveMusicBand(musicProbability: number): 'ambiguous' | 'music' | 'not_music' {
  let high = readBandBound('MUSIC_DETECTION_BAND_HIGH', DEFAULT_BAND_HIGH)
  let low = readBandBound('MUSIC_DETECTION_BAND_LOW', DEFAULT_BAND_LOW)
  if (low > high) {
    // Inverted misconfig would band everything music AND not_music depending
    // on order of checks; fall back to the validated defaults instead.
    high = DEFAULT_BAND_HIGH
    low = DEFAULT_BAND_LOW
  }
  if (musicProbability >= high) {
    return 'music'
  }
  if (musicProbability <= low) {
    return 'not_music'
  }
  return 'ambiguous'
}

/** Run the YAMNet music-detector CLI and parse its JSON stdout into a MusicDetection. */
function runMusicDetectorPython(audioPath: string): Promise<MusicDetection> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      ['-m', 'music_pacing.music_detector', audioPath],
      { cwd: PYTHON_DIR, maxBuffer: MAX_OUTPUT_BYTES, timeout: DETECTION_TIMEOUT_MS },
      (error, stdout, stderr) => {
        // The CLI exits 1 + prints {"error": "..."} on detection failure; surface that if present.
        if (error) {
          const fromStdout = parseErrorMessage(stdout)
          reject(
            new Error(fromStdout ?? `music detection failed: ${error.message} ${stderr}`.trim()),
          )
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          reject(new Error('music detection returned non-JSON output'))
          return
        }
        const errMessage = parseErrorMessage(stdout)
        if (errMessage) {
          reject(new Error(`music detection error: ${errMessage}`))
          return
        }
        if (!isMusicDetection(parsed)) {
          reject(new Error('music detection output missing required fields'))
          return
        }
        resolve(parsed)
      },
    )
  })
}

/**
 * Classify an audio track as music vs speech via the YAMNet (AudioSet) CLI. Downloads the audio
 * to a temp file, runs the Python detector, and returns the parsed MusicDetection plus the
 * probability-band verdict. Registered on the music-analysis worker; called by
 * PreVoiceoverWorkflow's tiered music detection.
 */
export async function detectIfMusic(
  params: DetectIfMusicActivityParams,
): Promise<DetectIfMusicActivityResult> {
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
      const localPath = path.join(os.tmpdir(), `music-detect-${randomUUID()}.${ext}`)
      try {
        // Same URI handling as the beat-grid activity: full URIs and absolute local paths go
        // through downloadAssetToLocal; a project-relative storage key goes via the project storage.
        const isFullUri =
          isStoreUri(audioUri) || audioUri.startsWith('http://') || audioUri.startsWith('https://')
        if (isFullUri || path.isAbsolute(audioUri)) {
          await downloadAssetToLocal(audioUri, localPath)
        } else {
          await createLongTakeStorage(projectId).downloadFile(audioUri, localPath)
        }
        const detection = await runMusicDetectorPython(localPath)
        const band = resolveMusicBand(detection.musicProbability)
        // Validation-only: persist YAMNet's perceived vocal gender so the long-take completion
        // event can log it next to Gemini's perceivedGender. Best-effort -- a storage hiccup must
        // never fail the (now load-bearing) music-vs-speech detection.
        await persistVocalGenderValidation({ detection, projectId })
        logger.info(
          `[long-take] music detection completed ${formatLogFields({
            projectId,
            userId,
            band,
            isMusic: detection.isMusic,
            musicProbability: detection.musicProbability,
            speechProbability: detection.speechProbability,
            vocalGender: detection.vocalGender,
            genderConfidence: detection.genderConfidence,
            model: detection.model,
            durationMs: Date.now() - startedAt,
          })}`,
        )
        return { band, detection }
      } catch (error) {
        logger.error(
          `[long-take] music detection failed ${formatLogFields({ projectId, err: formatError(error) })}`,
        )
        throw error
      } finally {
        await fs.promises.rm(localPath, { force: true }).catch(() => undefined)
      }
    }),
  )
}

/**
 * Best-effort persistence of the YAMNet vocal-gender verdict to a project artifact. Read at
 * completion by `trackLongTakeCompleted` and logged on `project.long_take.completed` next to
 * Gemini's perceivedGender (validation-only -- no generation step reads this file). Swallows all
 * errors: this is observability bolted onto the load-bearing music-vs-speech detector and must
 * never affect it. No-op when the detector did not emit a gender (e.g. older CLI mid-deploy).
 */
async function persistVocalGenderValidation(params: {
  detection: MusicDetection
  projectId: string
}): Promise<void> {
  const { detection, projectId } = params
  if (detection.vocalGender === undefined) {
    return
  }
  try {
    const storage = createLongTakeStorage(projectId)
    await storage.ensureDir('long_take')
    await storage.writeJsonFile(LONG_TAKE_VOCAL_GENDER_VALIDATION_PATH, {
      femaleScore: detection.femaleScore,
      genderConfidence: detection.genderConfidence,
      maleScore: detection.maleScore,
      model: detection.model,
      vocalGender: detection.vocalGender,
    })
  } catch (error) {
    logger.warn(
      `[long-take] vocal-gender validation persist failed (non-fatal) ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
  }
}
