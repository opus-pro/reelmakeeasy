/**
 * A loop's keyframes (beat-loop skill, section 3): f0 from text, then f1..f(N-1) one after
 * another, each an edit of the frame before it used only as a style reference, so the whole
 * loop keeps one look. Every prompt carries the STYLE and the no-text line; each frame gets one
 * re-roll when the text check still sees letters or numbers. fN is a byte copy of f0, which
 * closes the loop. Writes the long-take files the render and the editor read: keyframes.json and
 * shot_plan.json (one shot per clip).
 *
 * Every frame goes on record (`beat_loop_keyframes.json`) as soon as it is made, with the
 * prompt dialect the frames are written in. A later try (the activity's retry, Try again, a
 * redo) reuses the frames in order for as long as their prompts match, in that same dialect
 * whichever model the clips are on now, and makes only the rest.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  BEAT_CLIP_SECONDS,
  type BeatClipDialect,
  beatLoopDialect,
  buildBeatClipPrompt,
  buildBeatKeyframePrompt,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import { isMissingObjectError } from '@reelmakeeasy/common/storage/missing'
import { resolveRole } from '@reelmakeeasy/llm/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import type { LongTakeKeyframeItem, LongTakeShotPlanItem } from '../../workflows/long-take/types'
import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'
import { runImageGenerationWithRecord } from '../long-take-image-generation-record'

import { beatLoopClipModels, noBeatLoopModelMessage, withBeatLoopProvider } from './providers'
import { startBeatLoopClipsOver } from './qa-store'
import { findBeatLoopText } from './text-check'

export const BEAT_LOOP_KEYFRAMES_PATH = 'long_take/beat_loop_keyframes.json'
const KEYFRAMES_DIR = 'long_take/keyframes'
const KEYFRAMES_JSON_PATH = 'long_take/keyframes.json'
const SHOT_PLAN_PATH = 'long_take/shot_plan.json'
const KEYFRAME_TASK = 'beat-loop-keyframe'

export interface BeatLoopKeyframeResult {
  /** fN: the frame this one copies, byte for byte. */
  copyOf?: string
  id: string
  imageModel?: string
  prompt: string
  textCheck?: BeatLoopKeyframeTextCheck
  /** The stored picture. */
  uri: string
}

export interface BeatLoopKeyframeTextCheck {
  detail?: string
  /** Set when the check itself failed; the frame is kept. */
  error?: string
  hasText: boolean
  rerolled: boolean
}

export interface GenerateBeatLoopKeyframesParams {
  projectId: string
  /**
   * The generation each clip starts over in when the frames are made again (the workflow's
   * restart plan). Set on the stored clips before the first frame is written over, so a run
   * that stops after that never reuses clips made on the old frames.
   */
  restartGenerations?: number[]
  storyboard: BeatLoopStoryboard
  style: string
  userId: string
}

export interface GenerateBeatLoopKeyframesResult {
  /** N + 1 frames: f0..f(N-1), then fN (the copy of f0). Clip k goes from frame k-1 to frame k. */
  frames: BeatLoopKeyframeResult[]
  keyframesPath: string
  /** True when every frame came from the record: clips made on them still land where they did. */
  reused: boolean
  shotPlanPath: string
}

/** The record of the frames made so far. */
interface StoredKeyframes {
  /** Set once fN (the copy of f0) is in and the long-take files are written. */
  complete: boolean
  /** The prompt dialect the frames were written in (that of the loop model when they were made). */
  dialect: BeatClipDialect
  /** In order, from f0; fN last once complete. */
  frames: BeatLoopKeyframeResult[]
}

