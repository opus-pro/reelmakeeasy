// Settings re-mux workflow. Started by the API when the user edits
// the music panel (volume slider / on-off toggle) on a delivered project. One
// short activity rebuilds the final + watermark videos at the persisted
// settings and republishes them in place. The API starts it with the shared id
// `ao:{projectId}:story-mode:bgm-remux` and TERMINATE_EXISTING, so a rapid
// second edit supersedes an in-flight run (latest write wins; the replacement
// run rewrites both variants, healing any partially published state).
//
// Exposes the standard asset-progress query and pushes a final SSE
// wake-up event so the export processing popup re-reads server truth without
// waiting for the settings poll. Notify failures are non-fatal: a delivered
// remux must never be failed by a telemetry push.

import { ASSET_PROGRESS_QUERY_NAME, type AssetWorkflowProgress } from '@reelmakeeasy/common/media'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import { defineQuery, setHandler } from '@reelmakeeasy/workflow-engine/workflow'

import type * as activities from '../../activities/long-take'
import { createWorkflowLogger } from '../../utilities/workflow-logger'

import type { LongTakeBgmRemuxWorkflowParams, LongTakeBgmRemuxWorkflowResult } from './types'

const getAssetProgressQuery = defineQuery<AssetWorkflowProgress>(ASSET_PROGRESS_QUERY_NAME)

// Download (video + voiceover + bed) -> two lossless re-muxes -> upload; a few
// minutes covers even long videos on slow storage days. Heartbeat kills a hung
// ffmpeg quickly; one retry smooths transient storage failures without stacking
// long duplicated work behind a superseding TERMINATE_EXISTING start.
const { remuxLongTakeBgm } = proxyActivitiesWrapper<Pick<typeof activities, 'remuxLongTakeBgm'>>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 2,
  },
})

// The final SSE push is small and in-process; the tight timeout keeps
// worst-case retry drag (~90s) far under the remux envelope.
const { notifyBgmRemuxCompleted, notifyBgmRemuxFailed } = proxyActivitiesWrapper<
  Pick<typeof activities, 'notifyBgmRemuxCompleted' | 'notifyBgmRemuxFailed'>
>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
  },
})

export async function LongTakeBgmRemuxWorkflow(
  params: LongTakeBgmRemuxWorkflowParams,
): Promise<LongTakeBgmRemuxWorkflowResult> {
  const { projectId, userEmail, userId } = params
  setWorkflowScopedContext({ projectId, userEmail, userId })
  const logger = createWorkflowLogger({ projectId, userId })

  let progress: AssetWorkflowProgress = { status: 'processing' }
  setHandler(getAssetProgressQuery, () => progress)

  try {
    const result = await remuxLongTakeBgm(params)
    progress = { status: 'completed' }
    try {
      await notifyBgmRemuxCompleted({ projectId })
    } catch (error) {
      logger.warn('bgm remux completion notify failed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return result
  } catch (error) {
    const message = extractFailureMessage(error)
    // errorCategory keeps the API's rehydration frame (errorCategory ?? 'UNKNOWN')
    // on the same code as the live push below.
    progress = { errorCategory: 'BGM_REMUX_FAILED', errorMessage: message, status: 'failed' }
    try {
      await notifyBgmRemuxFailed({ code: 'BGM_REMUX_FAILED', message, projectId })
    } catch (notifyError) {
      logger.warn('bgm remux failure notify failed (non-fatal)', {
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      })
    }
    throw error
  }
}

// Prefer the inner ApplicationFailure text over the outer ActivityFailure
// wrapper ("Activity task failed.") -- mirrors the editor worker's
// extractActivityError; one level of cause is where the engine puts it.
function extractFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  if (error.cause instanceof Error && error.cause.message) {
    return error.cause.message
  }
  return error.message
}
