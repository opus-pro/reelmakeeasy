import * as path from 'node:path'

import { runFfmpeg } from '../utils/cmdline'

import { mixBgmIntoVideo } from './bgm-mix'

// Settings re-mux. The delivered video is baked once at render time
// with a constant duck; when the user later edits the panel volume or toggles
// music off, the video is REBUILT from persisted parts instead of re-rendered:
// the video stream is copied losslessly from the current final video and the
// audio is reconstructed from the canonical voiceover artifact (+ the bed at
// the requested duck). Seconds, not minutes -- no engine involved.

// The volume->duck mapping lives in the browser-safe bgm-volume module (the
// web preview shares the curve); re-exported here for existing consumers.
export {
  BGM_VOLUME_DUCK_RANGE_DB,
  resolveBgmDuckDbForVolume,
  resolveBgmLiveBedGain,
} from './bgm-volume'

export interface RebuildVideoWithVoiceoverParams {
  /**
   * Put the audio file under the picture as it is (no re-encode): a loop short's sound is
   * already mastered and measured as AAC (beat-loop-music.ts).
   */
  copyAudio?: boolean
  /** Output file name inside workDir. */
  outputFileName: string
  /** Local path of the current delivered video (audio will be discarded). */
  videoPath: string
  /** Local path of the canonical voiceover audio (m4a/mp3). */
  voiceoverPath: string
  workDir: string
}

export interface RemuxBgmVariantParams {
  /** Local bed path; required when `withBed` is true. */
  bedPath?: string
  /** `voiceoverPath` is a finished sound to copy in as it is (see RebuildVideoWithVoiceoverParams). */
  copyAudio?: boolean
  duckDb?: number
  /** Reuse a gain measured on a sibling variant (same voiceover loudness). */
  gainDb?: number
  outputBaseName: string
  videoPath: string
  voiceoverPath: string
  /** False strips the bed (voiceover-only delivery). */
  withBed: boolean
  workDir: string
}

export interface RemuxBgmVariantResult {
  /**
   * Raw bed->voice loudness delta measured by this variant's mix; present
   * only when the mix measured (no precomputed gainDb, bed present). The
   * activity persists it back as bgmBedGainDb so the live preview's duck
   * curve tracks the bed the delivery was actually built at.
   */
  bedToVoiceGainDb?: number
  /** The bed gain applied; undefined on the voiceover-only path. */
  gainDb?: number
  outputPath: string
}

/**
 * Rebuild a delivered video with its audio replaced by the clean voiceover:
 * video stream copied (lossless), voiceover re-encoded AAC 192k to match the
 * delivery format. This strips a previously baked bed; the video track (and
 * its duration) is untouched, mirroring the bake's no `-shortest` policy.
 */
export async function rebuildVideoWithVoiceover(
  params: RebuildVideoWithVoiceoverParams,
): Promise<string> {
  const { copyAudio, outputFileName, videoPath, voiceoverPath, workDir } = params
  const outputPath = path.join(workDir, outputFileName)
  if (outputPath === videoPath) {
    throw new Error('BGM remux output path must differ from the input video path')
  }
  await runFfmpeg(
    '-i',
    videoPath,
    '-i',
    voiceoverPath,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
    '-movflags',
    '+faststart',
    outputPath,
  )
  return outputPath
}

/**
 * Produce one delivery variant at the requested settings: always rebuild the
 * clean (voiceover-only) video first -- the current delivered file may already
 * carry a bed at the old gain, which can never be subtracted -- then mix the
 * bed back in at the requested duck when enabled.
 */
export async function remuxBgmVariant(
  params: RemuxBgmVariantParams,
): Promise<RemuxBgmVariantResult> {
  const {
    bedPath,
    copyAudio,
    duckDb,
    gainDb,
    outputBaseName,
    videoPath,
    voiceoverPath,
    withBed,
    workDir,
  } = params
  const cleanPath = await rebuildVideoWithVoiceover({
    ...(copyAudio ? { copyAudio } : {}),
    outputFileName: `${outputBaseName}_clean.mp4`,
    videoPath,
    voiceoverPath,
    workDir,
  })
  if (!withBed) {
    return { outputPath: cleanPath }
  }
  if (!bedPath) {
    throw new Error('BGM remux requested with bed but no bed path was provided')
  }
  const mixResult = await mixBgmIntoVideo({
    bedPath,
    duckDb,
    gainDb,
    outputFileName: `${outputBaseName}_mixed.mp4`,
    videoPath: cleanPath,
    workDir,
  })
  return {
    ...(mixResult.bedToVoiceGainDb === undefined
      ? {}
      : { bedToVoiceGainDb: mixResult.bedToVoiceGainDb }),
    gainDb: mixResult.gainDb,
    outputPath: mixResult.outputPath,
  }
}
