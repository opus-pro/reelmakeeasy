import * as fs from 'node:fs'
import * as path from 'node:path'

import type { CaptionSegment } from '../adapters/caption/caption-painter'
import type { CaptionRenderReference } from '../adapters/caption/caption-render-preference.zod'
import type { CaptionRenderPref } from '../adapters/caption/caption-style'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'
import { TextAdapter } from '../adapters/text-adapter'
import { STORY_LOADER_PATHS } from '../agent-v2/paths'
import type { CaptionTrack, FactsTrack } from '../types/video-script'
import { filePath, storedFileExists } from '../storage/stored-files'

import { applyBeatLoopFinish, type BeatLoopMusic } from './beat-loop-finish'
import { writeBeatLoopSfxBed } from './beat-loop-sfx-bed'
import { BEAT_CLIP_SECONDS, BEAT_STAMP_WINDOW } from './beat-loop-timing'
import { resolveBgmDuckDbForVolume } from './bgm-volume'
import { buildCaptionTrackIfEnabled } from './caption-track'
import { formatLogFields } from './log-fields'
import type {
  BeatLoopCaptions,
  FinalizeRenderInput,
  RenderFinalStorage,
} from './render-final.types'

/**
 * Delivery of a loop short: what finalizeRender (render-final.ts) does to a loop's render
 * after the AAC step, and what that needs from the project's files.
 *
 * A project is a loop short when `long_take/beat_loop.json` (its storyboard) exists. Its
 * render (beat-loop-render.ts) uploads the beat-locked clips back to back with their own
 * sound only, no voice, no music and no captions, to BEAT_LOOP_CONCAT_PATH. finalizeRender
 * hands that file here once its audio is AAC, and the finish pass (beat-loop-finish.ts)
 * draws the captions and stamps, mixes the voice-over over the clips' sound, masters to
 * -14 LUFS and upscales to 1080x1920 in one encode. The captions are the app's own: the
 * loop's caption track in the video's caption style, through the same adapter and painter
 * as every other video's export, so the editor previews what is delivered. So are the
 * stamps: the loop's facts track (beatLoopFactsTrack), in the style's highlight colour. Every
 * render of a loop (the first one, render_video, the caption toggle, editor export) comes
 * through renderLongTakeVideo, so through here.
 */

/** A loop short's storyboard (the beat-loop skill's section 10), written when the loop starts. */
export const BEAT_LOOP_STORYBOARD_PATH = 'long_take/beat_loop.json'
/** The loop's clips back to back with their own sound: what a loop's render hands finalizeRender. */
export const BEAT_LOOP_CONCAT_PATH = 'long_take/beat_loop_clips.mp4'

/**
 * What the render reads from the storyboard. Its `caption_style` and `accent` are not read: the
 * captions and stamps take the video's caption style.
 */
export interface BeatLoopRenderSpec {
  /** duration_s / 4. */
  clipCount: number
  /** One per clip, in order: the fact stamp, or null for none. */
  stamps: Array<null | string>
}

/** The fields of a stored storyboard (and its clips) the render reads, before they are checked. */
interface LooseFields {
  clips?: unknown
  duration_s?: unknown
  stamp?: unknown
  storyboard?: unknown
}

/**
 * Reads the render's part of a stored storyboard: the storyboard itself, or one kept under
 * `storyboard`. Lenient on purpose: the storyboard was checked when the loop started, and a
 * check added since must not stop an old loop from rendering again. It throws only on what
 * cannot be rendered: no clips, or a length that disagrees with them.
 */
export function parseBeatLoopRenderSpec(raw: unknown): BeatLoopRenderSpec {
  const board = isRecord(raw) && isRecord(raw.storyboard) ? raw.storyboard : raw
  const clips = isRecord(board) && Array.isArray(board.clips) ? (board.clips as unknown[]) : []
  if (!isRecord(board) || clips.length === 0) {
    throw new Error(`${BEAT_LOOP_STORYBOARD_PATH} has no clips`)
  }
  if (
    typeof board.duration_s === 'number' &&
    board.duration_s !== clips.length * BEAT_CLIP_SECONDS
  ) {
    throw new Error(
      `${BEAT_LOOP_STORYBOARD_PATH} lasts ${board.duration_s} s but has ${clips.length} clips of ${BEAT_CLIP_SECONDS} s`,
    )
  }
  return {
    clipCount: clips.length,
    stamps: clips.map((clip) =>
      isRecord(clip) && typeof clip.stamp === 'string' ? clip.stamp : null,
    ),
  }
}

