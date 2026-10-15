import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import type { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { LongTakeEditorState, LongTakeTransition } from '@shared/types/api/long-take'

import { readOptionalJsonFile } from './long-take-helpers.util'

export function normalizeEditorStateForStorage(
  state: LongTakeEditorState,
  asStoreUri: (url: string) => string,
): LongTakeEditorState {
  return {
    keyframes: state.keyframes.map((keyframe) => ({
      ...keyframe,
      keyframeUrl: asStoreUri(keyframe.keyframeUrl) || keyframe.keyframeUrl,
    })),
    transitions: state.transitions.map((transition) => ({
      ...transition,
      ...(transition.baseVideoUri && {
        baseVideoUri: asStoreUri(transition.baseVideoUri) || transition.baseVideoUri,
      }),
      ...(transition.lipSyncVideoUri && {
        lipSyncVideoUri: asStoreUri(transition.lipSyncVideoUri) || transition.lipSyncVideoUri,
      }),
      videoUri: asStoreUri(transition.videoUri) || transition.videoUri,
    })),
  }
}

export async function readCanonicalEditorState(
  storage: Awaited<ReturnType<typeof createStorage>>,
): Promise<LongTakeEditorState> {
  const [rawTransitions, rawKeyframes, rawThumbnails, rawTranscript] = await Promise.all([
    readOptionalJsonFile<LongTakeTransition[]>(storage, 'long_take/transition_videos.json'),
    readOptionalJsonFile<Array<{ keyframeUrl: string; shotId: string }>>(
      storage,
      'long_take/keyframes.json',
    ),
    readOptionalJsonFile<Array<{ shotId: string; thumbnailUrl: string }>>(
      storage,
      'long_take/keyframe_thumbnails.json',
    ),
    readOptionalJsonFile<TranscriptData>(storage, STORY_LOADER_PATHS.transformedTranscriptPath),
  ])

  const thumbnailMap = new Map((rawThumbnails ?? []).map((t) => [t.shotId, t.thumbnailUrl]))

  return {
    transcript: rawTranscript ?? undefined,
    keyframes: Array.isArray(rawKeyframes)
      ? rawKeyframes.map((keyframe) => ({
          ...keyframe,
          keyframeUrl: storeUriToUrl(keyframe.keyframeUrl),
          ...(thumbnailMap.has(keyframe.shotId) && {
            thumbnailUrl: storeUriToUrl(thumbnailMap.get(keyframe.shotId) ?? ''),
          }),
        }))
      : [],
    transitions: Array.isArray(rawTransitions)
      ? rawTransitions.map((transition) => ({
          ...transition,
          ...(transition.baseVideoUri && {
            baseVideoUri: storeUriToUrl(transition.baseVideoUri),
          }),
          ...(transition.lipSyncVideoUri && {
            lipSyncVideoUri: storeUriToUrl(transition.lipSyncVideoUri),
          }),
          videoUri: storeUriToUrl(transition.videoUri),
        }))
      : [],
  }
}

/** The loop's keyframe record, frame by frame as each is made (the story-mode runtime's
 *  `BEAT_LOOP_KEYFRAMES_PATH`: the API doesn't import the runtime). */
const BEAT_LOOP_KEYFRAMES_PATH = 'long_take/beat_loop_keyframes.json'

/**
 * The editor state with a loop short's keyframes made so far, while its keyframes step runs: a
 * loop writes `keyframes.json` only once every frame is made, but records each frame as soon as
 * it is made, so the chat's storyboard panel can show them as they arrive. The closing copy of
 * the first frame is left out, as in `keyframes.json`. A state that has keyframes, a story video
 * (no record) or a record that can't be read leave the state as it is.
 */
export async function withLoopKeyframesInProgress(
  storage: Awaited<ReturnType<typeof createStorage>>,
  state: LongTakeEditorState,
): Promise<LongTakeEditorState> {
  if (state.keyframes.length > 0) return state
  const record = await readOptionalJsonFile<{ frames?: unknown }>(storage, BEAT_LOOP_KEYFRAMES_PATH)
  const frames = Array.isArray(record?.frames) ? (record.frames as unknown[]) : []
  const keyframes = frames.flatMap((frame) => {
    const f = frame as null | { copyOf?: unknown; id?: unknown; uri?: unknown }
    if (typeof f?.id !== 'string' || typeof f.uri !== 'string' || f.copyOf) return []
    return [{ keyframeUrl: storeUriToUrl(f.uri), shotId: f.id }]
  })
  return keyframes.length ? { ...state, keyframes } : state
}
