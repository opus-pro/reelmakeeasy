import { createSubLogger } from '@reelmakeeasy/common/logger'

import {
  canonicalizeGlobalConstraintValue,
  normalizeAnchorRequestsForRuntime,
  normalizeExactLocks as normalizeExactLocksForRuntime,
  normalizeShotId,
  normalizeShotIdList,
  normalizeStringList,
} from '../normalization'
import { PatchOp, PlannerTodoItem, PlannerToolCall, SessionState } from '../types'

import { isDirectiveTodoId } from './planner-contract-helpers'
import { plannerLog } from './planner-log'
import { PlannerOutput } from './planner-schema'

const logger = createSubLogger('user-intent-planner')

export function applyTodoStateUpdate(session: SessionState, output: PlannerOutput): void {
  const beforePhase = session.todo_state.phase
  const beforeItems = formatTodoItems(session.todo_state.items)
  logger.info(
    plannerLog(session.sessionId, '[todo.apply.before]', {
      phase: beforePhase,
      snapshot_present: Boolean(output.todo_snapshot),
      todo: beforeItems,
    }),
  )

  if (output.todo_snapshot) {
    session.todo_state = {
      phase: output.todo_snapshot.phase,
      items: output.todo_snapshot.items.map((item) => ({
        executor_hint: item.executor_hint ?? null,
        id: item.id,
        title: item.title,
        // Safety net: a directive with no executor_hint has no execution path
        // and will permanently block future todo_update.clear=true operations
        // (e.g. after audio-locked ASK_CLARIFY). Auto-resolve to 'done' so it
        // never becomes a blocker. Prompt instructs planner not to create these;
        // this is the defensive backstop if the prompt is not followed.
        status:
          isDirectiveTodoId(item.id) && !item.executor_hint && item.status === 'pending'
            ? 'done'
            : item.status,
      })),
    }
  }

  const update = output.todo_update

  if (update.clear === true) {
    session.todo_state.items = []
  }

  session.todo_state.phase = update.phase

  if (update.set_item_status) {
    const itemsById = new Map(session.todo_state.items.map((item) => [item.id, item]))
    for (const statusUpdate of update.set_item_status) {
      const existing = itemsById.get(statusUpdate.id)
      if (existing) {
        existing.status = statusUpdate.status
        continue
      }

      const newItem: PlannerTodoItem = {
        executor_hint: null,
        id: statusUpdate.id,
        title: statusUpdate.id,
        status: statusUpdate.status,
      }
      session.todo_state.items.push(newItem)
      itemsById.set(statusUpdate.id, newItem)
    }
  }

  const afterPhase = session.todo_state.phase
  const afterItems = formatTodoItems(session.todo_state.items)
  logger.info(
    plannerLog(session.sessionId, '[todo.apply.after]', {
      clear: update.clear,
      phase: afterPhase,
      set_item_status: update.set_item_status,
      todo: afterItems,
    }),
  )
  if (beforePhase !== afterPhase) {
    logger.info(
      plannerLog(session.sessionId, '[todo.phase.transition]', {
        from_phase: beforePhase,
        reason: 'todo_update.phase',
        to_phase: afterPhase,
      }),
    )
  }
}

export function describePatchOps(ops: PatchOp[]): string {
  const counts: Record<string, number> = {}
  for (const op of ops) {
    counts[op.op] = (counts[op.op] ?? 0) + 1
  }

  const segments: string[] = []
  if (counts.update_global_field) {
    segments.push(`updated ${counts.update_global_field} global field(s)`)
  }
  if (counts.update_shot_field) {
    segments.push(`updated ${counts.update_shot_field} shot field(s)`)
  }
  if (counts.retime_shot) {
    segments.push(`retimed ${counts.retime_shot} shot(s)`)
  }
  if (counts.add_preselected_asset || counts.remove_preselected_asset) {
    segments.push(
      `changed ${
        (counts.add_preselected_asset ?? 0) + (counts.remove_preselected_asset ?? 0)
      } asset assignment(s)`,
    )
  }
  if (counts.reorder_shots) {
    segments.push('reordered shots')
  }
  if (counts.delete_shots) {
    segments.push(`deleted ${counts.delete_shots} shot selection(s)`)
  }
  if (counts.replace_shots_range) {
    segments.push(`replaced ${counts.replace_shots_range} shot range(s)`)
  }
  if (counts.replace_all_shots) {
    segments.push('replaced all shots')
  }

  return segments.length > 0 ? `Applied patch: ${segments.join('; ')}.` : 'Applied patch update.'
}

export function describeToolArtifactPatch(ops: PatchOp[]): string {
  const hasGc = ops.some((op) => op.op === 'update_global_field')
  const hasVs = ops.some((op) => op.op === 'replace_all_shots' || op.op === 'replace_shots_range')
  const hasScript = ops.some((op) => op.op === 'update_shot_field' && op.field === 'audio_vo')
  if (hasGc && hasVs) {
    return 'Applied tool artifacts: global constraints and visual script.'
  }
  if (hasScript && hasVs) {
    return 'Applied tool artifacts: script and visual script.'
  }
  if (hasScript) {
    return 'Applied tool artifact: script audio updates.'
  }
  if (hasGc) {
    return 'Applied tool artifact: global constraints.'
  }
  if (hasVs) {
    return 'Applied tool artifact: visual script.'
  }
  return 'Applied tool artifacts.'
}

