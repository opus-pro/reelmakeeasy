import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '../agent-v2/paths'
import type { Storage } from '../agent-v2/storage/storage'

import {
  type BeatLoopMixLevels,
  buildBeatLoopMixFilter,
  hasAudioStream,
  measureBeatLoopMix,
} from './beat-loop-finish'
import type { RenderFinalStorage } from './render-final.types'

/**
 * A loop short's clip sound bed: the clips' own sound effects as the finish pass mixes them
 * (beat-loop-finish.ts), on their own, for the live preview. The editor engine plays a loop's
 * clips muted under the voice-over, at its own level, and does not audibly mix a second
 * source; the players add this bed as a clock-synced audio element (useBgmBedPlayback) at the
 * volume in its record, so the clips' sound sits under the voice as in the delivered mix. Only
 * the -14 LUFS master is missing: the preview plays the sources at their own loudness.
 *
 * The file is the clips' sound exactly as it enters the mix (the clips were levelled one by one
 * when they were made; the same resample and trim), with one static gain that brings it to the
 * voice-over's loudness, lowered when that would push its true peak over
 * BEAT_LOOP_SFX_BED_PEAK_DB. Its volume carries the rest: the mix's sound-effects gain over the
 * voice's (computeSfxMixGainDb's 9.1 LU, so about 35%), less the gain in the file. An audio
 * element cannot play louder than its file, and a file as loud as the voice never needs to; a bed
 * whose peaks keep it quieter than that (a sparse, peaky one) may need more than 100%, and then
 * plays at 100%, a little under the mix. Clips that make no sound give a silent bed at 0%.
 *
 * Every loop render writes it (finishBeatLoopDelivery). Loops finished before it existed, or
 * whose bed is older than their clips, get it from rebuildBeatLoopSfxBed, which the status
 * read starts in the background (the API's long-take-loop-sfx-bed.util.ts).
 */

/** Where a loop's clip sound bed is stored. */
export const BEAT_LOOP_SFX_BED_PATH = 'long_take/beat_loop_sfx.m4a'
/** Its record: the volume the preview plays it at, and the levels it was made from. */
export const BEAT_LOOP_SFX_BED_RECORD_PATH = 'long_take/beat_loop_sfx.json'
/**
 * The highest true peak the bed is made with, dBTP: the AAC encode adds about a dB on top
 * (beat-loop-finish.ts), so the file never clips.
 */
export const BEAT_LOOP_SFX_BED_PEAK_DB = -2
/** The bed's recipe: a record from another one reads as no bed, so a new recipe rebuilds them. */
export const BEAT_LOOP_SFX_BED_VERSION = 1

const BED_FILE = path.basename(BEAT_LOOP_SFX_BED_PATH)
const SAMPLE_RATE = 48_000
// A 32 s audio encode takes well under a second; the bound only stops a wedged ffmpeg.
const FFMPEG_TIMEOUT_MS = 2 * 60_000

/** What a bed was made with, stored beside it (BEAT_LOOP_SFX_BED_RECORD_PATH). */
export interface BeatLoopSfxBedRecord {
  /** The loop's length, s: the bed's. */
  durationS: number
  /** The gain the file carries over the clips' sound as it enters the mix, dB; null: silence. */
  gainDb: null | number
  /** The mix's gain on the clips' sound, dB; null when they make no sound. */
  sfxGainDb: null | number
  /** BEAT_LOOP_SFX_BED_VERSION. */
  version: number
  /** The mix's gain on the voice-over, dB; null without one. */
  voiceGainDb: null | number
  /**
   * How loud the preview plays the file, 0-100 % (the audio element's volume) beside the
   * voice-over at its own level: the clips' sound then sits under the voice as in the delivered
   * mix. 0 when the clips make no sound.
   */
  volume: number
}

/**
 * A loop's bed as its status reads it: `current` when it was made from the clips and voice-over
 * the loop has now (`version`: the file's version, when the storage reports one;
 * `clipsVersion`: the joined clips' version, the picture a preview plays with the bed).
 */
export type BeatLoopSfxBedState =
  | { clipsVersion?: string; record: BeatLoopSfxBedRecord; state: 'current'; version?: string }
  | { state: 'missing' | 'stale' }

/**
 * Makes the bed file at `outputPath` and returns its record. `levels` are the finish's own (the
 * levels it mixed at); without them they are measured here, the clips' sound from `sfxPath`'s
 * audio, as the finish takes the video's own.
 */
