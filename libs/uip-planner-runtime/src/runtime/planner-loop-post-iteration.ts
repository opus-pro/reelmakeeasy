/**
 * Contract-error auto-correction for phase drift
 * (maybeAutoCorrectPhaseDriftContractError). The runtime-deps types are
 * imported type-only so there is no runtime import cycle back into planner-loop.
 */

import type { SessionState } from '../types'

import {
  BOOTSTRAP_VISUAL_PHASE_COMPLETE_CONTRACT_ERROR,
  getInvalidTodoIdsForPhase,
  isBootstrapTodoId,
} from './planner-contract'
import {
  MODE_CONFIRM_REQUIRES_BOOTSTRAP_BRAND_CONTRACT_ERROR,
  MODE_CONFIRM_REQUIRES_BOOTSTRAP_SCRIPT_CONTRACT_ERROR,
} from './planner-contract-brand'
import { isDirectiveTodoId, isDirectiveTodoPhase } from './planner-contract-helpers'
import type { PlannerLoopRuntimeDeps } from './planner-loop'
import type { PlannerOutputLike } from './runtime.types'

/**
 * One contract-error correction attempt. Returns the error unchanged when the
 * case does not apply, a NEW error when the correction exposed a different
 * violation, or null when the output now validates.
 */
type ContractCorrector = (
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
) => null | string

/**
 * Correctors are COMPOSED, not raced: one output can carry several
 * stale shapes at once -- e.g. a `bootstrap_visual` snapshot naming
 * `t3_visual_script` plus a `set_item_status` closing `t2_script`. Healing the
 * snapshot then surfaces the update-side error, so the chain must keep going
 * with the new error instead of returning it. Order is stable: phase rewrites
 * first, then snapshot repairs, then the update-side strip.
 */
export function maybeAutoCorrectPhaseDriftContractError(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  let current: null | string = contractError
  for (const correct of CONTRACT_CORRECTORS) {
    if (current === null) {
      return null
    }
    current = correct(session, output, current, deps)
  }
  return current
}

function correctBootstrapVisualPhaseComplete(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  if (contractError !== BOOTSTRAP_VISUAL_PHASE_COMPLETE_CONTRACT_ERROR) {
    return contractError
  }
  output.todo_update.phase = 'refinement'
  if (output.todo_snapshot) {
    output.todo_snapshot.phase = 'refinement'
  }
  return deps.checkPlannerOutputContract(session, output)
}

function correctBrandRoutePhase(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  const brandRouteCorrection = correctBrandRouteContractError(contractError)
  if (!brandRouteCorrection) {
    return contractError
  }
  output.todo_update.phase = brandRouteCorrection
  if (output.todo_snapshot) {
    output.todo_snapshot.phase = brandRouteCorrection
  }
  return deps.checkPlannerOutputContract(session, output)
}

/**
 * Extracted from `maybeAutoCorrectPhaseDriftContractError` unchanged
 * so the entry point stays a flat chain of correctors under the
 * cognitive-complexity ceiling. Behavior is identical: re-inject the
 * runtime-owned todo items the planner's snapshot left out, then re-validate;
 * return `contractError` untouched when the case does not apply.
 */
function correctBrandRouteContractError(
  contractError: string,
): 'bootstrap_brand' | 'bootstrap_script' | null {
  if (contractError === MODE_CONFIRM_REQUIRES_BOOTSTRAP_BRAND_CONTRACT_ERROR) {
    return 'bootstrap_brand'
  }
  if (contractError === MODE_CONFIRM_REQUIRES_BOOTSTRAP_SCRIPT_CONTRACT_ERROR) {
    return 'bootstrap_script'
  }
  return null
}

