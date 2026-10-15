import { createSubLogger } from '@reelmakeeasy/common/logger'

import { applyPatch } from '../patch-apply/patch-apply'
import { persistSpecSnapshot } from '../persistence'
import { computeChangedShotFields, ShotChangeMap } from '../renderer'
import { writeScriptWordCapAudit } from '../tool-internals/script-word-cap-audit'
import { withDeterministicRetimeForScriptChanges } from '../tool-internals/visual-script-timing'
import { getToolManifest } from '../tool-manifest'
import {
  Meta,
  OpenQuestion,
  Patch,
  PatchOp,
  PlannerToolCall,
  SessionState,
  Spec,
  SpecHistorySource,
} from '../types'
import { validateSpec } from '../validator'

import { buildAutoApplyOpsForTool } from './auto-apply-runtime'
import { plannerLog } from './planner-log'
import { describePatchOps, describeToolArtifactPatch } from './runtime-facade-helpers'
import { syncScriptWordCapAudit } from './script-word-cap-runtime'
import { getAllowedUploadedAssetIds } from './session-runtime'

const logger = createSubLogger('user-intent-planner')

const AUTO_LOCK_DELAY_MS = 5 * 60 * 1000 // 5 minutes
const MAX_SPEC_HISTORY = 30

export async function applyPatchOps(
  runtime: object,
  session: SessionState,
  ops: PatchOp[],
): Promise<{ diffSummary: string; message: string; ok: boolean }> {
  const prevSpec: Spec = JSON.parse(JSON.stringify(session.spec))
  const opsWithAutoRetime = withDeterministicRetimeForScriptChanges(session.spec, ops)
  const patch: Patch = {
    base_version: session.spec.meta.spec_version,
    ops: opsWithAutoRetime,
    diff_summary: '',
    allowed_user_upload_asset_ids: getAllowedUploadedAssetIds(session),
  }
  const result = applyPatch(session.spec, patch, {
    phase: session.todo_state.phase,
    transitionVideoModel: session.transitionVideoModel,
  })

  if (result.error) {
    return {
      ok: false,
      message: `Patch failed: ${result.error}`,
      diffSummary: '',
    }
  }

  const diffSummary = describePatchOps(opsWithAutoRetime)
  pushSpecHistory(session, prevSpec, diffSummary, 'PATCH_SPEC', opsWithAutoRetime)
  session.spec = result.spec
  syncPostSpecMutation(runtime, session, prevSpec)

  const persisted = await persistSpecAfterMutation(
    runtime,
    session,
    prevSpec,
    'PATCH_SPEC',
    diffSummary,
  )
  if (!persisted.ok) {
    return {
      ok: false,
      diffSummary: '',
      message: `Patch applied in memory but failed to persist: ${persisted.error}`,
    }
  }
  clearPendingFullScriptArtifactIfNeeded(session, opsWithAutoRetime)
  return {
    ok: true,
    diffSummary,
    message: `Patch applied successfully (${opsWithAutoRetime.length} op(s)).`,
  }
}

export async function applyToolArtifactsToSpec(
  runtime: object,
  session: SessionState,
  tool: PlannerToolCall['tool'],
): Promise<{
  changed: boolean
  diffSummary: string
  message: string
  ok: boolean
}> {
  const manifest = getToolManifest(tool)
  if (!manifest.auto_apply?.enabled) {
    return {
      ok: true,
      changed: false,
      diffSummary: '',
      message: `Auto-apply disabled for ${tool}.`,
    }
  }

  if (tool === 'generate_explainer_script' && session.spec.visual_script.shots.length === 0) {
    return {
      ok: true,
      changed: false,
      diffSummary: '',
      message:
        'Skipped script auto-apply because visual_script has no shots yet; waiting for visual script generation.',
    }
  }

  const ops = buildAutoApplyOpsForTool(session, tool)
  const opsWithAutoRetime = withDeterministicRetimeForScriptChanges(session.spec, ops)
  if (opsWithAutoRetime.length === 0) {
    return {
      ok: true,
      changed: false,
      diffSummary: '',
      message: `No auto-apply changes for ${tool}.`,
    }
  }

  const prevSpec: Spec = JSON.parse(JSON.stringify(session.spec))
  const patch: Patch = {
    base_version: session.spec.meta.spec_version,
    ops: opsWithAutoRetime,
    diff_summary: '',
    allowed_user_upload_asset_ids: getAllowedUploadedAssetIds(session),
  }
  const result = applyPatch(session.spec, patch, {
    phase: session.todo_state.phase,
    transitionVideoModel: session.transitionVideoModel,
  })

  if (result.error) {
    return {
      ok: false,
      changed: false,
      diffSummary: '',
      message: `Failed to apply tool artifacts: ${result.error}`,
    }
  }

  const diffSummary = describeToolArtifactPatch(opsWithAutoRetime)
  pushSpecHistory(session, prevSpec, diffSummary, 'TOOL_ARTIFACT', opsWithAutoRetime)
  session.spec = result.spec
  syncPostSpecMutation(runtime, session, prevSpec)

  const persisted = await persistSpecAfterMutation(
    runtime,
    session,
    prevSpec,
    'TOOL_ARTIFACT',
    diffSummary,
  )
  if (!persisted.ok) {
    return {
      ok: false,
      changed: false,
      diffSummary: '',
      message: `Applied ${tool} artifact in memory but failed to persist: ${persisted.error}`,
    }
  }
  clearPendingFullScriptArtifactIfNeeded(session, opsWithAutoRetime)

  return {
    ok: true,
    changed: true,
    diffSummary,
    message: `Applied ${tool} artifact mapper (${opsWithAutoRetime.length} op(s)).`,
  }
}

