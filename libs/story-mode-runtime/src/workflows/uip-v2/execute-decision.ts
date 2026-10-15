/**
 * executeDecision: map a V1 `PlannerOutput` action onto V2 orchestration.
 *
 * The decision type IS the V1 `PlannerOutput` -- V2 does not define a new action
 * union or schema. Each action becomes either an appended
 * event (ASK_CLARIFY / TODO_UPDATE_ONLY / MODE_CONFIRMED), a child workflow
 * (TOOL_CALLS), or a local activity + appended event (PATCH_SPEC /
 * SESSION_CONTROL).
 *
 * Value imports are local pure modules, the tool-runner workflow, the
 * local-activity proxies, and `@reelmakeeasy/workflow-engine/workflow`.
 * `PlannerOutput` / `PatchOp` come in via `import type` ONLY.
 *
 * Local-activity safety: applyPatchActivity / sessionControlActivity are LOCAL
 * activities and are awaited sequentially -- never inside Promise.all.
 */

import { MODE_CONFIRMED_FOLLOWUP_MESSAGE } from '@reelmakeeasy/common/uip-runtime-messages'
import type { PatchOp, PlannerOutput } from '@reelmakeeasy/uip-planner-runtime'
import {
  ParentClosePolicy,
  startChild,
  uuid4,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

// AnchorVsBatchInput is a type-only import: the activity module never enters
// workflow code, only the shape is needed for startChild args.
import type { AnchorVsBatchInput } from '../../activities/uip-v2/tools/anchor-vs-batch'
import { UipV2ToolRunnerWorkflow } from '../uip-v2-tool-runner/workflow'

import {
  applyBrandPatchActivity,
  applyPatchActivity,
  sessionControlActivity,
} from './activity-proxies'
import { appendEvent } from './event-log'
import { brandCarryPending, foldPhase } from './folds'
import type { WorkflowState } from './types'

/** ISO timestamp from the workflow clock. */
function nowIso(): string {
  return new Date(Date.now()).toISOString()
}

/**
 * Append an assistant_message event for a planner action reply (v1 parity for
 * appendAgentReply / appendProgressReply). Skipped when the reply is empty.
 */
function appendReply(
  state: WorkflowState,
  reply: null | string | undefined,
  specVersion: number,
): void {
  const content = reply?.trim()
  if (!content) {
    return
  }
  appendEvent(state, {
    type: 'assistant_message',
    content,
    messageId: uuid4(),
    phase: foldPhase(state.events),
    specVersion,
    timestamp: nowIso(),
  })
}

/**
 * Persist a todo_updated event for the planner's latest todo view, if the
 * decision carries meaningful todo data.
 *
 * V1 parity: in V1 every action handler calls applyTodoStateUpdate so the
 * session's todo_state is always current after each planner turn. TODO_UPDATE_ONLY
 * was a fallback "self-repair" action, not the sole source of truth. V2 restores
 * this: all actions can carry todo_snapshot / todo_update and the event log
 * captures them so foldSession always reconstructs the planner's latest intent.
 * TODO_UPDATE_ONLY remains the explicit no-side-effect self-repair action.
 *
 * Only fires when there is something meaningful: a non-empty snapshot, an
 * explicit clear, or set_item_status entries. A todo_update with only a `phase`
 * field (no mutations) is a no-op and is skipped.
 */
function maybePersistTodo(state: WorkflowState, decision: PlannerOutput): void {
  const hasSnapshot = (decision.todo_snapshot?.items?.length ?? 0) > 0
  const hasClear = decision.todo_update?.clear === true
  const hasStatusUpdates = (decision.todo_update?.set_item_status?.length ?? 0) > 0
  if (!hasSnapshot && !hasClear && !hasStatusUpdates) {
    return
  }
  appendEvent(state, {
    type: 'todo_updated',
    snapshot: decision.todo_snapshot?.items,
    timestamp: nowIso(),
    update: decision.todo_update,
  })
}

/**
 * Returned when a planner-decided spec mutation could not be applied (a rejected
 * PATCH_SPEC op, or an UNDO_LAST with nothing to undo). The caller (runPlannerTurn)
 * surfaces it to the planner via lastActionResult and re-prompts -- mirroring how
 * a failed tool is fed back -- so the planner can correct or explain to the user.
 * V1 parity: handlePatchAction returns `{ shouldStop:false, lastActionResult: <error> }`.
 */
export interface DecisionFailure {
  errorCode: string
  errorMessage: string
}

export interface ExecuteDecisionMetadata {
  runtimeClarificationKind?:
    | 'pasted_script_duration_cap'
    | 'pasted_script_fit'
    | 'pasted_script_unreadable'
  verifiedPastedScript?: {
    script: string
    shotEdits: Array<{ audio_vo: string; shot_id: string }>
  }
}

function runtimeClarificationMetadata(
  metadata: ExecuteDecisionMetadata,
): Pick<
  Extract<WorkflowState['events'][number], { type: 'assistant_message' }>,
  'runtimeClarificationKind'
> {
  return metadata.runtimeClarificationKind
    ? { runtimeClarificationKind: metadata.runtimeClarificationKind }
    : {}
}

function verifiedPastedScriptMetadata(
  metadata: ExecuteDecisionMetadata,
): Pick<
  Extract<WorkflowState['events'][number], { type: 'mode_confirmed' }>,
  'verifiedPastedScript'
> {
  return metadata.verifiedPastedScript
    ? { verifiedPastedScript: metadata.verifiedPastedScript }
    : {}
}

/** Current spec version: the last spec_patched.specVersionAfter, else 0. */
export async function executeDecision(
  state: WorkflowState,
  decision: PlannerOutput,
  projectId: string,
  taskQueue: string,
  metadata: ExecuteDecisionMetadata = {},
): Promise<DecisionFailure | undefined> {
  // V1 parity: persist the planner's todo view for every action that carries
  // meaningful todo data. foldSession reconstructs todo_state from these events.
  maybePersistTodo(state, decision)

  switch (decision.action) {
    case 'ASK_CLARIFY': {
      appendEvent(state, {
        type: 'assistant_message',
        content: decision.reply,
        expectAssets: decision.expect_assets,
        messageId: uuid4(),
        options: decision.options,
        phase: foldPhase(state.events),
        replyQuestion: decision.reply_question,
        ...runtimeClarificationMetadata(metadata),
        specVersion: currentSpecVersion(state),
        timestamp: nowIso(),
      })
      break
    }

    case 'MODE_CONFIRMED': {
      const deferred = await applyBrandConfirmPreSteps(state, decision)
      if (deferred) {
        return deferred
      }

      // V1 parity: handleModeConfirmedAction calls appendAgentReply(reply) so
      // the user sees the confirmation before bootstrap tools begin.
      appendReply(state, decision.reply, currentSpecVersion(state))
      // V1 parity: handleModeConfirmedAction then appendProgressReply()s a
      // runtime-injected follow-up ("I'm starting your video! Stay to refine...").
      // Always emitted -- it explains the auto-lock "stay vs step away" UX, a
      // runtime invariant the planner prompt deliberately does not carry.
      appendEvent(state, {
        type: 'assistant_message',
        content: MODE_CONFIRMED_FOLLOWUP_MESSAGE,
        messageId: uuid4(),
        phase: foldPhase(state.events),
        specVersion: currentSpecVersion(state),
        timestamp: nowIso(),
      })
      appendEvent(state, {
        type: 'mode_confirmed',
        durationSec: decision.mode_update.duration_seconds,
        durationSource: decision.mode_update.duration_source,
        inputType: decision.mode_update.input_type ?? '',
        mode: decision.mode_update.mode ?? '',
        pastedScriptFit: decision.mode_update.pasted_script_fit,
        ...verifiedPastedScriptMetadata(metadata),
        timestamp: nowIso(),
      })
      // phase advance is derived by the phase machine from this event (7e).
      break
    }

    case 'PATCH_SPEC': {
      const ops = (decision.ops ?? []) as PatchOp[]
      const res = await applyPatchActivity({
        currentArtifacts: state.currentArtifacts,
        events: state.events,
        ops,
      })
      if (!res.ok) {
        // V1 parity (handlePatchAction): a rejected patch must NOT silently drop
        // the turn. Surface the specific error so the planner can correct (e.g.
        // an add_preselected_asset for an upload already absorbed into an anchor
        // -> rebind via anchor_asset) instead of the user seeing nothing happen.
        return {
          errorCode: 'PATCH_APPLY_ERROR',
          errorMessage: res.error ?? 'PATCH_SPEC ops could not be applied.',
        }
      }
      appendEvent(state, {
        type: 'spec_patched',
        ops,
        source: 'planner',
        specVersionAfter: res.specVersionAfter,
        timestamp: nowIso(),
      })
      // V1 parity: handlePatchAction calls appendProgressReply(reply or
      // describePatchOpsForUser) so the user sees feedback for spec edits.
      appendReply(state, decision.reply, res.specVersionAfter)
      break
    }

    case 'SESSION_CONTROL': {
      if (!decision.session_control) {
        break
      }
      // UNDO_LAST: the activity rebuilds spec_history and emits FORWARD ops that
      // reach the target prev_spec (the log is append-only; we never pop). The
      // parent appends them as a new spec_patched with source 'session_control'.
      const res = await sessionControlActivity({
        control: decision.session_control,
        currentArtifacts: state.currentArtifacts,
        events: state.events,
      })
      // Only an explicit ok:false (nothing to undo) takes the surfaced-failure path.
      if (res.ok === false) {
        // Surface it to the planner instead of the optimistic "I undid the last
        // change" reply, which would otherwise fire even though nothing changed
        // (V1 parity: handleSessionControlAction returns lastActionResult on
        // !undoResult.ok). The caller re-prompts the planner with it.
        return {
          errorCode: 'UNDO_FAILED',
          errorMessage: res.error ?? 'There is nothing to undo.',
        }
      }
      if (res.ops?.length) {
        appendEvent(state, {
          type: 'spec_patched',
          ops: res.ops as PatchOp[],
          source: 'session_control',
          specVersionAfter: res.specVersionAfter,
          timestamp: nowIso(),
        })
      }
      // V1 parity: V1's executeUndoLastInternal appends an undo-confirmation
      // reply (session-runtime.ts). Without surfacing the planner reply here the
      // UI keeps showing the PRIOR turn's assistant message after an undo -- the
      // other actions (PATCH_SPEC / TOOL_CALLS / TODO_UPDATE_ONLY) already do this.
      appendReply(state, decision.reply, res.specVersionAfter)
      break
    }

    case 'TODO_UPDATE_ONLY': {
      // V1 parity: surface the planner reply so the UI does not stay stuck in
      // agent-thinking state (e.g. "Your video plan is ready to refine" on
      // refinement entry).
      // The todo_updated event is already written by maybePersistTodo above.
      appendReply(state, decision.reply, currentSpecVersion(state))
      break
    }

    case 'TOOL_CALLS': {
      // V1 parity: appendAgentReply before dispatching tools (planner-actions.ts
      // line 610, planner-actions-batch.ts line 372). Without this the UI sees
      // no response after a message that triggers a tool (e.g. "create storyboard"
      // -> bootstrap_visual generation start).
      appendReply(state, decision.reply, currentSpecVersion(state))

      const parentWorkflowId = workflowInfo().workflowId
      const toolCalls = decision.tool_calls ?? []

      // Shared-anchor-plan batch: anchor + vs must share a process to use the
      // in-memory SharedArtifactBatchContext (WeakMap). Dispatch as a single
      // child with toolName='anchor_vs_batch' so both tools run inside one
      // anchorAndVisualScriptBatchActivity (mirrors v1 executeBatchToolCalls).
      if (isAnchorVsBatch(toolCalls)) {
        // isAnchorVsBatch guarantees both tools are present; the ?? fallbacks
        // are unreachable but satisfy the no-non-null-assertion rule.
        const anchorCall =
          toolCalls.find((c) => c.tool === 'generate_anchor_assets') ?? toolCalls[0]
        const vsCall =
          toolCalls.find((c) => c.tool === 'generate_explainer_visual_script') ?? toolCalls[1]
        const toolCallId = uuid4()
        const childWorkflowId = `ao:${projectId}:tool:${toolCallId}`

        const batchInput: AnchorVsBatchInput = {
          anchor: anchorCall.params,
          anchorToolCallId: toolCallId,
          structure_edit: decision.structure_edit ?? null,
          vs: vsCall.params,
          vsToolCallId: uuid4(),
        }

        await startChild(UipV2ToolRunnerWorkflow, {
          args: [
            {
              currentArtifacts: state.currentArtifacts,
              events: [...state.events],
              parentWorkflowId,
              projectId,
              taskQueue,
              toolCallId,
              toolInput: batchInput,
              toolName: 'anchor_vs_batch',
            },
          ],
          parentClosePolicy: ParentClosePolicy.ABANDON,
          taskQueue,
          workflowId: childWorkflowId,
        })
        appendEvent(state, {
          type: 'tool_started',
          childWorkflowId,
          startedAt: nowIso(),
          toolCallId,
          toolInput: batchInput,
          toolName: 'anchor_vs_batch',
        })
        state.activeToolCalls.set(toolCallId, {
          childWorkflowId,
          startedAt: nowIso(),
          toolName: 'anchor_vs_batch',
        })
        break
      }

      for (const call of toolCalls) {
        const toolCallId = uuid4()
        const childWorkflowId = `ao:${projectId}:tool:${toolCallId}`
        // Contract #2: the planner's structure_edit rides INSIDE toolInput for
        // the visual-script tool (the activity reads toolInput.structure_edit).
        const toolInput =
          call.tool === 'generate_explainer_visual_script' && decision.structure_edit != null
            ? { ...(call.params as object), structure_edit: decision.structure_edit }
            : call.params
        await startChild(UipV2ToolRunnerWorkflow, {
          args: [
            {
              currentArtifacts: state.currentArtifacts,
              events: [...state.events],
              parentWorkflowId,
              projectId,
              taskQueue,
              toolCallId,
              toolInput,
              toolName: call.tool,
            },
          ],
          parentClosePolicy: ParentClosePolicy.ABANDON,
          taskQueue,
          workflowId: childWorkflowId,
        })
        appendEvent(state, {
          type: 'tool_started',
          childWorkflowId,
          startedAt: nowIso(),
          toolCallId,
          toolInput,
          toolName: call.tool,
        })
        state.activeToolCalls.set(toolCallId, {
          childWorkflowId,
          startedAt: nowIso(),
          toolName: call.tool,
        })
      }
      break
    }

    default: {
      // Any future / unexpected action: no-op park rather than throw. (WAIT was
      // removed: the workflow already parks the loop while a tool is in flight
      // via the openToolStartedEvents guard, so the planner never needs a WAIT
      // action -- by the time it runs, nothing is in flight.)
      break
    }
  }
}

/**
 * MODE_CONFIRMED brand pre-steps:
 * (1) persist a planner-supplied shape (v1 applyAgentMemory writes
 *     mode_update.brand_video_type to the spec; v2 must do it explicitly or
 *     downstream brand grounding never sees the arc);
 * (2) carry-by-default: a still-pending brand carry is applied
 *     deterministically before confirming (PM default: same brand);
 * (3) null-shape defer: when the applied carry has no narrative arc and the
 *     planner supplied none, return a DecisionFailure so runPlannerTurn
 *     re-prompts for the 2.6.5 ask instead of confirming shapeless.
 * Local activities are awaited sequentially -- never Promise.all.
 */
async function applyBrandConfirmPreSteps(
  state: WorkflowState,
  decision: PlannerOutput,
): Promise<DecisionFailure | undefined> {
  const plannerShape =
    (decision.mode_update as { brand_video_type?: null | string })?.brand_video_type ?? null
  if (plannerShape != null) {
    const shapeOps: PatchOp[] = [
      { op: 'update_global_field', path: 'brand_video_type', value: plannerShape },
    ]
    const shapeRes = await applyPatchActivity({
      currentArtifacts: state.currentArtifacts,
      events: state.events,
      ops: shapeOps,
    })
    // A rejected shape write is non-fatal: the carry/contract layers own shape
    // enforcement; fall through to the confirm.
    if (shapeRes.ok) {
      appendEvent(state, {
        type: 'spec_patched',
        ops: shapeOps,
        source: 'planner',
        specVersionAfter: shapeRes.specVersionAfter,
        timestamp: nowIso(),
      })
    }
  }

  let carryShapeAfter: null | string | undefined
  if (state.brandExtractionEnabled && brandCarryPending(state.events)) {
    const carryRes = await applyBrandPatchActivity({
      action: { kind: 'carry_fallback' },
      currentArtifacts: state.currentArtifacts,
      events: state.events,
    })
    if (carryRes.ok && carryRes.ops.length) {
      appendEvent(state, {
        type: 'spec_patched',
        ops: carryRes.ops,
        source: 'system',
        specVersionAfter: carryRes.specVersionAfter,
        timestamp: nowIso(),
      })
      carryShapeAfter = carryRes.brandVideoTypeAfter
    }
  }
  if (carryShapeAfter === null && plannerShape == null) {
    // Carry applied but the source predates the shape field: defer the
    // confirm. runPlannerTurn feeds this back as lastActionResult and
    // re-prompts; the planner asks the single 2.6.5 brand-direction question
    // and re-emits MODE_CONFIRMED with mode_update.brand_video_type.
    return {
      errorCode: 'MODE_CONFIRM_DEFERRED_NULL_SHAPE',
      errorMessage:
        'MODE_CONFIRMED deferred: the carried brand has no narrative arc. Ask the section 2.6.5 brand-direction question (grounded in brand_bank), set mode_update.brand_video_type from the answer, then re-emit MODE_CONFIRMED.',
    }
  }
  return undefined
}

function currentSpecVersion(state: WorkflowState): number {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]
    if (e.type === 'spec_patched') {
      return e.specVersionAfter
    }
  }
  return 0
}