function maybeInjectMissingDirectiveTodoItems(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  const directiveTodoUnknownMatch = contractError.match(
    /^(refinement|script_review) todo_update\.set_item_status must not introduce new todo ids: /,
  )
  if (
    !directiveTodoUnknownMatch ||
    !isDirectiveTodoPhase(output.todo_update.phase) ||
    !output.todo_snapshot
  ) {
    return contractError
  }

  const missingIds = contractError
    .slice(directiveTodoUnknownMatch[0].length)
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  if (missingIds.length === 0) {
    return contractError
  }

  const currentById = new Map(session.todo_state.items.map((item) => [item.id, item] as const))
  let didInjectMissingItems = false
  for (const missingId of missingIds) {
    // Only a `d*` directive may be injected into a directive
    // phase's snapshot -- the same predicate the contract itself applies there
    // (`getInvalidTodoIdsForPhase`: script_review rejects every non-directive id).
    // Injecting anything else just trades this error for a snapshot-ownership
    // error, and then repairUnusableTodoSnapshot strips it straight back out,
    // leaving the two correctors fighting and the turn re-prompting anyway. That
    // is exactly what prod showed after the first fix shipped: the snapshot
    // signature vanished and `must not introduce new todo ids:
    // t1_intent_context, t2_script` took its place. Such an id belongs in the
    // update-side strip instead, where dropping it is a no-op.
    //
    // Tested positively (`isDirectiveTodoId`) rather than as `!isBootstrapTodoId`:
    // the latter is `/^t\d+/`, so it lets `t_brand` -- a real bootstrap_brand
    // stage id that can still be in todo_state by script_review -- through.
    if (!isDirectiveTodoId(missingId)) {
      continue
    }
    if (output.todo_snapshot.items.some((item) => item.id === missingId)) {
      continue
    }
    const current = currentById.get(missingId)
    if (!current) {
      return contractError
    }
    output.todo_snapshot.items.push({
      executor_hint: current.executor_hint ?? null,
      id: current.id,
      status: current.status,
      title: current.title,
    })
    didInjectMissingItems = true
  }

  return didInjectMissingItems ? deps.checkPlannerOutputContract(session, output) : contractError
}

/**
 * The planner restates the todo list in `todo_snapshot`, and after a
 * phase boundary that restatement can carry ids the new phase does not own --
 * stale bootstrap `t*` stages in a directive phase, or a misnamed stage id in
 * `bootstrap_visual` (`t3_visual_script` for the runtime's `t3_vs`). Both are
 * rejected by the snapshot ownership rules and cost the turn a re-prompt.
 *
 * Repair, in two steps, because neither half is sufficient alone:
 *
 *  1. **Drop the offending items.** Not the whole snapshot: a snapshot is also
 *     how NEW `d*` directives enter the plan (`getPendingDirectiveItems` reads
 *     it), so discarding it wholesale would silently throw away work the planner
 *     just planned.
 *  2. **Re-inject the current phase-valid items the snapshot no longer covers.**
 *     `todo_snapshot.items` is a full replace in the fold (`foldTodoPlan`:
 *     `items = e.snapshot`), so a stripped snapshot that omits a live item would
 *     delete it from the user's todo list. Re-injecting from
 *     `session.todo_state.items` keeps the plan whole -- and it is what makes the
 *     `bootstrap_visual` misnamed-id case heal at all (strip `t3_visual_script`,
 *     restore the real `t3_vs`).
 *
 * Items that are themselves offending are never re-injected, or the repair would
 * reproduce the error it just fixed. Re-validation is the backstop: anything the
 * repair cannot make legal returns a contract error and re-prompts as before.
 */
