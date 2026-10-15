// Planner recovery / repair domain types. Extracted from types.ts to keep that
// barrel under the 800-line cap. Re-exported from the package
// root via index.ts, so consumers keep importing from '@reelmakeeasy/uip-planner-runtime'.

import type { PlannerToolCall, ToolErrorCode } from './types'

export type ExecutionFailureStage =
  | 'artifact_apply'
  | 'batch_preflight'
  | 'duplicate_invalid_guard'
  | 'planner_contract'
  | 'post_step_invariant'
  | 'tool_runtime'

export interface PlannerRecoveryContext {
  duplicate_invalid_guard_active: boolean
  last_failure: null | PlannerRecoveryFailure
  recent_failures: PlannerRecoveryFailure[]
  repair_candidates: PlannerRepairCandidate[]
}

export interface PlannerRecoveryFailure {
  error_code: RecoveryErrorCode
  failed_tool?: null | PlannerToolCall['tool']
  failure_stage: ExecutionFailureStage
  intent_signature?: null | string
  message: string
  missing_fields?: string[]
  normalized_params?: null | Record<string, unknown>
  repair_hint?: null | string
  retryable: boolean
  timestamp: string
}

export interface PlannerRepairCandidate {
  candidate_anchor_id?: null | string
  candidate_anchor_type?: 'CHARACTER' | 'OBJECT' | null
  candidate_recovery_action:
    | 'ASK_CLARIFY_BINDING'
    | 'CONTINUE_ANCHOR_UPSERT_WITHOUT_REFS'
    | 'EMIT_SHARED_ANCHOR_PLAN_BATCH'
    | 'REPAIR_ANCHOR_BINDING_PARAMS'
  candidate_source_asset_id?: null | string
  candidate_source_asset_ids?: string[]
  failed_tool?: null | PlannerToolCall['tool']
  reason: string
}

export type RecoveryErrorCode =
  | 'ARTIFACT_APPLY_ERROR'
  | 'BATCH_PREFLIGHT_ERROR'
  | 'DUPLICATE_INVALID_GUARD'
  | 'PLANNER_CONTRACT_ERROR'
  | 'USER_UPLOAD_NOT_BOUND'
  | 'USER_UPLOAD_UNDESCRIBED_BEFORE_SPEC_BIND'
  | ToolErrorCode
