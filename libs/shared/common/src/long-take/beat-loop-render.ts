import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { LongTakeKeyframe } from '@shared/types/api/long-take'

import type { RenderedCaptionStyle } from '../adapters/caption/caption-look'
import type { CaptionRenderPref } from '../adapters/caption/caption-style'
import { STORYBOARD_PATHS } from '../agent-v2/paths'
import type { AspectRatio } from '../media/types'
import { BEAT_LOCK_FPS, joinClipAudio } from '../utils/beat-lock'

import {
  BEAT_LOOP_CONCAT_PATH,
  beatLoopFactsTrack,
  type BeatLoopRenderSpec,
  localPathOf,
} from './beat-loop-delivery'
import { BEAT_LOOP_FRAME } from './beat-loop-finish'
import { BEAT_CLIP_SECONDS } from './beat-loop-timing'
import { buildCaptionTrackIfEnabled } from './caption-track'
import { formatError, formatLogFields } from './log-fields'
import { finalizeRender, prepareRenderScripts } from './render-final'
import type {
  BeatLoopMusicSetting,
  RenderFinalLogger,
  RenderFinalResult,
  RenderFinalStorage,
  RenderFinalTransitionVideo,
  ThumbnailFallbackFn,
} from './render-final.types'
import { getDeliveryCanvasSize } from './render-frame-area'
import {
  normalizeTransitionRenderUris,
  resolveTransitionRenderVideoUri,
} from './render-transition-video-uri'

/**
 * The render of a loop short (a project with `long_take/beat_loop.json`): renderLongTakeVideo
 * comes here instead of renderFinal, so the first render, render_video, the caption toggle and
 * editor export all take this path.
 *
 * The render engine is not used: it would upscale each clip with its own filter and mix the
 * voice over hard-cut clip sounds. Instead the beat-locked clips are joined here, at exactly
 * 96 frames (4.000 s) each, with their own sound only (joined with the beat-lock's joint
 * fades), and finalizeRender delivers that file like any render: its AAC step, then the finish
 * pass (beat-loop-delivery.ts), which adds the voice-over, the captions and stamps and the
 * master, then the checks, the uploads, the thumbnail and the project patch. The captions are
 * the app's own (the loop's caption track in the video's caption style, drawn by the export's
 * caption painter) and the video script saves both, so the editor previews what is delivered.
 * The stamps too: the video script saves the loop's facts track, which both draw in the
 * style's highlight colour.
 * Music, when the user turned it on, only through the finish pass (beatLoopMusic), never the
 * story bake; no watermark variant (the finish pass draws on the clean video only).
 */

/** Where finalizeRender delivers every render, a loop's included. */
const BEAT_LOOP_DELIVERED_PATH = 'final_video.mp4'

// The joined clips are encoded once more by the finish pass: keep this generation close to the
// clips (the beat-lock's intermediates are crf 16).
const CONCAT_VIDEO_CODEC_ARGS: readonly string[] = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '12',
  '-pix_fmt',
  'yuv420p',
]
const SAMPLE_RATE = 48_000
// A 32 s join takes seconds; the bound only stops a wedged ffmpeg.
const FFMPEG_TIMEOUT_MS = 10 * 60_000

export interface BeatLoopRenderInput {
  /** The project's ratio, as every render is given it; a loop is always rendered at 9:16. */
  aspectRatio?: AspectRatio
  /** The voice-over (`story_loader/audio/voice_over.mp3`), for the saved video script. */
  audioSourceUri: string
  beatLoop: BeatLoopRenderSpec
  /** The video's caption style, resolved once by the render activity. */
  captionRenderPref: CaptionRenderPref
  /** The settings that style came from, recorded in the video script beside it. */
  captionStyle?: RenderedCaptionStyle
  /** The caption toggle; null (projects from before the toggle) shows captions. */
  enableCaption?: boolean | null
  getThumbnailFallback: ThumbnailFallbackFn
  keyframesToCommit?: LongTakeKeyframe[]
  logger: RenderFinalLogger
  /** The music the user added (off by default): the finish pass mixes it under the loop. */
  music?: BeatLoopMusicSetting
  projectId: string
  storage: RenderFinalStorage
  transitionVideos: RenderFinalTransitionVideo[]
  userContext: { userEmail: string; userId: string }
}