/** The loop's storyboard, or undefined when the project is not a loop short. */
export async function readBeatLoopRenderSpec(
  storage: Pick<RenderFinalStorage, 'getFullPath' | 'readJsonFile'>,
): Promise<BeatLoopRenderSpec | undefined> {
  if (!(await storedFileExists(storage.getFullPath(BEAT_LOOP_STORYBOARD_PATH)))) {
    return undefined
  }
  return parseBeatLoopRenderSpec(await storage.readJsonFile<unknown>(BEAT_LOOP_STORYBOARD_PATH))
}

/** One fact stamp and when it shows, in seconds of the video. */
export interface BeatLoopStampCue {
  endS: number
  startS: number
  text: string
}

/** Stamp cues from the storyboard's per-clip stamps: 0.3-3.0 s into each clip. */
export function beatLoopStampCues(
  stamps: ReadonlyArray<null | string | undefined>,
  clipSeconds = BEAT_CLIP_SECONDS,
): BeatLoopStampCue[] {
  const { end: to, start: from } = BEAT_STAMP_WINDOW
  return stamps.flatMap((stamp, k) => {
    const text = stamp?.trim()
    if (!text) return []
    return [{ endS: round3(k * clipSeconds + to), startS: round3(k * clipSeconds + from), text }]
  })
}

/**
 * The loop's fact stamps as a video script track (the skill's section 7: a short exact label per
 * clip, for 0.3-3.0 s of its bar). Its own track, not the caption track, so the caption switch
 * never hides it. The render saves it in the video script for the editor, and the finish pass
 * draws the same track (beatLoopStampSegments). A loop whose clips have no stamp gets an empty
 * one, saved all the same: a loop's video script without the track is one not rendered since
 * stamps became a track, whose stamps only its file has.
 */
export function beatLoopFactsTrack(stamps: ReadonlyArray<null | string | undefined>): FactsTrack {
  return {
    id: 'track-facts',
    segments: beatLoopStampCues(stamps).map((cue, i) => ({
      content: { id: `content-fact-${i}`, text: cue.text },
      id: `segment-fact-${i}`,
      timeline: { in: Math.round(cue.startS * 1000), out: Math.round(cue.endS * 1000) },
    })),
    type: 'facts',
  }
}

/**
 * The loop's fact stamps as segments for the caption painter: its facts track in `renderPref`'s
 * highlight colour, as the editor preview draws it (TextAdapter.genFactStampTrack). Drawn with
 * the captions on or off.
 */
export function beatLoopStampSegments(
  stamps: ReadonlyArray<null | string | undefined>,
  renderPref: CaptionRenderReference,
): CaptionSegment[] {
  const track = beatLoopFactsTrack(stamps)
  return TextAdapter.genFactStampTrack({ renderPref, track }).segs as unknown as CaptionSegment[]
}

/**
 * A loop's caption track in `renderPref`'s style, as segments for the caption painter: what
 * every video's export draws (TextAdapter.genCaptionTextTracks, as VideoScriptAdapter calls it,
 * without the caption cover the local renderer never draws). Every layer, bottom first:
 * Explainer's paper strips come before the captions on them, and the painter draws segments
 * that start together in the order given. None when the style turns the captions off.
 */
export async function beatLoopCaptionSegments(
  track: CaptionTrack,
  renderPref: CaptionRenderPref,
): Promise<CaptionSegment[]> {
  const layers = await TextAdapter.genCaptionTextTracks({ renderPref, track })
  return layers.flatMap((layer) => layer.segs) as unknown as CaptionSegment[]
}

/**
 * finalizeRender's loop step, run on the delivery once its audio is AAC: for the loop's
 * clips (BEAT_LOOP_CONCAT_PATH) the finish pass, for any other render nothing. Returns the
 * file to deliver. `captionAdded` is the caption toggle: off keeps the stamps and draws no
 * captions. The stamps take the caption style's highlight colour either way (captionStampColor:
 * Explainer's box colour, not its ink), and the caption painter draws them like the captions.
 */
