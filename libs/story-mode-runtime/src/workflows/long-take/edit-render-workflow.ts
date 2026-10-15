// Editor export: re-renders a delivered project from its current editor state
// (the keyframes and transitions the user sees, with the caption / music toggles
// they chose) and republishes final_video.mp4. Started by the API's
// `POST /long-take-videos/:projectId/render` with id
// `ao:{projectId}:story-mode:render`; the web app follows it through
// `/render/stream`, which polls the standard asset-progress query, and downloads
// the new video once it reads `completed`. The stream reads the query once, on
// connect; a render finishing after that reaches the page only through the
// final push to the workflow's SSE channel below.

import { ASSET_PROGRESS_QUERY_NAME, type AssetWorkflowProgress } from '@reelmakeeasy/common/media'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import { defineQuery, setHandler } from '@reelmakeeasy/workflow-engine/workflow'

import type * as activities from '../../activities/long-take'

import type { LongTakeEditRenderWorkflowParams } from './types'

const getAssetProgressQuery = defineQuery<AssetWorkflowProgress>(ASSET_PROGRESS_QUERY_NAME)

// Same envelope as the generation workflow's render step; one retry covers a
// transient storage failure without doubling a long render.
const { renderLongTakeVideo } = proxyActivitiesWrapper<
  Pick<typeof activities, 'renderLongTakeVideo'>
>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 2,
  },
})

// These push `completed` / `failed` to the SSE channel of whichever workflow
// runs them (the id comes from the activity context), so they serve here too.
// The push is small and in-process; failures never fail the render.
const { notifyBgmRemuxCompleted: notifyCompleted, notifyBgmRemuxFailed: notifyFailed } =
  proxyActivitiesWrapper<
    Pick<typeof activities, 'notifyBgmRemuxCompleted' | 'notifyBgmRemuxFailed'>
  >({
    startToCloseTimeout: '30 seconds',
    retry: {
      maximumAttempts: 3,
    },
  })

export async function LongTakeEditRenderWorkflow(
  params: LongTakeEditRenderWorkflowParams,
): Promise<{ videoUri?: string }> {
  const { projectId, userEmail, userId } = params
  setWorkflowScopedContext({ projectId, userEmail, userId })

  let progress: AssetWorkflowProgress = { status: 'processing' }
  setHandler(getAssetProgressQuery, () => progress)

  try {
    const result = await renderLongTakeVideo({
      aspectRatio: params.aspectRatio,
      bgmBedUri: params.bgmBedUri,
      ...(params.bgmVolume === undefined ? {} : { bgmVolume: params.bgmVolume }),
      // The look the user was looking at wins over the saved one; unsaid, the render reads it.
      ...(params.settings?.captionStyle === undefined
        ? {}
        : { captionStyle: params.settings.captionStyle }),
      enableCaption: params.settings?.captionEnabled ?? false,
      keyframesToCommit: params.keyframes,
      projectId,
      transitionVideos: params.transitionVideos,
      userEmail,
      userId,
    })
    progress = { fileUri: result.videoUri, status: 'completed' }
    await notifyCompleted({ projectId }).catch(() => undefined)
    return { videoUri: result.videoUri }
  } catch (error) {
    const message = extractFailureMessage(error)
    progress = { errorCategory: 'EDIT_RENDER_FAILED', errorMessage: message, status: 'failed' }
    await notifyFailed({ code: 'EDIT_RENDER_FAILED', message, projectId }).catch(() => undefined)
    throw error
  }
}

// The activity failure wraps the real cause one level down; surface that text.
function extractFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  if (error.cause instanceof Error && error.cause.message) {
    return error.cause.message
  }
  return error.message
}