/** Renders and delivers a loop short; resolves like renderFinal. */
export async function renderBeatLoopFinal(input: BeatLoopRenderInput): Promise<RenderFinalResult> {
  const { beatLoop, captionRenderPref, logger, projectId, storage } = input
  // A loop is always joined at 1080x1920: its script canvas and thumbnail follow, whatever
  // ratio the project row carries.
  const aspectRatio: AspectRatio = '9:16'
  const startedAt = Date.now()
  const totalDurationMs = beatLoop.clipCount * BEAT_CLIP_SECONDS * 1000
  try {
    const transitionVideos = beatLoopGrid(input.transitionVideos, beatLoop.clipCount)
    logger.info(
      `[long-take] Beat-loop render started ${formatLogFields({
        clips: beatLoop.clipCount,
        projectId,
        userId: input.userContext.userId,
      })}`,
    )
    // Read once, before any work: the finish pass draws this track, and a loop with captions on
    // fails here rather than ship without them. Every loop transcript holds one chunk per
    // segment, each shown until the next one, older ones included.
    const captionTrack = await buildCaptionTrackIfEnabled({
      enableCaption: input.enableCaption,
      logger,
      required: true,
      segmentWindows: true,
      storage,
    })
    // The cut's video script, saved like every render's: the clips on the grid under the
    // voice-over, and the captions with their style. The picture itself is made below.
    const { videoScript } = await prepareRenderScripts({
      audioDurationMs: totalDurationMs,
      audioSourceUri: input.audioSourceUri,
      captionRenderPref,
      captionStyle: input.captionStyle,
      captionTrack,
      logger,
      storage,
      targetCanvas: getDeliveryCanvasSize(aspectRatio),
      transitionVideos,
    })
    // And the fact stamps on top, captions or not, so the editor previews them as the finish
    // pass draws them. A loop rendered before stamps were a track gets them here, and a loop
    // without stamps an empty track: the editor reads a missing one as "not rendered since".
    await storage.writeJsonFile(STORYBOARD_PATHS.videoScriptPath, {
      ...videoScript,
      tracks: [...videoScript.tracks, beatLoopFactsTrack(beatLoop.stamps)],
    })
    await uploadBeatLoopClips(storage, transitionVideos)
    const result = await finalizeRender({
      aspectRatio,
      beatLoopCaptions: { captionRenderPref, captionTrack },
      ...(input.music ? { beatLoopMusic: input.music } : {}),
      captionAdded: Boolean(captionTrack),
      captionStyle: input.captionStyle,
      cleanVideoUri: storage.getFullPath(BEAT_LOOP_CONCAT_PATH),
      getThumbnailFallback: input.getThumbnailFallback,
      keyframesToCommit: input.keyframesToCommit,
      logger,
      projectId,
      startedAt,
      storage,
      totalDurationMs,
      transitionVideos,
      userContext: input.userContext,
    })
    // The delivered loop, not the clips it was made from (finalizeRender's videoUri is its
    // input): what the run reports and logs.
    return { ...result, videoUri: storage.getFullPath(BEAT_LOOP_DELIVERED_PATH) }
  } catch (error) {
    logger.error(
      `[long-take] Beat-loop render failed ${formatLogFields({ err: formatError(error), projectId })}`,
    )
    throw error
  }
}

/**
 * The loop's clips in order on the beat grid: clip k from k*4 s to (k+1)*4 s, whatever times
 * they were stored with (the beat-lock made each one exactly 4 s). Throws when they are not the
 * storyboard's clip count.
 */
