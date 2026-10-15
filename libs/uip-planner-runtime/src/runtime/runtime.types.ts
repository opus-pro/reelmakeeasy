import {
  ClarifyOption,
  PatchOp,
  PlannerEmittedShot,
  PlannerStructureEdit,
  PlannerToolCall,
  ReplaceAllShotsOp,
  ReplaceShotsRangeOp,
  SessionControlCommand,
  SessionState,
  TodoExecutorHint,
  ToolErrorCode,
  ToolExecutionEvent,
  UndoScope,
} from '../types'

import type { PlannerOutput } from './planner-schema'

export interface CheckClarifyScopeDeps {
  /**
   * Returns true iff the directive's hinted executor tool has a successful
   * completion since the directive last became pending. Absent = no evidence
   * channel available to the caller, so the executor-evidence guard in
   * checkDirectiveTodoUpdateContract is skipped (back-compat).
   */
  didDirectiveExecutorRun?: (directiveId: string) => boolean
  hasPendingTodoItems: (session: SessionState) => boolean
  isBootstrapArtifactsComplete: (session: SessionState) => boolean
}

export interface GuardUndescribedAssetsDeps {
  getUndescribedUploadedAssets: (session: SessionState) => Array<{ asset_id: string }>
  recordToolEvent: (session: SessionState, event: ToolExecutionEvent) => void
}

export interface IntentRoutingGuardOptions {
  output: PlannerOutputLike
  /**
   * Per-turn tracking set for "first hint, second defer" behavior on #4/#5
   * global-field refresh policy. Keyed by planner output intent
   * (action + tool + scope), NOT by guard error text. If the planner emits
   * the same signature twice, the guard defers on the second call and the
   * action proceeds -- preserving planner autonomy when it's confident.
   */
  policyHintedSignatures: Set<string>
  session: SessionState
  userMessage: string
}

export interface PlannerOutputLike {
  action:
    | 'ASK_CLARIFY'
    | 'MODE_CONFIRMED'
    | 'PATCH_SPEC'
    | 'SESSION_CONTROL'
    | 'TODO_UPDATE_ONLY'
    | 'TOOL_CALLS'
  conversation_summary_update?: string
  expect_assets?: boolean | null
  mode_update: {
    // Flipped by the mode_confirmation brand-intent classifier. Optional /
    // undefined-able: post-confirmation prompts omit it and applyAgentMemory
    // preserves the prior value via spread.
    brand_intent_pending?: boolean | null
    // Narrative-arc enum for a branded video. A mode_update field,
    // not a patch op; applyAgentMemory writes it to
    // global_constraints.brand_video_type. Undefined preserves the prior value.
    brand_video_type?: 'friction_to_flow' | 'industry_explainer' | 'product_showcase' | null
    confirmed: boolean
    duration_seconds: null | number
    duration_source?: 'other' | 'script_estimate' | 'user_explicit' | null
    input_type?:
      | 'audio_music'
      | 'audio_script'
      | 'prompt_and_script'
      | 'prompt_only'
      | 'script_only'
      | null
    mode: 'ads' | 'explainer' | 'narrative_story' | null
    reason: string
  }
  ops: null | PlannerPatchOp[]
  options?: ClarifyOption[] | null
  reply: string
  reply_question?: null | string
  session_control: null | PlannerSessionControlLike
  // Mirrors PlannerOutputSchema's stale_dispositions -- see that
  // schema's comment for the (artifact, source_path) keying rationale.
  stale_dispositions?: Array<{
    artifact: 'anchor_bindings' | 'global_constraints' | 'script' | 'visual_script'
    disposition: 'ask' | 'dismiss' | 'patch' | 'tool'
    reason?: null | string
    source_path: string
  }> | null
  structure_edit?: null | PlannerStructureEdit
  todo_snapshot?: null | {
    items: Array<{
      executor_hint?: null | TodoExecutorHint
      id: string
      status: 'done' | 'pending'
      title: string
    }>
    phase:
      | 'bootstrap_brand'
      | 'bootstrap_script'
      | 'bootstrap_visual'
      | 'brand_review'
      | 'mode_confirmation'
      | 'refinement'
      | 'script_review'
  }
  todo_update: {
    clear: boolean | null
    phase:
      | 'bootstrap_brand'
      | 'bootstrap_script'
      | 'bootstrap_visual'
      | 'brand_review'
      | 'mode_confirmation'
      | 'refinement'
      | 'script_review'
    set_item_status: Array<{ id: string; status: 'done' | 'pending' }> | null
  }
  tool_calls: null | PlannerToolCall[]
}

// PlannerOutputLike's own ops shape. Identical to PatchOp (the
// fully-resolved type patch-apply.ts / visual-auto-apply-runtime.ts operate
// on) except for replace_all_shots / replace_shots_range, where it uses
// PlannerEmittedShot instead of the canonical Shot -- matching what
// PlannerPatchOpSchema's PlannerShotSchema actually infers (no
// visual_primary.availability). PatchOp itself is untouched: every real
// construction of these two ops goes through visual-auto-apply-runtime.ts
// with full canonical shots, never through this planner-output mirror.
type PlannerPatchOp =
  | Exclude<PatchOp, ReplaceAllShotsOp | ReplaceShotsRangeOp>
  | (Omit<ReplaceAllShotsOp, 'shots'> & { shots: PlannerEmittedShot[] })
  | (Omit<ReplaceShotsRangeOp, 'shots'> & { shots: PlannerEmittedShot[] })

/**
 * Compile-time check: PlannerOutput (Zod-inferred) must remain assignable to
 * PlannerOutputLike (hand-written). If someone changes the Zod schema without
 * updating PlannerOutputLike (or vice-versa), this line will produce a TS error.
 */
const _mirrorCheck: PlannerOutputLike = null as unknown as PlannerOutput

/**
 * The assignability check above only catches an EXISTING shared field's type
 * changing incompatibly -- TS ignores an extra property on the source when
 * assigning to a named (non-literal) target type, so a brand-new field added
 * to only one side passes silently. This closes that gap by asserting the
 * two interfaces expose the exact same key set.
 */
type _MirrorKeysMatch = keyof PlannerOutputLike extends keyof PlannerOutput
  ? keyof PlannerOutput extends keyof PlannerOutputLike
    ? true
    : false
  : false
const _mirrorKeysCheck: _MirrorKeysMatch = true

export interface PlannerSessionControlLike {
  command: SessionControlCommand
  count: null | number
  undo_scope: null | UndoScope
}

export interface PlannerStepResultLike {
  didScriptMutation?: boolean
  didSpecMutation?: boolean
  forceContinueNextStep?: boolean
  lastActionResult: string
  shouldStop: boolean
  unresolvedDirectiveReconcileError?: boolean
}

export type ToolCallResult = {
  code: 'OK' | ToolErrorCode
  markStageDone?: boolean
  message: string
  missing?: string[]
  ok: boolean
  retryable: boolean
}
