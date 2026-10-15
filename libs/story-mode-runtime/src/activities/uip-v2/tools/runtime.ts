// Do NOT import from workflow.ts
//
// UIP V2 -- shared activity-side runtime setup for the 6 TOOL ACTIVITIES.
//
// Read-back model (Decision 3): the V1 run*Tool wrappers stage the produced
// artifact by MUTATING `session.cached_artifacts.*` (and, for describe,
// `session._loaded_asset_descriptions`) in place. They use the in-memory session
// store only for the wrapper's own `updateSession()` SSE/progress callback, NOT
// to carry the artifact. So each activity passes the SAME folded `session`
// object into the wrapper and reads the mutated slot back off that object after
// the wrapper resolves. This is the cleanest path -- it yields exactly the
// artifact shape foldSession.applyToolOutput re-stages -- and avoids depending on
// the store's onUpdate timing.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { getWorkflowClient } from '@reelmakeeasy/common/workflow/client'
import { UIPV2_TOOL_SIGNALS } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import type { SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'
import type {
  Message,
  PatchOp,
  PlannerToolCall,
  PlannerToolParams,
  SessionState,
} from '@reelmakeeasy/uip-planner-runtime'
import { withDefaultToolParams } from '@reelmakeeasy/uip-planner-runtime'
// Deep import: ToolCallResult is not in the package barrel (same pattern as
// planner-step.ts importing CheckClarifyScopeDeps). Type-only -- no runtime cost.
import type { ToolCallResult } from '@reelmakeeasy/uip-planner-runtime/runtime/runtime.types'
import { heartbeat } from '@reelmakeeasy/workflow-engine/activity'

import { buildPlannerDeps } from '../activity-deps-factory'
import { createInMemorySessionStore } from '../in-memory-session-store'
import { resolveLatestUserMessage } from '../latest-user-message'
import { foldSession } from '../session-state'
import { resolveSpecCheckpoint } from '../spec-checkpoint'

import type { ToolActivityInput, ToolOutcome } from './types'

const logger = createSubLogger('uip-v2-tool-progress')

export interface ToolActivityRuntime {
  // The runtime facade (typed `object`) the V1 run*Tool wrappers consume as
  // their first `runtime` arg.
  runtime: object
  // The folded V1 SessionState. The wrappers mutate this in place; activities
  // read the produced artifact back off `session.cached_artifacts` afterward.
  session: SessionState
  // Latest user_message content from the log ('' if none yet) -- the wrappers
  // thread this into directive-extraction context.
  userMessage: string
}

/**
 * Fold the event log into a V1 SessionState and build the V1 runtime facade
 * around an in-memory session store. Shared by every tool activity.
 *
 * Resolves the compaction spec checkpoint so tool children rebuild
 * from the pinned snapshot after continueAsNew, not the creation snapshot -- the
 * same wiring as the planner/persist folds. Without it, tools (script, anchors,
 * asset assignment, ...) would run against truncated shots and constraints.
 */
export async function prepareToolRuntime(input: ToolActivityInput): Promise<ToolActivityRuntime> {
  const checkpointSpec = await resolveSpecCheckpoint(input.events)
  const session = foldSession(input.events, input.currentArtifacts, checkpointSpec) as SessionState
  const store = createInMemorySessionStore(undefined, undefined, makeProgressSignaler(input))
  const runtime = buildPlannerDeps(store)
  const reportSubstep = makeSubstepReporter(input)
  if (reportSubstep) {
    ;(runtime as { reportSubstep?: SubstepReporter }).reportSubstep = reportSubstep
  }
  return { runtime, session, userMessage: resolveLatestUserMessage(input.events) }
}

/**
 * Build the SubstepReporter that streams runSubstep progress to the parent
 * session workflow as a toolSubstep signal (folded into
 * tool_call_states[].sub_tools -> FE subTools). Bound to the activity input's
 * toolName, so in the anchor_vs_batch activity both arms report under
 * 'anchor_vs_batch' and merge into one map. Fire-and-forget + best-effort,
 * exactly like makeProgressSignaler: a failed signal never breaks the tool.
 * Undefined when the parent/child ids are absent (legacy V1 runner).
 */
function makeSubstepReporter(input: ToolActivityInput): SubstepReporter | undefined {
  const { childWorkflowId, parentWorkflowId, projectId, toolName } = input
  if (!parentWorkflowId || !childWorkflowId) {
    return undefined
  }
  return (substep, status): void => {
    void (async () => {
      try {
        const { client } = await getWorkflowClient()
        await client.workflow
          .getHandle(parentWorkflowId)
          .signal(UIPV2_TOOL_SIGNALS.toolSubstep, { childWorkflowId, status, substep, toolName })
      } catch (err) {
        logger.warn(
          `[${projectId}] tool substep signal failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    })()
  }
}

/**
 * Build the onAppend hook that streams V1 `appendProgressReply` milestones to the
 * parent session workflow as a `childProgressMessage` signal (so the user sees
 * progress during a long tool, e.g. anchor plan ready -> shots ready). Returns
 * undefined (no streaming) when the parent/child ids are absent.
 *
 * Fire-and-forget + best-effort, mirroring the in-memory store's onUpdate SSE: a
 * failed progress signal must never break tool execution. The parent dedups by
 * (childWorkflowId, content), so a retried activity re-emitting a milestone is
 * idempotent.
 */
function makeProgressSignaler(input: ToolActivityInput): ((message: Message) => void) | undefined {
  const { childWorkflowId, parentWorkflowId, projectId } = input
  if (!parentWorkflowId || !childWorkflowId) {
    return undefined
  }
  return (message: Message): void => {
    if (message.role !== 'assistant' || !message.content) {
      return
    }
    const content = message.content
    void (async () => {
      try {
        const { client } = await getWorkflowClient()
        await client.workflow
          .getHandle(parentWorkflowId)
          .signal(UIPV2_TOOL_SIGNALS.childProgressMessage, { childWorkflowId, content })
      } catch (err) {
        logger.warn(
          `[${projectId}] child progress signal failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    })()
  }
}

/**
 * Normalize the planner's tool_call params into a fully-defaulted
 * PlannerToolParams via the V1 `withDefaultToolParams` (same normalization the
 * V1 planner loop applies before dispatch: scope default FULL, edit_mode default
 * CREATIVE, list/lock canonicalization). `toolInput` is the raw planner params.
 */
export function normalizeToolParams(toolName: string, toolInput: unknown): PlannerToolParams {
  const toolCall = {
    tool: toolName,
    params: (toolInput ?? {}) as PlannerToolParams,
  } as PlannerToolCall
  const normalized = withDefaultToolParams(toolCall)
  // withDefaultToolParams only returns null for an undefined toolCall; we always
  // pass one, so the params are always present. Fall back defensively.
  return normalized?.params ?? ({ scope: 'FULL', edit_mode: 'CREATIVE' } as PlannerToolParams)
}

/**
 * V1 parity: maybeApplyDeterministicAnchorRemovalCleanup
 * (planner-actions-batch.ts). When an anchor edit removes anchors
 * (scope=ANCHOR_IDS with REMOVE_ANCHOR requests), every shot still referencing a
 * removed anchor via pre_selected_assets (source=anchor_asset) must be cleaned
 * up with a remove_preselected_asset op -- otherwise the deleted character keeps
 * dangling on shots. V1 runs this in the planner-actions layer, NOT inside
 * runGenerateAnchorAssetsTool, so V2 (which only reuses the raw tool) must
 * replicate it. Pure: returns the ops; the caller (foldSession) applies them.
 * Source of truth for the rule lives in V1; keep this in sync.
 */
export function buildAnchorRemovalCleanupOps(
  params: PlannerToolParams,
  shots: ReadonlyArray<{
    pre_selected_assets?: ReadonlyArray<{ asset_id: string; source: string }>
    shot_id: string
  }>,
): PatchOp[] {
  if (params.scope !== 'ANCHOR_IDS') {
    return []
  }
  const removedAnchorIds = new Set(
    (params.anchor_requests ?? [])
      .filter((request) => request.operation === 'REMOVE_ANCHOR')
      .map((request) => request.anchor_id?.trim() ?? '')
      .filter((anchorId) => anchorId.length > 0),
  )
  if (removedAnchorIds.size === 0) {
    return []
  }
  const ops: PatchOp[] = []
  for (const shot of shots) {
    for (const asset of shot.pre_selected_assets ?? []) {
      if (asset.source !== 'anchor_asset' || !removedAnchorIds.has(asset.asset_id)) {
        continue
      }
      ops.push({
        asset_id: asset.asset_id,
        asset_source: 'anchor_asset',
        op: 'remove_preselected_asset',
        shot_id: shot.shot_id,
      })
    }
  }
  return ops
}

/**
 * Map a V1 `ToolCallResult` into the `ToolOutcome` surfaced to the tool-runner.
 * Subset of fields: ok / code / message / retryable. The tool-runner emits
 * tool_completed when ok, else tool_failed with code + message so the planner
 * sees WHY a soft (ok:false) failure happened.
 */
export function toToolOutcome(result: ToolCallResult): ToolOutcome {
  return {
    code: result.code,
    message: result.message,
    ok: result.ok,
    retryable: result.retryable,
  }
}

// Heartbeat cadence (well under the 5 min heartbeatTimeout on createToolActivitiesProxy).
const TOOL_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Wrap a tool activity so it emits a periodic activity heartbeat for its whole
 * duration. The tool activities are proxied with `heartbeatTimeout: 5 minutes`
 * but never heartbeated, so any generation exceeding 5 min (notably
 * anchor_vs_batch's ~5-6 min anchor-image generation) was wrongly treated as a
 * dead worker and retried -- duplicating expensive work and surfacing a spurious
 * "timed out" UX. V1 avoids this: its long planner-turn activity heartbeats via
 * the same 30s interval (run-planner-turn.ts). This restores that behavior.
 *
 * `intervalMs` sizes the cadence to the proxy's heartbeatTimeout (keep it at or
 * under ~timeout/3; the SDK throttles sends to 0.8x the timeout anyway). The
 * default suits the 5 min tool timeout; projectAndPersistActivity passes 5s for
 * its 15s timeout.
 *
 * The `heartbeat()` call is guarded so unit tests that invoke the activity
 * outside an activity context do not throw.
 */
export function withToolHeartbeat<TArgs extends unknown[], TRet>(
  fn: (...args: TArgs) => Promise<TRet>,
  intervalMs: number = TOOL_HEARTBEAT_INTERVAL_MS,
): (...args: TArgs) => Promise<TRet> {
  return async (...args: TArgs): Promise<TRet> => {
    const timer = setInterval(() => {
      try {
        heartbeat()
      } catch {
        // Not running inside an activity context (e.g. unit tests).
      }
    }, intervalMs)
    // Never let the heartbeat timer keep the Node process alive on its own.
    timer.unref?.()
    try {
      return await fn(...args)
    } finally {
      clearInterval(timer)
    }
  }
}