export async function finishBeatLoopDelivery(
  input: Pick<
    FinalizeRenderInput,
    | 'beatLoopCaptions'
    | 'beatLoopMusic'
    | 'captionAdded'
    | 'cleanVideoUri'
    | 'logger'
    | 'projectId'
    | 'storage'
  >,
  videoSourcePath: string,
  workDir: string,
): Promise<string> {
  const { captionAdded, logger, projectId, storage } = input
  if (input.cleanVideoUri !== storage.getFullPath(BEAT_LOOP_CONCAT_PATH)) {
    return videoSourcePath
  }
  const spec = await readBeatLoopRenderSpec(storage)
  if (!spec) {
    throw new Error(`The loop's clips were rendered, but ${BEAT_LOOP_STORYBOARD_PATH} is missing`)
  }
  const loopDir = path.join(workDir, 'beat-loop')
  await fs.promises.mkdir(loopDir, { recursive: true })
  const voicePath = localPathOf(storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath))
  // The render resolved the captions once and set captionAdded from them; read here only
  // without them.
  const { captionRenderPref, captionTrack } =
    input.beatLoopCaptions ?? (await readBeatLoopCaptions(input))
  const captions =
    captionAdded && captionTrack
      ? await beatLoopCaptionSegments(captionTrack, captionRenderPref)
      : []
  const stamps = beatLoopStampSegments(spec.stamps, captionRenderPref)
  const music = await readLoopMusic(input, loopDir)
  const result = await applyBeatLoopFinish({
    captions,
    durationS: spec.clipCount * BEAT_CLIP_SECONDS,
    ...(music ? { music } : {}),
    outputPath: path.join(workDir, 'beat_loop_final.mp4'),
    stamps,
    videoPath: videoSourcePath,
    voicePath,
    workDir: loopDir,
  })
  await storeLoopSfxBed(input, result, { sfxPath: videoSourcePath, voicePath, workDir: loopDir })
  logger.info(
    `[long-take] Beat-loop finish done ${formatLogFields({
      captions: captions.length,
      delivered: result.delivered,
      music: Boolean(music),
      normalizationType: result.normalizationType,
      projectId,
      stamps: stamps.length,
      targetLufs: result.targetLufs,
    })}`,
  )
  return result.outputPath
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function isRecord(value: unknown): value is LooseFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The music the user added to the loop, as a local file at its level; none when it is off or
 * at 0%. Best-effort like every video's music bake: a bed that cannot be read only warns, and
 * the loop ships with its own sound.
 */
async function readLoopMusic(
  input: Pick<FinalizeRenderInput, 'beatLoopMusic' | 'logger' | 'projectId'>,
  workDir: string,
): Promise<BeatLoopMusic | undefined> {
  const setting = input.beatLoopMusic
  if (!setting || setting.volume <= 0) return undefined
  try {
    if (!(await storedFileExists(setting.bedUri))) {
      throw new Error('the music file is missing')
    }
    const bedPath = localPathOf(setting.bedUri)
    return { duckDb: resolveBgmDuckDbForVolume(setting.volume), path: bedPath }
  } catch (error) {
    input.logger.warn(
      `[long-take] Could not read the loop's music; delivering it without music ${formatLogFields({
        bedUri: setting.bedUri,
        err: error instanceof Error ? error.message.split('\n')[0] : String(error),
        projectId: input.projectId,
      })}`,
    )
    return undefined
  }
}

/**
 * The captions of a render that didn't hand them over: the loop's caption track in the default
 * style, read only when the render added captions. A loop with captions on never ships without
 * them (`required`). The loop render always hands its look over (renderBeatLoopFinal); this is
 * for a caller that doesn't, which also hands over no caption settings, so finalizeRender
 * records the file's look as null, read as this same default (getDefaultCaptionRenderPref, see
 * captionLookChanged): the record stays true to the file, and Download renders it again into the
 * loop's own look.
 */
async function readBeatLoopCaptions(
  input: Pick<FinalizeRenderInput, 'captionAdded' | 'logger' | 'storage'>,
): Promise<BeatLoopCaptions> {
  return {
    captionRenderPref: getDefaultCaptionRenderPref(),
    captionTrack: input.captionAdded
      ? await buildCaptionTrackIfEnabled({
          enableCaption: true,
          logger: input.logger,
          required: true,
          segmentWindows: true,
          storage: input.storage,
        })
      : undefined,
  }
}

/**
 * Stores the loop's clip sound bed for the live preview (beat-loop-sfx-bed.ts): the clips' sound
 * from the file the finish took it from, levelled as the finish mixed it (measured again from
 * the same files if the finish didn't say). Best-effort: without one the chat plays the delivered
 * file instead, so a failure only warns.
 */
async function storeLoopSfxBed(
  input: Pick<FinalizeRenderInput, 'logger' | 'projectId' | 'storage'>,
  finish: Pick<Parameters<typeof writeBeatLoopSfxBed>[1], 'durationS' | 'levels'>,
  sources: { sfxPath: string; voicePath: string; workDir: string },
): Promise<void> {
  try {
    await writeBeatLoopSfxBed(input.storage, {
      durationS: finish.durationS,
      levels: finish.levels,
      ...sources,
    })
  } catch (error) {
    input.logger.warn(
      `[long-take] Could not store the loop's clip sound bed ${formatLogFields({
        err: error instanceof Error ? error.message.split('\n')[0] : String(error),
        projectId: input.projectId,
      })}`,
    )
  }
}

/** A stored file as a local path: stored files are on this disk, so its own path (read only). */
export function localPathOf(uri: string): string {
  return filePath(uri)
}
