// Redo one or more clips of a finished video in place. Started by the API's
// `POST /long-take-videos/:projectId/transitions/:transitionId/regenerate`
// (the web editor's "Regenerate shot") and by agent edit mode's
// `regenerate_clip`, with id `ao:{projectId}:story-mode:transition-regen:{transitionId}`.
// The editor follows it through `/transitions/:id/regenerate/stream`, which reads
// the asset-progress query's `results`. The workflow type is the one the removed
// upstream editor service registered, so the API's start call is unchanged.

import { ASSET_PROGRESS_QUERY_NAME, type AssetWorkflowProgress } from '@reelmakeeasy/common/media'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import { defineQuery, setHandler } from '@reelmakeeasy/workflow-engine/workflow'

import type * as activities from '../../activities/long-take'

import { generateLongTakeTransitionVideo } from './activity-proxies'
import { transitionActivityArgs } from './regenerate-transition-args'
import type {
  RegenerateTransitionWorkflowParams,
  RegenerateTransitionWorkflowResult,
} from './types'

const getAssetProgressQuery = defineQuery<AssetWorkflowProgress>(ASSET_PROGRESS_QUERY_NAME)

const { commitRegeneratedTransitions } = proxyActivitiesWrapper<
  Pick<typeof activities, 'commitRegeneratedTransitions'>
>({ retry: { maximumAttempts: 3 }, startToCloseTimeout: '2 minutes' })

type RegenProgress = AssetWorkflowProgress & {
  results?: RegenerateTransitionWorkflowResult['results']
}

export async function RegenerateTransitionWorkflow(
  params: RegenerateTransitionWorkflowParams,
): Promise<RegenerateTransitionWorkflowResult> {
  const { projectId, userEmail, userId } = params
  setWorkflowScopedContext({ projectId, userEmail, userId })
  let progress: RegenProgress = { status: 'processing' }
  setHandler(getAssetProgressQuery, () => progress)

  try {
    const results: RegenerateTransitionWorkflowResult['results'] = []
    const regenerated: Parameters<typeof commitRegeneratedTransitions>[0]['transitions'] = []
    for (const item of params.transitionList) {
      const video = await generateLongTakeTransitionVideo(transitionActivityArgs(params, item))
      regenerated.push({
        endMs: video.endMs,
        fromShotId: video.fromShotId,
        prompt: video.prompt,
        startMs: video.startMs,
        toShotId: video.toShotId,
        transitionId: video.transitionId,
        videoHeight: video.videoHeight,
        videoUri: video.videoUri,
        videoWidth: video.videoWidth,
      })
      results.push({
        fileUri: video.videoUri,
        transitionId: video.transitionId,
        videoHeight: video.videoHeight,
        videoWidth: video.videoWidth,
      })
    }
    // The agent path makes the new clips the project's state; the editor applies them to its
    // draft and commits at render, so its open editor's revision stays valid.
    if (params.commitToCanonical) {
      await commitRegeneratedTransitions({ projectId, transitions: regenerated })
    }
    progress = { results, status: 'completed' }
    return { results }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    progress = { errorCategory: 'TRANSITION_REGEN_FAILED', errorMessage: message, status: 'failed' }
    throw error
  }
}
