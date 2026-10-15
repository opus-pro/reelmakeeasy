/**
 * UIP V2 tool-runner child workflow.
 *
 * One child workflow per planner tool call. Started by the parent session
 * workflow with `ParentClosePolicy.ABANDON` so it survives a parent
 * continueAsNew. It routes one of the 6 generation tool names to the matching
 * V2 tool activity (which reuses the V1 tool logic), then signals the parent
 * back with the outcome (completed / failed / cancelled). The parent appends the
 * corresponding tool_* event to its log.
 *
 * This is workflow code, kept light. It imports the activity proxy FACTORY
 * (which only type-imports the activity barrel) and the channel definitions; it
 * never value-imports `@reelmakeeasy/uip-planner-runtime`.
 *
 * `Date.now()` measures duration; ids are passed in by the parent (which mints
 * them with `uuid4`).
 */

import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import {
  CancellationScope,
  getExternalWorkflowHandle,
  isCancellation,
  setHandler,
} from '@reelmakeeasy/workflow-engine/workflow'

import type { ToolActivityResult } from '../../activities/uip-v2/tools/types'
import { createToolActivitiesProxy } from '../uip-v2/activity-proxies'
import {
  toolCancelledSignal,
  toolCompletedSignal,
  toolFailedSignal,
  toolRunnerCancelSignal,
} from '../uip-v2/channels'
import type { AgentEvent, ArtifactSlot } from '../uip-v2/types'

/**
 * Params for one tool-runner child. Extends the design's minimal shape with
 * `events` + `currentArtifacts` (Phase-2 contract #1): the tool activities
 * `foldSession` from the event log + artifacts to reconstruct the session
 * context the tool needs.
 */
export interface UipV2ToolRunnerParams {
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  parentWorkflowId: string
  projectId: string
  taskQueue: string
  toolCallId: string
  toolInput: unknown
  toolName: string
}

export async function UipV2ToolRunnerWorkflow(params: UipV2ToolRunnerParams): Promise<void> {
  const { parentWorkflowId, projectId, toolCallId, toolName } = params
  setWorkflowScopedContext({ projectId })

  const startTime = Date.now()

  // The user clicked Cancel: the parent sends this signal. We surface it as a
  // cooperative flag; the activity itself is cancelled via the workflow's cancellation scope.
  let cancelRequested = false
  setHandler(toolRunnerCancelSignal, () => {
    cancelRequested = true
  })

  const parent = getExternalWorkflowHandle(parentWorkflowId)

  try {
    const { output, toolResult } = await runToolActivity(params)
    if (toolResult.ok) {
      const durationMs = Date.now() - startTime
      await parent
        .signal(toolCompletedSignal, {
          durationMs,
          output,
          toolCallId,
          toolName,
        })
        .catch(() => undefined)
    } else {
      // Soft failure: run*Tool returned ok:false (MISSING_DEPENDENCY /
      // INVALID_INPUT / partial generation). The activity returned normally (no
      // throw, so no activity retry), but the tool did NOT succeed -- surface it
      // as tool_failed carrying the reason so the planner learns WHY. `output`
      // rides along so any partial artifact staged before the failure (e.g. the
      // anchor partial summary) survives onto the tool_failed event.
      await parent
        .signal(toolFailedSignal, {
          errorCode: toolResult.code,
          errorMessage: toolResult.message,
          output,
          retryable: toolResult.retryable,
          toolCallId,
          toolName,
        })
        .catch(() => undefined)
    }
  } catch (err) {
    if (cancelRequested || isCancellation(err)) {
      // The parent cancels this child workflow. Report back from a
      // non-cancellable scope, else this signal is itself cancelled + swallowed
      // and the parent's activeToolCalls entry leaks.
      await CancellationScope.nonCancellable(async () => {
        await parent.signal(toolCancelledSignal, { toolCallId, toolName }).catch(() => undefined)
      })
      return
    }
    // Hard failure: run*Tool threw a real exception (LLM / infra / storage). The engine
    // already retried per the activity policy; surface the exception message.
    await parent
      .signal(toolFailedSignal, {
        errorCode: getErrorCode(err),
        errorMessage: err instanceof Error ? err.message : String(err),
        retryable: isRetryableToolError(err),
        toolCallId,
        toolName,
      })
      .catch(() => undefined)
  }
}

