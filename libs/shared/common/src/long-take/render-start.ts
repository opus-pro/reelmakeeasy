// Deterministic RenderVideo start identity. A retried story-mode
// activity used to mint a fresh uuid per attempt, so every retry started (and
// paid for) a brand-new RenderVideo while orphaning the original. This module
// makes the start idempotent: ids stable across an invocation's retries, and
// ONE start helper every call site goes through, which re-attaches to a
// running render and reuses a completed one's result.
import { Context } from '@reelmakeeasy/workflow-engine/activity'
import {
  IllegalStateError,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from '@reelmakeeasy/workflow-engine/common'
import { v4 as uuidV4 } from 'uuid'

import { getLogger } from '../logger'
import { getWorkflowClient } from '../workflow/client'
import type { RenderVideoWorkflowDef } from '../workflow/workflow/render/types'

import type { RenderChildWorkflowArgs } from './render-final.types'

const logger = getLogger('long-take-render-start')

/**
 * Client start options `startRenderVideo` passes, paired with the
 * deterministic videoIds from {@link buildRenderVideoIds}:
 *
 * - USE_EXISTING: a retried start whose workflowId is already RUNNING
 *   re-attaches to that render instead of raising
 *   WorkflowExecutionAlreadyStartedError -- a story-mode worker loss no longer
 *   orphans an in-flight render and starts a duplicate.
 * - ALLOW_DUPLICATE_FAILED_ONLY: a COMPLETED-successful render under the same
 *   id rejects the duplicate start; `startRenderVideo` then returns the
 *   completed run's recorded result instead of re-rendering. A FAILED /
 *   terminated / timed-out run still permits a fresh attempt.
 *
 * @internal exported for testing -- production code goes through
 * {@link startRenderVideo}, never spreads this directly.
 */
export const RENDER_VIDEO_START_OPTIONS = {
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
  workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
} as const

/**
 * The clean + watermark videoIds for one render invocation. Both
 * share one invocation key so a retry rebuilds both workflowIds identically.
 * The purpose label keeps two renders built by the SAME activity invocation
 * (e.g. 'final' + 'no-lipsync') from colliding,
 * and the watermark variant is a SUFFIX so no purpose string can make one
 * call's clean id collide with another call's watermark id. The residual
 * requirement -- two payload builds in one activity invocation must use
 * different purposes -- is documented on `renderPurpose` at the call surface.
 */
export function buildRenderVideoIds(renderPurpose: string): {
  /** Per-CALL script upload id: unique even across retries (see below). */
  cleanScriptId: string
  cleanVideoId: string
  watermarkScriptId: string
  watermarkVideoId: string
} {
  const key = `${renderPurpose}-${resolveRenderInvocationKey()}`
  // Script ids carry a per-call nonce ON TOP of the deterministic key: when a
  // retry re-attaches to a running render, that render keeps its RECORDED
  // script URI, so the retry's re-upload must land on a fresh object -- a
  // shared script path would let the retry swap the script under a render
  // whose workflow args were stamped by the previous attempt.
  const nonce = uuidV4().slice(0, 8)
  return {
    cleanScriptId: `long-take-${key}-${nonce}`,
    cleanVideoId: `long-take-${key}`,
    watermarkScriptId: `long-take-${key}-watermark-${nonce}`,
    watermarkVideoId: `long-take-${key}-watermark`,
  }
}

/**
 * Start (or re-attach to, or reuse the result of) a RenderVideo run for one
 * payload built by `buildRenderPayloads`. The ONLY sanctioned way to start
 * RenderVideo from these payloads: the deterministic workflowIds are safe
 * exactly because every start goes through the conflict/reuse handling here.
 */
export async function startRenderVideo(
  payload: RenderChildWorkflowArgs,
): Promise<Required<RenderVideoWorkflowDef>['response']> {
  const { client, executeWorkflow } = await getWorkflowClient()
  try {
    return await executeWorkflow<RenderVideoWorkflowDef>(
      { name: 'RenderVideo', arg: payload.args[0] },
      {
        taskQueue: payload.taskQueue,
        workflowId: payload.workflowId,
        ...RENDER_VIDEO_START_OPTIONS,
      },
    )
  } catch (error) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      // A prior attempt's run already completed successfully under this id
      // (ALLOW_DUPLICATE_FAILED_ONLY rejects only that case). Reuse its
      // recorded result instead of re-rendering -- idempotent and free.
      logger.info(
        `[render-start] reusing completed RenderVideo result workflowId=${payload.workflowId}`,
      )
      return (await client.workflow
        .getHandle(payload.workflowId)
        .result()) as Required<RenderVideoWorkflowDef>['response']
    }
    throw error
  }
}

/**
 * Key that is unique per render invocation yet stable across the invocation's
 * activity retries: retries of the same scheduled activity
 * share runId+activityId, while regenerations run under a different activityId
 * (or workflow run) and get fresh ids. Outside an activity (composable
 * editor steps, tests) there is nothing stable to key on -- fall back to a
 * fresh uuid, which preserves the older behavior.
 */
function resolveRenderInvocationKey(): string {
  try {
    const info = Context.current().info
    return `${info.workflowExecution.runId}-${info.activityId}`
  } catch (error) {
    // Outside an activity, Context.current() throws IllegalStateError -- the
    // expected fallback. Anything ELSE means the deterministic-id path broke
    // inside a real activity (SDK upgrade, module duplication), silently
    // reintroducing the duplicate-render behavior -- warn loudly.
    if (!(error instanceof IllegalStateError)) {
      logger.warn(
        `[render-start] unexpected activity-context failure, falling back to uuid render id: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    return uuidV4()
  }
}
