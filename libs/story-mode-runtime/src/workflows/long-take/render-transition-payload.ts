import type { RenderFinalTransitionVideo } from '@reelmakeeasy/common/long-take/render-final'

import type { LongTakeTransitionVideoItem } from './types'

const RENDER_TRANSITION_PROMPT_MAX_CHARS = 512

export function buildRenderTransitionVideos(
  transitionVideos: LongTakeTransitionVideoItem[],
): RenderFinalTransitionVideo[] {
  return transitionVideos.map((transition) => ({
    ...(transition.baseVideoUri && { baseVideoUri: transition.baseVideoUri }),
    endMs: transition.endMs,
    fromShotId: transition.fromShotId,
    ...(transition.lipSyncEnabled != null && { lipSyncEnabled: transition.lipSyncEnabled }),
    ...(transition.lipSyncVideoUri && { lipSyncVideoUri: transition.lipSyncVideoUri }),
    prompt: truncateRenderTransitionPrompt(transition.prompt),
    ...(transition.shouldLipSync != null && { shouldLipSync: transition.shouldLipSync }),
    startMs: transition.startMs,
    toShotId: transition.toShotId,
    transitionId: transition.transitionId,
    ...(transition.videoHeight != null && { videoHeight: transition.videoHeight }),
    videoUri: transition.videoUri,
    ...(transition.videoWidth != null && { videoWidth: transition.videoWidth }),
  }))
}

function truncateRenderTransitionPrompt(prompt: string): string {
  return prompt.length > RENDER_TRANSITION_PROMPT_MAX_CHARS
    ? prompt.slice(0, RENDER_TRANSITION_PROMPT_MAX_CHARS)
    : prompt
}