export async function makeBeatLoopSfxBed(input: {
  durationS: number
  levels?: BeatLoopMixLevels
  outputPath: string
  /** The clips' sound: a file with their audio, as the finish took it. */
  sfxPath?: string
  /** The voice-over, to measure the levels when they are not handed over. */
  voicePath?: string
}): Promise<BeatLoopSfxBedRecord> {
  const { durationS, outputPath, sfxPath } = input
  const levels =
    input.levels ??
    (await measureBeatLoopMix({
      durationS,
      sfxPath: sfxPath && (await hasAudioStream(sfxPath)) ? sfxPath : undefined,
      voicePath: input.voicePath,
    }))
  const plan = planBeatLoopSfxBed(levels)
  if (plan.gainDb !== null && !sfxPath) {
    throw new Error("The clips make a sound, but their file wasn't handed over")
  }
  // The finish's own chain for the clips' sound (resampled, trimmed and padded to the loop).
  const sfx = plan.gainDb === null ? undefined : { gainDb: plan.gainDb, input: '0:a:0' }
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await run([
    ...(sfx && sfxPath ? ['-i', sfxPath] : []),
    '-filter_complex',
    buildBeatLoopMixFilter({ durationS, sfx }).join(';'),
    '-map',
    '[mix]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    String(SAMPLE_RATE),
    '-t',
    String(Number(durationS.toFixed(3))),
    '-movflags',
    '+faststart',
    outputPath,
  ])
  return {
    durationS,
    gainDb: plan.gainDb,
    sfxGainDb: levels.sfx ? round2(levels.sfx.gainDb) : null,
    version: BEAT_LOOP_SFX_BED_VERSION,
    voiceGainDb: levels.voice ? round2(levels.voice.gainDb) : null,
    volume: plan.volume,
  }
}

/** A stored record, or null when it is not one this recipe wrote. */
export function parseBeatLoopSfxBedRecord(raw: unknown): BeatLoopSfxBedRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Partial<Record<keyof BeatLoopSfxBedRecord, unknown>>
  const { volume } = record
  if (
    record.version !== BEAT_LOOP_SFX_BED_VERSION ||
    typeof volume !== 'number' ||
    !(volume >= 0 && volume <= 100)
  ) {
    return null
  }
  const dbOrNull = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    durationS: typeof record.durationS === 'number' ? record.durationS : 0,
    gainDb: dbOrNull(record.gainDb),
    sfxGainDb: dbOrNull(record.sfxGainDb),
    version: BEAT_LOOP_SFX_BED_VERSION,
    voiceGainDb: dbOrNull(record.voiceGainDb),
    volume,
  }
}

/**
 * The bed for the mix's levels: the gain the file carries over the clips' sound as it enters the
 * mix (null: silence) and the volume the preview plays it at, rounded to 0.1 %.
 */
export function planBeatLoopSfxBed(levels: BeatLoopMixLevels): {
  gainDb: null | number
  volume: number
} {
  const { sfx, voice } = levels
  if (!sfx) return { gainDb: null, volume: 0 }
  // The clips' sound beside the voice-over at its own level, as the mix balances them.
  const besideVoiceDb = sfx.gainDb - (voice?.gainDb ?? 0)
  // In the file: as loud as the voice-over (with no voice, at its own level), peaks kept under.
  const gainDb = round2(
    Math.min(voice ? voice.lufs - sfx.lufs : 0, BEAT_LOOP_SFX_BED_PEAK_DB - sfx.peakDb),
  )
  const volume = 100 * 10 ** ((besideVoiceDb - gainDb) / 20)
  return { gainDb, volume: Math.min(100, Math.round(volume * 10) / 10) }
}

/**
 * The loop's bed as its status reads it. A bed counts only with its record, and only when the
 * record is newer than the joined clips (`clipsPath`) and the voice-over: a render joins its
 * clips before its finish writes the bed, so an older record is from clips the loop no longer
 * has (a render that failed after joining them). Without versions it is taken as current.
 */
