// A new picture as one of a finished video's keyframes (agent edit mode's
// `use_image_as_keyframe`): what it makes again and costs, and the project
// files it changes. A story video's keyframe opens one clip and ends another,
// so those two are made again from the new picture with their own prompts and
// model; the picture becomes the keyframe once they are made, and the video is
// rendered again. A loop short's keyframes are chained, so its own service plans
// and runs the swap (`BeatLoopService.planKeyframeSwap` / `swapKeyframe`).

import type { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { videoModelCapabilities } from '@reelmakeeasy/common/video-models/registry'
import {
  clampResolution,
  modelRegistry,
  resolveModel,
  snapDuration,
} from '@reelmakeeasy/llm/registry'
import type { LongTakeTransition } from '@shared/types/api/long-take'
import sharp from 'sharp'

import { readOptionalJsonFile } from './long-take-helpers.util'

type Storage = Awaited<ReturnType<typeof createStorage>>

export const KEYFRAMES_PATH = 'long_take/keyframes.json'
export const KEYFRAME_THUMBNAILS_PATH = 'long_take/keyframe_thumbnails.json'
const KEYFRAMES_DIR = 'long_take/keyframes'
/** The editor's keyframe thumbnails: as the keyframes step makes them. */
const THUMBNAIL_MAX_DIMENSION = 256
/** What a clip is priced at when the project names no resolution (as `regenerate_clip`). */
const DEFAULT_VIDEO_RESOLUTION = '768p'

/** One clip a new keyframe picture makes again. */
export interface KeyframeSwapClip {
  endMs: number
  /** A story video's transitionId; a loop short's clip id from its storyboard. */
  id: string
  /** It ends on the keyframe (it leaves it otherwise). A loop's first clip listed lands on it. */
  lands: boolean
  /** Its place in the video, from 1. */
  number: number
  startMs: number
  /** What making it again costs on the model that makes it. */
  usd: number
}

/** What using a new picture as a keyframe makes again, and costs. Nothing is changed by it. */
export interface KeyframeSwapPlan {
  /** Every clip in the video, to say "clips 3 to 6 of 6". */
  clipCount: number
  /** The clips made again, in order. */
  clips: KeyframeSwapClip[]
  /** The keyframe picture's size now: the new picture is fitted to it. */
  frame: { height: number; width: number }
  /** A loop short: its clips are chained, and its own run makes them and the video. */
  loop: boolean
  /** The clip model, as the models file names it. */
  modelLabel: string
  /** The keyframe, as the project names it (a loop's closing copy of f0 is f0). */
  shotId: string
  totalUsd: number
}

/** A new keyframe picture in the project, not yet the keyframe (`commitKeyframePicture`). */
export interface StagedKeyframe {
  keyframeUri: string
  /** Where it is stored, in the project (`long_take/keyframes/<shotId>-<stamp>.png`). */
  picturePath: string
  thumbnailUri?: string
}

interface KeyframeEntry {
  [key: string]: unknown
  keyframeUrl: string
  shotId: string
  thumbnailUrl?: string
}

/** The clips that start or end on keyframe `shotId`, in the video's order, numbered from 1. */
export function clipsOnKeyframe(
  transitions: LongTakeTransition[],
  shotId: string,
): { number: number; transition: LongTakeTransition }[] {
  return transitions.flatMap((transition, index) =>
    transition.fromShotId === shotId || transition.toShotId === shotId
      ? [{ number: index + 1, transition }]
      : [],
  )
}

/**
 * What one story clip costs made again: the seconds the model bills for it (Hailuo makes whole
 * seconds from 5 to 15; the clip is then fitted to its place) at the model's rate for the
 * project's resolution (768p when it names none), from the models file. No model named: the
 * one transition clips are made on.
 */
export function storyClipUsd(input: {
  durationSeconds: number
  model?: string
  resolution?: string
}): number {
  const caps = videoModelCapabilities(input.model)
  const seconds = snapDuration(caps, input.durationSeconds)
  const resolution = clampResolution(caps, input.resolution ?? DEFAULT_VIDEO_RESOLUTION)
  const rates = Object.values(caps.usdPerSecond ?? {})
  const rate = caps.usdPerSecond?.[resolution] ?? (rates.length ? Math.min(...rates) : 0)
  return cents(seconds * rate)
}

/** The clip model's name as the models file labels it (its key when it has no label). */
export function clipModelLabel(model?: string): string {
  try {
    const { key } = resolveModel('video', model, { role: 'video.firstLast' })
    return modelRegistry().models[key]?.label ?? key
  } catch {
    return model ?? 'the video model'
  }
}

/** A picture's size in the project (a path or its `store://` URI), or null when it can't be read. */
export async function pictureSize(
  storage: Storage,
  pathOrUri: string,
): Promise<null | { height: number; width: number }> {
  try {
    const meta = await sharp(await storage.readFile(pathOrUri)).metadata()
    return meta.width && meta.height ? { height: meta.height, width: meta.width } : null
  } catch {
    return null
  }
}

/**
 * Writes the new picture (a PNG, already fitted) and its thumbnail under names of their own, so
 * the keyframe and its old picture stay as they are until the clips made from it are in.
 */
export async function stageKeyframePicture(
  storage: Storage,
  shotId: string,
  png: Buffer,
  stamp: string,
): Promise<StagedKeyframe> {
  const name = `${safeName(shotId)}-${stamp}`
  const picturePath = `${KEYFRAMES_DIR}/${name}.png`
  await storage.writeFile(picturePath, png)
  const staged: StagedKeyframe = { keyframeUri: storage.getFullPath(picturePath), picturePath }
  try {
    const thumbnail = await sharp(png)
      .resize({
        fit: 'inside',
        height: THUMBNAIL_MAX_DIMENSION,
        width: THUMBNAIL_MAX_DIMENSION,
      })
      .webp()
      .toBuffer()
    const thumbnailPath = `${KEYFRAMES_DIR}/thumbnails/${name}.webp`
    await storage.writeFile(thumbnailPath, thumbnail)
    staged.thumbnailUri = storage.getFullPath(thumbnailPath)
  } catch {
    // The editor shows the picture itself where a thumbnail is missing.
  }
  return staged
}

/** A keyframe's picture under its own name, as the keyframes step writes it: where the agent
 *  looks at a keyframe, and starts a fix from. */
export function keyframePicturePath(shotId: string): string {
  return `${KEYFRAMES_DIR}/${safeName(shotId)}.png`
}

/**
 * Makes the staged picture keyframe `shotId`. It goes under the keyframe's own name too
 * (`keyframePicturePath`), so the agent finds the new picture where it looks, with the one it
 * replaces kept in `long_take/keyframes/replaced/`; `keyframes.json` and
 * `keyframe_thumbnails.json` (what the editor, the status and the render read) point at its
 * new name, so a page that showed the old picture loads the new one.
 */
export async function commitKeyframePicture(
  storage: Storage,
  shotId: string,
  staged: StagedKeyframe,
): Promise<void> {
  const keyframes = await readOptionalJsonFile<KeyframeEntry[]>(storage, KEYFRAMES_PATH)
  if (!Array.isArray(keyframes) || !keyframes.some((k) => k.shotId === shotId)) {
    throw new Error(`Keyframe ${shotId} is no longer in the video`)
  }
  if (!(await storage.exists(staged.picturePath))) {
    throw new Error(`The new picture for keyframe ${shotId} is no longer stored`)
  }
  const ownPath = keyframePicturePath(shotId)
  if (await storage.exists(ownPath)) {
    const name = staged.picturePath.slice(staged.picturePath.lastIndexOf('/') + 1)
    await storage.copyFile(ownPath, `${KEYFRAMES_DIR}/replaced/${name}`)
  }
  await storage.copyFile(staged.picturePath, ownPath)
  await storage.writeJsonFile(
    KEYFRAMES_PATH,
    keyframes.map((keyframe) =>
      keyframe.shotId === shotId
        ? {
            ...keyframe,
            keyframeUrl: staged.keyframeUri,
            ...(staged.thumbnailUri ? { thumbnailUrl: staged.thumbnailUri } : {}),
          }
        : keyframe,
    ),
  )
  if (!staged.thumbnailUri) return
  const thumbnails =
    (await readOptionalJsonFile<{ shotId: string; thumbnailUrl: string }[]>(
      storage,
      KEYFRAME_THUMBNAILS_PATH,
    )) ?? []
  const entry = { shotId, thumbnailUrl: staged.thumbnailUri }
  const list = Array.isArray(thumbnails) ? thumbnails : []
  await storage.writeJsonFile(
    KEYFRAME_THUMBNAILS_PATH,
    list.some((t) => t.shotId === shotId)
      ? list.map((t) => (t.shotId === shotId ? entry : t))
      : [...list, entry],
  )
}

function cents(usd: number): number {
  return Math.round(usd * 100) / 100
}

/** A shot id as a file name: anything but letters, digits, _ and - becomes _. */
function safeName(shotId: string): string {
  return shotId.replace(/[^\w-]/g, '_')
}
