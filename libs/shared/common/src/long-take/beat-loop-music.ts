import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '../agent-v2/paths'

import { normalizeDeliveredAudioToAac } from './aac-normalize'
import { BEAT_LOOP_CONCAT_PATH } from './beat-loop-delivery'
import { type BeatLoopAudioResult, masterBeatLoopAudio } from './beat-loop-finish'
import { resolveBgmDuckDbForVolume } from './bgm-volume'

/**
 * Music on a delivered loop short (the music switch, its volume, a new bed or another version).
 *
 * A story video's music remux rebuilds its sound from the voice-over alone (bgm-remux.ts). A
 * loop's sound is its voice over its clips' own sound, mastered to -14 LUFS (beat-loop-finish.ts),
 * so that rebuild would drop the clips' sound and the master. A loop's remux masters its sound
 * again from the same two files the finish pass mixed, with the music under them when it is on,
 * and puts that under the delivered picture as it is (remuxBgmVariant with `copyAudio`). With
 * the music off it is the very sound the loop was delivered with: the clips' sound goes through
 * the same AAC step finalizeRender gives it before the finish (resolveDeliveryAudioPath), so it
 * is mixed from the same samples.
 */

/** The files a loop's finish pass mixes, in the project's storage. */
export const BEAT_LOOP_SOUND_SOURCES = {
  /** The loop's clips back to back with their own sound (what its render hands the finish). */
  clips: BEAT_LOOP_CONCAT_PATH,
  /** The voice-over on the beat grid. */
  voice: STORY_LOADER_PATHS.audioVoiceoverPath,
} as const

/**
 * A loop's sound for a music change, mastered into `outputPath` (AAC): the voice over the clips'
 * sound, with the music `bgmVolume` % under the narration when there is a bed and the level is
 * above 0. `bedToVoiceGainDb` (voice loudness minus the bed's, as the files are) is what the
 * live preview tunes the music by, as for every video; none without music.
 */
export async function masterBeatLoopSound(input: {
  bedPath?: string
  bgmVolume: number
  clipsPath: string
  durationS: number
  outputPath: string
  voicePath: string
}): Promise<{ audioPath: string; bedToVoiceGainDb?: number; result: BeatLoopAudioResult }> {
  const { bedPath, bgmVolume, clipsPath, durationS, outputPath, voicePath } = input
  const music =
    bedPath && bgmVolume > 0
      ? { duckDb: resolveBgmDuckDbForVolume(bgmVolume), path: bedPath }
      : undefined
  // The finish never hears the stored clips file itself: finalizeRender first re-encodes its
  // sound to AAC (a loop never takes the story music bake, so that step always runs). Mixed
  // from the stored file, music off would sound one encode away from what was delivered.
  const deliveredClipsPath = await normalizeDeliveredAudioToAac(
    clipsPath,
    path.dirname(outputPath),
    `${path.parse(outputPath).name}_clips_aac.mp4`,
  )
  const result = await masterBeatLoopAudio({
    durationS,
    ...(music ? { music } : {}),
    outputPath,
    sfxPath: deliveredClipsPath,
    voicePath,
  })
  const { music: bed, voice } = result.levels
  return {
    audioPath: result.outputPath,
    ...(bed && voice ? { bedToVoiceGainDb: voice.lufs - bed.lufs } : {}),
    result,
  }
}
