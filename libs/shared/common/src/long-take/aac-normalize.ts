import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Audio-only re-encode of a delivery-length video takes seconds; the bound only
// exists so a wedged ffmpeg cannot hang the finalize activity until its
// startToClose. Same budget as the 4K finalize's remux.
const AAC_NORMALIZE_TIMEOUT_MS = 10 * 60_000

/**
 * Re-encode a delivered video's audio to container-native AAC, with the video
 * stream copied untouched. Returns the normalized output path.
 *
 * Why: when no BGM bake runs, the sidecar concat stream-copies the voiceover
 * MP3 into the MP4 container, and MP3-in-MP4 plays SILENT in QuickTime/Safari
 * (macOS default players mute the track). The BGM mix path already re-encodes
 * the audio to AAC (bgm-mix.ts); this gives the no-bake delivery the same
 * container-native audio. Mirrors the 4K finalize's inline fix
 * (finalize-4k.activity.ts), which could adopt this helper later.
 *
 * The audio map is OPTIONAL (`0:a?`) on purpose: a genuinely silent delivery
 * must reach the typed no-audio delivery guard downstream
 * (validate-delivered-video.ts), not die here as a generic, retryable ffmpeg
 * error that retries a deterministic failure.
 *
 * Failures propagate: shipping the un-normalized file would re-introduce the
 * silent playback this exists to fix, and every caller runs inside a
 * retryable activity. Lives outside render-final.ts, which sits at the
 * max-lines ceiling (same reason as bgm-bake.ts).
 */
export async function normalizeDeliveredAudioToAac(
  /** Local path of the delivered video to normalize. */
  videoSourcePath: string,
  /** Directory for the normalized output. */
  workDir: string,
  /**
   * Output file name, REQUIRED to be distinct per variant in a given workDir.
   * Deriving it from the source basename is not safe: the clean and watermark
   * renders are different directories both ending in `video.mp4`, so they
   * would collide on one output in the shared workDir --
   * and the watermark normalize runs while the clean file is still being
   * uploaded, so ffmpeg would truncate an already-validated delivery.
   */
  outputFileName: string,
): Promise<string> {
  const outputPath = path.join(workDir, outputFileName)
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoSourcePath,
      '-map',
      '0:v',
      '-map',
      '0:a?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { timeout: AAC_NORMALIZE_TIMEOUT_MS },
  )
  return outputPath
}

/**
 * The clean delivery's audio path after the BGM bake: normalized to AAC only
 * when this delivery would otherwise ship the concat's stream-copied MP3.
 *
 * Skipped when the bake produced a mix (bgm-mix already re-encodes to AAC, so
 * a second pass would only add generation loss). Lives here rather than inline
 * so render-final.ts, which sits at the max-lines ceiling, spends one line on it.
 */
export async function resolveDeliveryAudioPath(
  bake: { bgmMix?: unknown; videoSourcePath: string },
  workDir: string,
): Promise<string> {
  if (bake.bgmMix) {
    return bake.videoSourcePath
  }
  return normalizeDeliveredAudioToAac(bake.videoSourcePath, workDir, 'deliver_aac.mp4')
}

/**
 * The watermark variant's audio path after its own BGM bake.
 *
 * Keyed on whether THIS variant's mix ran -- not the clean one's: the
 * watermark mix fail-softs independently and then returns the very file it was
 * handed, whose audio is still the stream-copied MP3. Its own output name
 * matters too: the clean and watermark renders are both `video.mp4` in
 * different directories, so a shared name would let this
 * normalize truncate the already-validated clean delivery mid-upload.
 */
export async function resolveWatermarkAudio(
  bakedPath: string,
  renderedPath: string,
  workDir: string,
): Promise<string> {
  if (bakedPath !== renderedPath) {
    return bakedPath
  }
  return normalizeDeliveredAudioToAac(bakedPath, workDir, 'wm_aac.mp4')
}