export async function readBeatLoopSfxBed(
  storage: Pick<Storage, 'exists' | 'getObjectMetadata' | 'readJsonFile'>,
  sources: { clipsPath: string },
): Promise<BeatLoopSfxBedState> {
  let record: BeatLoopSfxBedRecord | null = null
  try {
    record = parseBeatLoopSfxBedRecord(
      await storage.readJsonFile<unknown>(BEAT_LOOP_SFX_BED_RECORD_PATH),
    )
  } catch {
    // No record: no bed.
  }
  if (!record || !(await storage.exists(BEAT_LOOP_SFX_BED_PATH))) return { state: 'missing' }
  const [bed, written, clips, voice] = await Promise.all(
    [
      BEAT_LOOP_SFX_BED_PATH,
      BEAT_LOOP_SFX_BED_RECORD_PATH,
      sources.clipsPath,
      STORY_LOADER_PATHS.audioVoiceoverPath,
    ].map((file) => storage.getObjectMetadata(file)),
  )
  if ([clips, voice].some((source) => isNewer(source?.version, written?.version))) {
    return { state: 'stale' }
  }
  return {
    ...(clips ? { clipsVersion: clips.version } : {}),
    record,
    state: 'current',
    ...(bed ? { version: bed.version } : {}),
  }
}

/**
 * Makes a finished loop's bed again from what its last render stored: the joined clips
 * (`clipsPath`, whose sound the finish mixed) and the voice-over, measured and levelled as the
 * finish mixes them, then stores it. For loops finished before beds existed, or whose bed is
 * stale. Stores nothing, and returns undefined, when the clips change while it works: a render
 * started, and its finish writes the bed.
 */
export async function rebuildBeatLoopSfxBed(
  storage: Pick<
    Storage,
    'downloadFile' | 'exists' | 'getObjectMetadata' | 'uploadFile' | 'writeJsonFile'
  >,
  input: { clipsPath: string; durationS: number },
): Promise<BeatLoopSfxBedRecord | undefined> {
  const clipsVersion = (await storage.getObjectMetadata(input.clipsPath))?.version
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'beat-loop-sfx-bed-'))
  try {
    const clips = path.join(workDir, path.basename(input.clipsPath))
    await storage.downloadFile(input.clipsPath, clips)
    let voice: string | undefined
    if (await storage.exists(STORY_LOADER_PATHS.audioVoiceoverPath)) {
      voice = path.join(workDir, path.basename(STORY_LOADER_PATHS.audioVoiceoverPath))
      await storage.downloadFile(STORY_LOADER_PATHS.audioVoiceoverPath, voice)
    }
    const file = path.join(workDir, BED_FILE)
    const record = await makeBeatLoopSfxBed({
      durationS: input.durationS,
      outputPath: file,
      sfxPath: clips,
      voicePath: voice,
    })
    if ((await storage.getObjectMetadata(input.clipsPath))?.version !== clipsVersion) {
      return undefined
    }
    await storeBeatLoopSfxBed(storage, { file, record })
    return record
  } finally {
    await fs.promises.rm(workDir, { force: true, recursive: true })
  }
}

/** Uploads the bed, then writes its record: a record always names a bed that is there. */
export async function storeBeatLoopSfxBed(
  storage: Pick<RenderFinalStorage, 'uploadFile' | 'writeJsonFile'>,
  bed: { file: string; record: BeatLoopSfxBedRecord },
): Promise<void> {
  await storage.uploadFile(bed.file, BEAT_LOOP_SFX_BED_PATH)
  await storage.writeJsonFile(BEAT_LOOP_SFX_BED_RECORD_PATH, bed.record)
}

/** Makes the bed in `workDir` and stores it with its record. */
export async function writeBeatLoopSfxBed(
  storage: Pick<RenderFinalStorage, 'uploadFile' | 'writeJsonFile'>,
  input: Omit<Parameters<typeof makeBeatLoopSfxBed>[0], 'outputPath'> & { workDir: string },
): Promise<BeatLoopSfxBedRecord> {
  const { workDir, ...bed } = input
  const file = path.join(workDir, BED_FILE)
  const record = await makeBeatLoopSfxBed({ ...bed, outputPath: file })
  await storeBeatLoopSfxBed(storage, { file, record })
  return record
}

/** Whether version `a` is newer than `b`; false when either is unknown. */
function isNewer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b)) return false
  return BigInt(a) > BigInt(b)
}

const round2 = (n: number) => Math.round(n * 100) / 100

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { encoding: 'utf8', timeout: FFMPEG_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg failed making the clip sound bed: ${error.message}\n${stderr}`))
          return
        }
        resolve()
      },
    )
  })
}