export function applyValidation(
  meta: Meta,
  validation: ReturnType<typeof validateSpec>,
  additionalQuestions: OpenQuestion[] = [],
  phase?: SessionState['todo_state']['phase'],
): void {
  const merged = [...validation.open_questions, ...additionalQuestions]
  const filtered = shouldSuppressVisualBlockingForPhase(phase)
    ? merged.filter((question) => !isVisualValidationQuestion(question))
    : merged
  const deduped = new Map<string, OpenQuestion>()

  for (const question of filtered) {
    const key = `${question.question}::${question.missing_paths.join('|')}`
    deduped.set(key, question)
  }

  meta.open_questions = [...deduped.values()]
  meta.blocking = meta.open_questions.some((q) => q.blocking)
}

export async function persistSpecAfterMutation(
  _runtime: object,
  session: SessionState,
  prevSpec: Spec,
  source: SpecHistorySource,
  diffSummary: string,
): Promise<{ error?: string; ok: boolean }> {
  try {
    await persistSpecSnapshot(session.sessionId, session.spec)
    return { ok: true }
  } catch (error) {
    logger.error(
      plannerLog(session.sessionId, '[persistSpecAfterMutation] failed', {
        error: error instanceof Error ? error.message : String(error),
        source,
        diffSummary,
      }),
    )
    rollbackSpecMutation(session, prevSpec, source, diffSummary)
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function pushSpecHistory(
  session: SessionState,
  prevSpec: Spec,
  diffSummary: string,
  source: SpecHistorySource,
  ops?: PatchOp[],
): void {
  session.spec_history.push({
    prev_spec: JSON.parse(JSON.stringify(prevSpec)),
    diff_summary: diffSummary,
    ops: ops ? [...ops] : undefined,
    source,
    timestamp: new Date().toISOString(),
  })

  if (session.spec_history.length > MAX_SPEC_HISTORY) {
    session.spec_history = session.spec_history.slice(-MAX_SPEC_HISTORY)
  }
}

export function rollbackSpecMutation(
  session: SessionState,
  prevSpec: Spec,
  source: SpecHistorySource,
  diffSummary: string,
): void {
  session.spec = JSON.parse(JSON.stringify(prevSpec))

  const lastHistory = session.spec_history[session.spec_history.length - 1]
  if (
    lastHistory &&
    lastHistory.source === source &&
    lastHistory.diff_summary === diffSummary &&
    JSON.stringify(lastHistory.prev_spec) === JSON.stringify(prevSpec)
  ) {
    session.spec_history.pop()
  }

  const validation = validateSpec(session.spec)
  applyValidation(session.spec.meta, validation, [], session.todo_state.phase)

  // Rollback resets the spec to prev_spec which already had a stamped
  // `meta.script_word_cap` value, but that value is "post-rollback stale"
  // because open_questions / blocking just rebuilt. Re-run the pure audit
  // so the flag is consistent with the restored script. No reply injected
  // on rollback: the user didn't make a new change to comment on.
  writeScriptWordCapAudit(session)

  if (shouldRunAutoLockCountdown(session)) {
    setAutoLockDeadline(session.spec.meta, { refresh: true })
  } else {
    session.spec.meta.auto_lock_deadline_at = null
  }

  ;(session as unknown as { _lastChangedShotFields: ShotChangeMap })._lastChangedShotFields =
    computeChangedShotFields(prevSpec, session.spec)
  clearAppliedPendingArtifacts(session)
}

export function setAutoLockDeadline(meta: Meta, options?: { refresh?: boolean }): void {
  if (options?.refresh || !meta.auto_lock_deadline_at) {
    meta.auto_lock_deadline_at = new Date(Date.now() + AUTO_LOCK_DELAY_MS).toISOString()
  }
}

/**
 * Single source of truth: should the auto-lock countdown be running right now?
 *
 * Returns true only when all three conditions hold:
 *  1. Session is in refinement phase (the only phase that owns this countdown)
 *  2. Session is not locked (locked sessions have no active deadline)
 *  3. TTS word cap is not exceeded (cap-exceeded pauses the countdown;
 *     the user must trim before entering video production)
 *
 * Intentionally excludes `spec.meta.blocking`: anchor-asset blocking questions
 * (e.g. "needs reference photo") must NOT pause the countdown -- the session
 * always has a path forward (skip / generate without reference), so nothing
 * should gate entering video production.
 */
export function shouldRunAutoLockCountdown(session: SessionState): boolean {
  return (
    session.todo_state.phase === 'refinement' &&
    !session.spec.meta.locked_at &&
    session.spec.meta.script_word_cap?.exceeded !== true
  )
}

export function syncPostSpecMutation(
  runtime: object,
  session: SessionState,
  prevSpec: Spec,
  extraQuestions: OpenQuestion[] = [],
  options?: { clearPendingArtifacts?: boolean },
): void {
  const validation = validateSpec(session.spec)
  applyValidation(session.spec.meta, validation, extraQuestions, session.todo_state.phase)

  // TTS word-cap audit: stamp `meta.script_word_cap` and inject a reply
  // when the current script exceeds the vendor's 1700-word hard cap. Must
  // happen BEFORE the auto-lock-deadline decision below so the
  // "exceeded -> null out the countdown" gate sees the fresh result.
  syncScriptWordCapAudit(runtime, session)

  if (shouldRunAutoLockCountdown(session)) {
    setAutoLockDeadline(session.spec.meta, { refresh: true })
  } else {
    session.spec.meta.auto_lock_deadline_at = null
  }

  // Script-review 3-min auto-continue deadline: when a PATCH_SPEC inside
  // script_review pushes the script past cap, clear the deadline here so
  // the frontend countdown banner disappears immediately, rather than
  // waiting for the planner-loop `finally` `refreshPhaseDeadline` to
  // re-run and notice. `shouldAutoContinueReviewGate` also defends this
  // but there the user can still see a stale countdown in the meantime.
  if (
    session.todo_state.phase === 'script_review' &&
    session.spec.meta.script_word_cap?.exceeded === true
  ) {
    session.review_auto_continue_deadline_at = null
  }

  const changedShotFields = computeChangedShotFields(prevSpec, session.spec)
  ;(session as unknown as { _lastChangedShotFields: ShotChangeMap })._lastChangedShotFields =
    changedShotFields
  if (options?.clearPendingArtifacts !== false) {
    clearAppliedPendingArtifacts(session)
  }
}

function clearAppliedPendingArtifacts(session: SessionState): void {
  session.cached_artifacts.pending_asset_assignment_plan = undefined
  session.cached_artifacts.pending_global_constraints = undefined
  session.cached_artifacts.pending_visual_script_shots = undefined
  session.cached_artifacts.pending_visual_script_scope = undefined
}

function clearPendingFullScriptArtifactIfNeeded(session: SessionState, ops: PatchOp[]): void {
  const artifact = session.cached_artifacts.working_script
  if (!artifact || artifact.scope.scope !== 'FULL' || artifact.pending_vs_apply !== true) {
    return
  }

  const hasShotOrAudioMutation = ops.some((op) => {
    switch (op.op) {
      case 'delete_shots':
      case 'reorder_shots':
      case 'replace_all_shots':
      case 'replace_shots_range': {
        return true
      }
      case 'update_shot_field': {
        return op.field === 'audio_vo'
      }
      default: {
        return false
      }
    }
  })

  if (!hasShotOrAudioMutation) {
    return
  }

  artifact.pending_vs_apply = false
}

function isVisualValidationQuestion(question: OpenQuestion): boolean {
  return (
    question.missing_paths.length > 0 &&
    question.missing_paths.every((path) => path.startsWith('visual_script.'))
  )
}

function shouldSuppressVisualBlockingForPhase(
  phase?: SessionState['todo_state']['phase'],
): boolean {
  return phase === 'bootstrap_script' || phase === 'script_review'
}