/**
 * Route one of the 6 tool names to the matching V2 tool activity. Each activity
 * takes the full `ToolActivityInput` and returns `{ output, toolResult }`. We
 * return the whole result so the caller can emit tool_completed (toolResult.ok)
 * or tool_failed (toolResult.code + message) -- surfacing ok:false soft failures
 * to the planner instead of swallowing them as empty completions.
 */
async function runToolActivity(params: UipV2ToolRunnerParams): Promise<ToolActivityResult> {
  const activities = createToolActivitiesProxy(params.taskQueue)
  const input = {
    // This child's own workflow id (minted by the parent as ao:<project>:tool:<id>)
    // and the parent id, so the activity can stream appendProgressReply milestones
    // back to the parent as childProgressMessage signals tagged with child_id.
    childWorkflowId: `ao:${params.projectId}:tool:${params.toolCallId}`,
    currentArtifacts: params.currentArtifacts,
    events: params.events,
    parentWorkflowId: params.parentWorkflowId,
    projectId: params.projectId,
    toolInput: params.toolInput,
    toolName: params.toolName,
  }

  switch (params.toolName) {
    case 'anchor_vs_batch': {
      // Shared-anchor-plan batch: anchor + vs run concurrently inside one
      // activity so SharedArtifactBatchContext (WeakMap) works in-process.
      // Returns AnchorVsBatchOutput; foldSession.applyToolOutput unpacks it.
      // toolResult.ok=true when at least one half succeeded (tool_completed,
      // per-sub-tool failure surfaced via getLastActionResult); ok=false only
      // when the whole batch failed (tool_failed, so the failure-loop backstop
      // counts it -- output still rides along to preserve partial artifacts).
      return activities.anchorAndVisualScriptBatchActivity(input)
    }
    case 'describe_uploaded_images': {
      return activities.describeUploadedImagesActivity(input)
    }
    case 'generate_anchor_assets': {
      return activities.generateAnchorAssetsActivity(input)
    }
    case 'generate_explainer_script': {
      return activities.generateScriptActivity(input)
    }
    case 'generate_explainer_visual_script': {
      // Contract #2: the planner's `structure_edit` rides inside `toolInput`;
      // the activity reads `toolInput.structure_edit`. The parent already placed
      // it there in executeDecision.
      return activities.generateVisualScriptActivity(input)
    }
    case 'generate_intent_context': {
      return activities.generateIntentContextActivity(input)
    }
    case 'plan_asset_assignment': {
      return activities.planAssetAssignmentActivity(input)
    }
    case 'select_auto_style': {
      // Auto Style Selection: runtime-dispatched (not planner-emitted)
      // after the brief. Reads the preset catalog + brief off the folded session.
      return activities.runSelectAutoStyleTool(input)
    }
    default: {
      throw new Error(`Unknown tool: ${String(params.toolName)}`)
    }
  }
}

/** Best-effort error code extraction (`code` / `errorCode` field, else generic). */
function getErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; errorCode?: unknown; type?: unknown }
    for (const v of [e.errorCode, e.code, e.type]) {
      if (typeof v === 'string' && v.length > 0) {
        return v
      }
    }
  }
  return 'TOOL_ERROR'
}

/**
 * Whether a tool error should let the planner retry. Defaults to retryable
 * unless the error is explicitly marked non-retryable (ApplicationFailure
 * sets `nonRetryable`). The planner's `consecutiveIdenticalFailures` backstop
 * bounds runaway retries.
 */
function isRetryableToolError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'nonRetryable' in err) {
    return (err as { nonRetryable?: boolean }).nonRetryable !== true
  }
  return true
}
