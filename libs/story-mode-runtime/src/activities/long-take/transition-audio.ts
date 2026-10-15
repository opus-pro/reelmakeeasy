import * as fs from 'node:fs'
import * as path from 'node:path'

import { emitsNativeAudio } from '@reelmakeeasy/common/video-models/registry'
import { v4 as uuidV4 } from 'uuid'

import { formatLogFields, logger } from './common'
import { stripAudioTrack } from './transition-lipsync'

/**
 * Strip the audio track from a freshly generated transition clip when (and only
 * when) the model that ACTUALLY produced it emits native audio
 * (`emitsNativeAudio`: Gemini Omni, MiniMax Hailuo 3).
 *
 * Story Mode transitions are silent bridges under the voiceover, and the 1080p
 * render mixes every clip's own audio at full volume, so a model that invents
 * speech from the prompt puts a second voiceover under the real one. Omni got a
 * dedicated strip at launch; Hailuo 3 shipped without one and its dialogue
 * competed with the narration on every H3 project (2.5-star average). Models
 * that render silent clips (Seedance/Veo/Kling/Vidu) are never touched so their
 * output stays byte-for-byte identical.
 *
 * `stripAudioTrack` re-encodes to a separate file (ffmpeg cannot write a path it
 * is reading), so we write to a temp sibling and atomically move it back over
 * the original path, keeping `generatedPath` stable for the caller.
 *
 * `keepNativeAudio` (a loop short's clips) leaves the track in: those clips are
 * prompted for sound effects only, and their hits and whooshes are the loop's sound.
 */
export async function stripNativeAudioInPlace(params: {
  generatedPath: string
  keepNativeAudio?: boolean
  model: string
  tempDir: string
  transitionId: string
}): Promise<void> {
  const { generatedPath, model, tempDir, transitionId } = params
  if (params.keepNativeAudio || !emitsNativeAudio(model)) {
    return
  }
  const strippedPath = path.join(tempDir, `native-audio-stripped-${transitionId}-${uuidV4()}.mp4`)
  await stripAudioTrack(generatedPath, strippedPath)
  await fs.promises.rename(strippedPath, generatedPath)
  logger.info(
    `[long-take] Stripped native transition audio ${formatLogFields({
      model,
      transitionId,
    })}`,
  )
}