export function beatLoopGrid<T extends Pick<RenderFinalTransitionVideo, 'endMs' | 'startMs'>>(
  transitions: readonly T[],
  clipCount: number,
): T[] {
  if (transitions.length !== clipCount) {
    throw new Error(`The loop has ${clipCount} clips, but ${transitions.length} came to the render`)
  }
  const clipMs = BEAT_CLIP_SECONDS * 1000
  return [...transitions]
    .sort((a, b) => a.startMs - b.startMs)
    .map((t, k) => ({ ...t, endMs: (k + 1) * clipMs, startMs: k * clipMs }))
}

/**
 * The picture of the joined clips (`[v]`): each clip's first 96 frames at 24 fps (its last
 * frame held when it runs short), cover-scaled to `frame` with Lanczos so clips of different
 * sizes match (one resample: the finish pass then has nothing to scale), back to back.
 * Inputs 0..clipCount-1 are the clips.
 */
export function buildBeatLoopConcatFilter(options: {
  clipCount: number
  frame?: { height: number; width: number }
}): string {
  const { height, width } = options.frame ?? BEAT_LOOP_FRAME
  const frames = Math.round(BEAT_CLIP_SECONDS * BEAT_LOCK_FPS)
  const chains = Array.from(
    { length: options.clipCount },
    (_, k) =>
      `[${k}:v]setpts=PTS-STARTPTS,fps=${BEAT_LOCK_FPS},` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,` +
      `tpad=stop_mode=clone:stop_duration=${BEAT_CLIP_SECONDS},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${k}]`,
  )
  const labels = chains.map((_, k) => `[v${k}]`).join('')
  chains.push(`${labels}concat=n=${options.clipCount}:v=1:a=0,format=yuv420p[v]`)
  return chains.join(';')
}

/**
 * Joins the clips into one file of exactly clipCount * 4 s: the picture from
 * buildBeatLoopConcatFilter, the sound from joinClipAudio (each clip's own sound on the grid,
 * faded at the joints and at the loop point; a clip without sound adds silence).
 */
export async function concatBeatLoopClips(options: {
  clipPaths: readonly string[]
  frame?: { height: number; width: number }
  outputPath: string
  /** Scratch space for the joined sound; the caller removes it. */
  workDir: string
}): Promise<string> {
  const { clipPaths, outputPath } = options
  const soundPath = path.join(options.workDir, 'beat_loop_clip_sound.wav')
  await joinClipAudio({ clipPaths, outputPath: soundPath })
  await run([
    ...clipPaths.flatMap((clipPath) => ['-i', clipPath]),
    '-i',
    soundPath,
    '-filter_complex',
    buildBeatLoopConcatFilter({ clipCount: clipPaths.length, frame: options.frame }),
    '-map',
    '[v]',
    '-map',
    `${clipPaths.length}:a:0`,
    ...CONCAT_VIDEO_CODEC_ARGS,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    String(SAMPLE_RATE),
    '-t',
    String(clipPaths.length * BEAT_CLIP_SECONDS),
    '-movflags',
    '+faststart',
    outputPath,
  ])
  return outputPath
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { encoding: 'utf8', timeout: FFMPEG_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg failed joining the loop's clips: ${error.message}\n${stderr}`))
          return
        }
        resolve()
      },
    )
  })
}

/** Joins the clips the render opens (lip-sync choice, current bucket) and stores the result. */
async function uploadBeatLoopClips(
  storage: RenderFinalStorage,
  transitionVideos: RenderFinalTransitionVideo[],
): Promise<void> {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'beat-loop-clips-'))
  try {
    const clipPaths = transitionVideos.map((t) =>
      localPathOf(resolveTransitionRenderVideoUri(normalizeTransitionRenderUris(t))),
    )
    const outputPath = path.join(workDir, 'beat_loop_clips.mp4')
    await concatBeatLoopClips({ clipPaths, outputPath, workDir })
    await storage.uploadFile(outputPath, BEAT_LOOP_CONCAT_PATH)
  } finally {
    await fs.promises.rm(workDir, { force: true, recursive: true })
  }
}
