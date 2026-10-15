import {
  regenerateOutputName,
  transitionVideoPath,
} from '@reelmakeeasy/common/long-take/regenerate-output'

import type {
  GenerateLongTakeTransitionVideoActivityParams,
  RegenerateTransitionItem,
  RegenerateTransitionWorkflowParams,
} from './types'

export { regenerateOutputName, transitionVideoPath }

/**
 * The clip activity's arguments for one regenerated transition. The agent's prompt is final
 * (`preparedPrompt`, no rewrite); the editor's instruction becomes the planned motion the
 * model writes the clip prompt from, with the shots' scenes and narration beside it.
 */
export function transitionActivityArgs(
  params: RegenerateTransitionWorkflowParams,
  item: RegenerateTransitionItem,
): GenerateLongTakeTransitionVideoActivityParams {
  const base: GenerateLongTakeTransitionVideoActivityParams = {
    aspectRatio: params.aspectRatio,
    ...(params.cameraStyle ? { cameraStyle: params.cameraStyle } : {}),
    // The first clip keeps its first frame; every later clip drops it, as in the original run.
    dropFirstFrame: item.startMs > 0,
    durationSeconds: Number(((item.endMs - item.startMs) / 1000).toFixed(3)),
    endMs: item.endMs,
    firstFrameUri: item.firstFrameUri,
    fromShotId: item.fromShotId,
    lastFrameUri: item.lastFrameUri,
    ...(item.outputName ? { outputName: item.outputName } : {}),
    projectId: params.projectId,
    prompt: item.prompt,
    startMs: item.startMs,
    toShotId: item.toShotId,
    transitionId: item.transitionId,
    ...(params.transitionVideoModel ? { transitionVideoModel: params.transitionVideoModel } : {}),
    userEmail: params.userEmail,
    userId: params.userId,
  }
  if (params.promptIsFinal) return { ...base, preparedPrompt: item.prompt }
  return {
    ...base,
    fromAudio: item.fromAudio,
    fromKeyframePrompt: item.fromKeyframePrompt,
    fromPrompt: item.prompt,
    toAudio: item.toAudio,
    toKeyframePrompt: item.toKeyframePrompt,
  }
}