/** Activity: the loop's N + 1 keyframes, made in order (or reused from an earlier attempt). */
export async function generateBeatLoopKeyframes(
  params: GenerateBeatLoopKeyframesParams,
): Promise<GenerateBeatLoopKeyframesResult> {
  const { projectId, storyboard, style, userId } = params
  return withLongTakeContext({ projectId, sceneId: 'beat_loop', userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const clipCount = storyboard.clips.length
      const closingId = storyboard.keyframes[clipCount]?.id ?? `f${clipCount}`
      const stored = await readStored(storage)
      // The frames already made keep the dialect they were written in; new ones take that of
      // the model every clip tries first.
      let dialect = stored?.dialect ?? loopDialect()
      let shots = keyframeShots(storyboard, style, dialect)
      let frames = reusableFrames(stored, shots, dialect)
      if (!frames.length && stored && stored.dialect !== loopDialect()) {
        dialect = loopDialect()
        shots = keyframeShots(storyboard, style, dialect)
        frames = []
      }
      const result = {
        keyframesPath: KEYFRAMES_JSON_PATH,
        shotPlanPath: SHOT_PLAN_PATH,
      }
      const closing = stored?.frames[clipCount]
      if (
        stored?.complete &&
        frames.length === shots.length &&
        closing?.id === closingId &&
        closing.copyOf === frames[0]?.id
      ) {
        logger.info(
          `[beat-loop] Reusing the keyframes already made ${formatLogFields({ projectId })}`,
        )
        return { ...result, frames: [...frames, closing], reused: true }
      }
      if (frames.length) {
        logger.info(
          `[beat-loop] Resuming the keyframes ${formatLogFields({ made: frames.length, projectId })}`,
        )
      }
      // The frames change from here on: clips made on the old ones can't be kept any more.
      if (params.restartGenerations) {
        await startBeatLoopClipsOver(
          projectId,
          storyboard.clips.map((clip) => clip.id),
          params.restartGenerations,
        )
      }

      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `beat-loop-kf-${projectId}-`),
      )
      try {
        for (const shot of shots.slice(frames.length)) {
          frames.push(
            await makeKeyframe({
              id: shot.id,
              previousUri: frames.at(-1)?.uri,
              projectId,
              prompt: shot.prompt,
              storage,
              tempDir,
              userId,
            }),
          )
          // On record at once: a retry goes on from the next frame.
          await writeStored(storage, { complete: false, dialect, frames })
        }
        const first = frames[0]
        const closingPath = `${KEYFRAMES_DIR}/${closingId}.png`
        // The loop closes on the exact pixels it opened with.
        await storage.copyFile(`${KEYFRAMES_DIR}/${first.id}.png`, closingPath)
        const all = [
          ...frames,
          {
            copyOf: first.id,
            id: closingId,
            prompt: first.prompt,
            uri: storage.getFullPath(closingPath),
          },
        ]

        await writeLongTakeFiles({ dialect, frames: all, storage, storyboard, style })
        await writeStored(storage, { complete: true, dialect, frames: all })
        return { ...result, frames: all, reused: false }
      } finally {
        await fs.promises.rm(tempDir, { force: true, recursive: true })
      }
    }),
  )
}

/** Each shot's id and picture prompt in `dialect` (frames f0..f(N-1)). */
function keyframeShots(
  storyboard: BeatLoopStoryboard,
  style: string,
  dialect: BeatClipDialect,
): { id: string; prompt: string }[] {
  const clipCount = storyboard.clips.length
  const shots = storyboard.keyframes.slice(0, clipCount).map((keyframe, index) => {
    if (!keyframe.prompt) {
      throw ApplicationFailure.nonRetryable(
        `Keyframe ${keyframe.id} needs a prompt: only the last keyframe may copy the first`,
        'BeatLoopBadKeyframe',
      )
    }
    return {
      id: keyframe.id,
      prompt: buildBeatKeyframePrompt(keyframe.prompt, style, { dialect, fromPrevious: index > 0 }),
    }
  })
  if (shots.length !== clipCount) {
    throw ApplicationFailure.nonRetryable(
      `${clipCount} clips need ${clipCount} keyframes; the storyboard has ${shots.length}`,
      'BeatLoopBadKeyframe',
    )
  }
  return shots
}

/**
 * The stored frames still good for `shots`, from f0 on: each one is an edit of the frame before
 * it, so reuse stops at the first frame whose prompt differs.
 */
function reusableFrames(
  stored: StoredKeyframes | undefined,
  shots: { id: string; prompt: string }[],
  dialect: BeatClipDialect,
): BeatLoopKeyframeResult[] {
  if (!stored || stored.dialect !== dialect) return []
  const frames: BeatLoopKeyframeResult[] = []
  for (const [index, shot] of shots.entries()) {
    const frame = stored.frames[index]
    if (frame?.id !== shot.id || frame.prompt !== shot.prompt || frame.copyOf) break
    frames.push(frame)
  }
  return frames
}