function repairUnusableTodoSnapshot(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  const isSnapshotOwnershipError =
    / todo_snapshot must not include bootstrap stage ids \(t\*\)\.$/.test(contractError) ||
    / todo_snapshot contains invalid ids: /.test(contractError)
  const snapshot = output.todo_snapshot
  if (!isSnapshotOwnershipError || !snapshot) {
    return contractError
  }

  // Phase validity is the single predicate for BOTH halves of the repair, and it
  // has to be. The previous version keyed the re-injection
  // off the ids NAMED IN THE ERROR, which is not the same question: an id absent
  // from the snapshot is never named, so a stale bootstrap stage still sitting in
  // `session.todo_state.items` was re-injected into a `bootstrap_visual` snapshot
  // that cannot legally hold it -- the repair reproducing the very error it was
  // fixing, one id list over. Prod bore that out: `script_review` fell to 1.9%
  // (below control) while `bootstrap_visual` stayed at 18.2% (8/44) with
  // `contains invalid ids: t1_intent_context, t2_script` still logging, and a `d1`
  // that only re-injection could have put there.
  const isInvalidHere = (id: string): boolean =>
    getInvalidTodoIdsForPhase(snapshot.phase, [id]).length > 0

  const kept = snapshot.items.filter((item) => !isInvalidHere(item.id))
  const keptIds = new Set(kept.map((item) => item.id))
  const strippedCount = snapshot.items.length - kept.length
  let injectedCount = 0
  for (const item of session.todo_state.items) {
    if (keptIds.has(item.id) || isInvalidHere(item.id)) {
      continue
    }
    kept.push({
      executor_hint: item.executor_hint ?? null,
      id: item.id,
      status: item.status,
      title: item.title,
    })
    injectedCount += 1
  }

  if (strippedCount === 0 && injectedCount === 0) {
    return contractError
  }

  // An empty result is legal and sometimes required. Filtering by phase validity
  // already preserves everything the phase may legally hold -- both what the
  // snapshot restated and what `todo_state` still carries -- so an empty `kept`
  // means the phase genuinely owns no todo items, not that a plan was erased.
  // `correctBootstrapVisualPhaseComplete` depends on it: rewriting a completed
  // bootstrap_visual output to `refinement` leaves a snapshot holding only
  // `t3_vs` / `t4_anchor_assets`, which are invalid in a directive phase, and
  // committing the empty snapshot is exactly how that turn advances instead of
  // re-prompting.

  output.todo_snapshot = { ...snapshot, items: kept }
  return deps.checkPlannerOutputContract(session, output)
}

/**
 * The post-confirmation chain carries bootstrap todo memory into
 * script_review (bootstrap_script -> script_review share one gpt-5.4 chain,
 * no restart), so the planner sometimes emits a TODO_UPDATE_ONLY that closes a
 * leftover bootstrap stage id (e.g. t2_script) via set_item_status. In a
 * directive phase only d* ids are valid, so the contract rejects it -- and this
 * is the single dominant contract error (~67%), dead-ending the turn. The t*
 * stages are runtime-owned and already done, so closing them is a no-op: drop
 * the flagged ids from set_item_status and re-validate. Returns `contractError`
 * unchanged when the case does not apply.
 */
function maybeStripInvalidTodoUpdateIds(
  session: SessionState,
  output: PlannerOutputLike,
  contractError: string,
  deps: Pick<PlannerLoopRuntimeDeps, 'checkPlannerOutputContract'>,
): null | string {
  // Phase-agnostic: bootstrap phases reject foreign ids the same
  // way directive phases do (`bootstrap_visual todo_update contains invalid ids:
  // t2_script`), and the strip is a no-op there for the same reason.
  //
  // Two message shapes, with different scopes:
  //   - `contains invalid ids` -- every flagged id is illegal for the phase, so
  //     all of them go.
  //   - `set_item_status must not introduce new todo ids` -- flagged ids are
  //     merely absent from the baseline. A `d*` id there is a new directive that
  //     maybeInjectMissingDirectiveTodoItems should ADD to the snapshot; only a
  //     stale bootstrap `t*` gets dropped.
  const invalidIdsMatch = contractError.match(/ todo_update contains invalid ids: (.+)$/)
  const unknownIdsMatch = contractError.match(
    / todo_update\.set_item_status must not introduce new todo ids: (.+)$/,
  )
  const match = invalidIdsMatch ?? unknownIdsMatch
  if (!match || !output.todo_update.set_item_status) {
    return contractError
  }

  const flaggedIds = match[1]
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  const invalidIds = new Set(
    invalidIdsMatch ? flaggedIds : flaggedIds.filter((id) => isBootstrapTodoId(id)),
  )
  const keptUpdates = output.todo_update.set_item_status.filter(
    (update) => !invalidIds.has(update.id),
  )
  if (invalidIds.size === 0 || keptUpdates.length === output.todo_update.set_item_status.length) {
    return contractError
  }

  output.todo_update.set_item_status = keptUpdates
  return deps.checkPlannerOutputContract(session, output)
}

const CONTRACT_CORRECTORS: ContractCorrector[] = [
  correctBootstrapVisualPhaseComplete,
  correctBrandRoutePhase,
  maybeInjectMissingDirectiveTodoItems,
  repairUnusableTodoSnapshot,
  maybeStripInvalidTodoUpdateIds,
]
