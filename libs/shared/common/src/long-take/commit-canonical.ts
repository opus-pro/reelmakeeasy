import type { LongTakeKeyframe, LongTakeTransition } from '@shared/types/api/long-take'

import type { RenderFinalStorage } from './render-final.types'

// Extracted from render-final.ts, which sits at the max-lines ceiling (same
// precedent as ./caption-track and ./log-fields). Both helpers are the sole
// writers of the canonical editor state files.

export async function commitCanonicalKeyframes(
  storage: RenderFinalStorage,
  keyframes: LongTakeKeyframe[],
): Promise<void> {
  const thumbnails = keyframes
    .filter((kf) => kf.thumbnailUrl)
    .map((kf) => ({ shotId: kf.shotId, thumbnailUrl: kf.thumbnailUrl }))

  await Promise.all([
    storage.writeJsonFile('long_take/keyframes.json', keyframes),
    storage.writeJsonFile('long_take/keyframe_thumbnails.json', thumbnails),
  ])
}

export async function commitRenderedTransitions(
  storage: RenderFinalStorage,
  transitions: LongTakeTransition[],
): Promise<void> {
  await storage.writeJsonFile('long_take/transition_videos.json', transitions)
}