/** One frame: generated (an edit of the previous one after f0), stored, text-checked. */
async function makeKeyframe(input: {
  id: string
  previousUri?: string
  projectId: string
  prompt: string
  storage: ReturnType<typeof createLongTakeStorage>
  tempDir: string
  userId: string
}): Promise<BeatLoopKeyframeResult> {
  const { id, previousUri, projectId, prompt, storage, tempDir, userId } = input
  const storagePath = `${KEYFRAMES_DIR}/${id}.png`
  const role = previousUri ? 'image.edit' : 'image.generate'
  const customModel = resolveRole(role)?.key
  if (!customModel) {
    throw ApplicationFailure.nonRetryable(
      `No picture model is set for ${role}, so the loop's keyframes can't be made`,
      'BeatLoopNoImageModel',
    )
  }
  let imageModel = customModel
  const generate = async (attempt: number): Promise<string> => {
    const outputPath = path.join(tempDir, `${id}-${attempt}.png`)
    await runImageGenerationWithRecord({
      aspectRatio: '9:16',
      contents: previousUri ? [{ imageUrl: previousUri, type: 'image_url' }] : [],
      customModel,
      onModelSucceeded: (model) => {
        imageModel = model
      },
      outputPath,
      outputUri: storage.getFullPath(storagePath),
      projectId,
      prompt,
      shotId: id,
      task: KEYFRAME_TASK,
      userId,
    })
    return outputPath
  }

  let localPath = await generate(1)
  let check = await checkText(localPath)
  let rerolled = false
  if (check.hasText) {
    logger.warn(
      `[beat-loop] Keyframe has text, making it again ${formatLogFields({
        detail: check.detail,
        id,
        projectId,
      })}`,
    )
    localPath = await generate(2)
    check = await checkText(localPath)
    rerolled = true
  }
  await storage.uploadFile(localPath, storagePath)
  return {
    id,
    imageModel,
    prompt,
    textCheck: { ...check, rerolled },
    uri: storage.getFullPath(storagePath),
  }
}

/** The text check never blocks a frame by failing itself. */
async function checkText(localPath: string): Promise<Omit<BeatLoopKeyframeTextCheck, 'rerolled'>> {
  try {
    return await findBeatLoopText(localPath)
  } catch (error) {
    return { error: formatError(error).message, hasText: false }
  }
}

/** The dialect of the model every clip tries first: the first loop model this run can call. */
function loopDialect(): BeatClipDialect {
  const [first] = beatLoopClipModels()
  if (!first) throw ApplicationFailure.nonRetryable(noBeatLoopModelMessage(), 'BeatLoopNoModel')
  return withBeatLoopProvider(first.provider, () => beatLoopDialect(first.key))
}

/**
 * The frames made so far; none only when there is no record yet. A record that is there but
 * can't be read fails the step (retryable): read as none, the frames would be made again and
 * every clip already made on them would start over, paid for again.
 */
async function readStored(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<StoredKeyframes | undefined> {
  let stored: Partial<StoredKeyframes> | undefined
  try {
    stored = await storage.readJsonFile<Partial<StoredKeyframes>>(BEAT_LOOP_KEYFRAMES_PATH)
  } catch (error) {
    if (isMissingObjectError(error)) return undefined
    throw ApplicationFailure.retryable(
      `${BEAT_LOOP_KEYFRAMES_PATH} can't be read: ${formatError(error).message}. Every clip is made on these frames, so the loop stopped rather than make them, and the clips, again: fix the file, or delete it to make them all again.`,
      'BeatLoopKeyframesUnreadable',
    )
  }
  if (!stored?.dialect || !Array.isArray(stored.frames)) return undefined
  return { complete: stored.complete === true, dialect: stored.dialect, frames: stored.frames }
}

async function writeStored(
  storage: ReturnType<typeof createLongTakeStorage>,
  record: StoredKeyframes,
): Promise<void> {
  await storage.writeJsonFile<StoredKeyframes>(BEAT_LOOP_KEYFRAMES_PATH, record)
}

/** keyframes.json and shot_plan.json: one shot per clip, each 4 s, frame k opening clip k+1. */
async function writeLongTakeFiles(input: {
  dialect: BeatClipDialect
  frames: BeatLoopKeyframeResult[]
  storage: ReturnType<typeof createLongTakeStorage>
  storyboard: BeatLoopStoryboard
  style: string
}): Promise<void> {
  const { dialect, frames, storage, storyboard, style } = input
  const shots = frames.slice(0, storyboard.clips.length)
  const keyframes: LongTakeKeyframeItem[] = shots.map((frame) => ({
    finalPrompt: frame.prompt,
    hasGibberish: frame.textCheck?.hasText ?? false,
    ...(frame.imageModel ? { imageModel: frame.imageModel } : {}),
    keyframeUrl: frame.uri,
    shotId: frame.id,
  }))
  const shotPlan: LongTakeShotPlanItem[] = shots.map((frame, index) => {
    const clip = storyboard.clips[index]
    return {
      audio: clip.narration,
      keyframe_prompt: frame.prompt,
      shot_id: frame.id,
      time_range: { end: (index + 1) * BEAT_CLIP_SECONDS, start: index * BEAT_CLIP_SECONDS },
      transition_to_next: 'continuous',
      video_prompt: buildBeatClipPrompt(clip, style, dialect),
    }
  })
  await Promise.all([
    storage.writeJsonFile(KEYFRAMES_JSON_PATH, keyframes),
    storage.writeJsonFile(SHOT_PLAN_PATH, shotPlan),
  ])
}