/**
 * True when exactly two tool calls form a shared-anchor-plan batch:
 * generate_anchor_assets + generate_explainer_visual_script. These must run in
 * the same activity process so SharedArtifactBatchContext (WeakMap) works.
 *
 * Deliberately a plain boolean, not a `toolCalls is PlannerToolCall[]`
 * type predicate. `toolCalls` at every call site is already the Zod-inferred
 * PlannerOutput['tool_calls'] element type, which the runtime.types.ts mirror
 * check guarantees is structurally assignable into the hand-written
 * PlannerToolCall on every field. Once that holds for every field, TypeScript
 * treats the predicate's negative branch as unreachable (Zod type extends
 * PlannerToolCall on every field => "not PlannerToolCall[]" is impossible) and
 * collapses it to `never`, breaking the `for...of` below the `if` block. A
 * plain boolean return performs the identical runtime check without asking
 * TypeScript to narrow anything, so it can never collapse a caller's type.
 */
function isAnchorVsBatch(toolCalls: unknown[]): boolean {
  if (toolCalls.length !== 2) {
    return false
  }
  const names = new Set((toolCalls as Array<{ tool?: string }>).map((c) => c.tool ?? ''))
  return names.has('generate_anchor_assets') && names.has('generate_explainer_visual_script')
}