export function normalizeSessionControlOutput(output: PlannerOutput, sessionId: string): void {
  normalizePlannerOutputForRuntime(output)

  // Previously this helper scrubbed stray undo_scope/count off LOCK_PLAN
  // outputs. LOCK_PLAN no longer exists in the schema (language-triggered
  // locking was removed; only UNDO_LAST remains), so the remaining work is
  // just the generic runtime normalization above. The sessionId is kept in
  // the signature to avoid churn on every call-site.
  void sessionId
  if (output.action !== 'SESSION_CONTROL' || !output.session_control?.command) {
    return
  }
}

export function withDefaultToolParams(
  toolCall: PlannerToolCall | undefined,
): null | PlannerToolCall {
  if (!toolCall) {
    return null
  }
  const normalizedToolCall = {
    ...toolCall,
    params: {
      scope: toolCall.params?.scope ?? 'FULL',
      anchor_ids: toolCall.params?.anchor_ids,
      anchor_requests: toolCall.params?.anchor_requests,
      edit_mode: toolCall.params?.edit_mode ?? 'CREATIVE',
      shot_ids: toolCall.params?.shot_ids,
      from_shot_id: toolCall.params?.from_shot_id,
      to_shot_id: toolCall.params?.to_shot_id,
      exact_locks: toolCall.params?.exact_locks ?? [],
      // Tool-specific optional flags must survive normalization -- the tools
      // read them off `params` (generate_explainer_visual_script's beat-sheet
      // re-segmentation gates on refresh_beat_sheet; generate_explainer_script's
      // paste extractor gates on run_extractor; the VS world-bible force-refresh
      // gates on refresh_world_bible). Without this passthrough they
      // are silently dropped on the V2 activity path (normalizeToolParams),
      // making the flags inert.
      refresh_beat_sheet: toolCall.params?.refresh_beat_sheet,
      run_extractor: toolCall.params?.run_extractor,
      refresh_world_bible: toolCall.params?.refresh_world_bible,
    },
  }

  return {
    ...normalizedToolCall,
    params: {
      ...normalizedToolCall.params,
      anchor_ids: normalizeStringList(normalizedToolCall.params.anchor_ids),
      anchor_requests: normalizeAnchorRequestsForRuntime(normalizedToolCall.params.anchor_requests),
      exact_locks: normalizeExactLocksForRuntime(normalizedToolCall.params.exact_locks),
      from_shot_id: normalizeShotId(normalizedToolCall.params.from_shot_id),
      shot_ids: normalizeShotIdList(normalizedToolCall.params.shot_ids),
      to_shot_id: normalizeShotId(normalizedToolCall.params.to_shot_id),
    },
  }
}

function formatTodoItems(items: PlannerTodoItem[]): string[] {
  return items.map((item) => `${item.id}:${item.status}`)
}

function normalizePlannerOutputForRuntime(output: PlannerOutput): void {
  // Structured outputs may emit expect_assets=false by default even on
  // non-clarify actions; treat it as non-applicable outside ASK_CLARIFY.
  if (output.action !== 'ASK_CLARIFY') {
    output.expect_assets = null
  }

  if (output.ops) {
    output.ops = output.ops.map((op) => {
      switch (op.op) {
        case 'add_preselected_asset':
        case 'remove_preselected_asset':
        case 'update_shot_field': {
          return {
            ...op,
            shot_id: normalizeShotId(op.shot_id) ?? op.shot_id,
          }
        }
        case 'delete_shots': {
          return {
            ...op,
            shot_ids: normalizeShotIdList(op.shot_ids) ?? [],
          }
        }
        case 'reorder_shots': {
          return {
            ...op,
            order: normalizeShotIdList(op.order) ?? [],
          }
        }
        case 'replace_shots_range': {
          return {
            ...op,
            from_shot_id: normalizeShotId(op.from_shot_id) ?? op.from_shot_id,
            to_shot_id: normalizeShotId(op.to_shot_id) ?? op.to_shot_id,
            shots: op.shots.map((shot, index) => ({
              ...shot,
              shot_id: normalizeShotId(shot.shot_id) ?? `shot_${index + 1}`,
            })),
          }
        }
        case 'update_global_field': {
          return {
            ...op,
            value: canonicalizeGlobalConstraintValue(op.path, op.value) as typeof op.value,
          }
        }
        default: {
          return op
        }
      }
    }) as typeof output.ops
  }

  if (output.structure_edit) {
    output.structure_edit = {
      ...output.structure_edit,
      anchor_shot_id: normalizeShotId(output.structure_edit.anchor_shot_id),
      shot_ids: normalizeShotIdList(output.structure_edit.shot_ids),
    }
  }

  if (output.tool_calls) {
    output.tool_calls = output.tool_calls
      .map((toolCall) => withDefaultToolParams(toolCall as PlannerToolCall | undefined))
      .filter((toolCall): toolCall is PlannerToolCall =>
        Boolean(toolCall),
      ) as typeof output.tool_calls
  }

  if (output.session_control?.command === 'UNDO_LAST' && !output.session_control.undo_scope) {
    output.session_control.undo_scope = 'LAST_CHANGE'
  }
}
