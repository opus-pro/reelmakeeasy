import { canonicalizeGlobalConstraintValue } from '../normalization'
import { PacingSchema, type Spec } from '../types'

import type { PatchContext, PatchResult } from './patch-apply'

// update_global_field op. Split out of patch-apply.ts to keep that dispatch
// file under the max-lines cap; wired into the patch-apply switch by import.

// Workflow-owned brand fields (`brand_extraction_status`,
// `brand_extraction_failure_reason`, `brand_extraction_started_at`,
// `brand_extraction_run_id`, `brand_bank_locked_at`) and the bank itself
// are intentionally excluded so the planner cannot write them via
// update_global_field. They transition only via the named brand ops
// (start_brand_extraction, seed_brand_synthesis, fail_brand_extraction,
// lock_brand_bank, add_brand_asset, remove_brand_asset).
const ALLOWED_GLOBAL_PATHS = new Set([
  'brand_extraction_input',
  'brand_scope',
  'brand_style_directive',
  'brand_style_preview_url',
  'brand_style_text',
  'brand_video_type',
  'directives',
  'geo_scope',
  'key_entities',
  'must_not_violate',
  'pacing',
  'script_category',
  'script_language',
  // Auto Style Selection: select_auto_style's auto-apply ops (see
  // GLOBAL_CONSTRAINT_ARTIFACT_FIELDS in auto-apply-runtime.ts) write these
  // alongside `style`. `style_mode` is deliberately excluded -- it is
  // seed-time-only and never written via update_global_field.
  'selection_method',
  'style',
  'style_candidates',
  'style_source',
  'target_audience',
  'time_scope',
  'tone',
  'topic',
  'video_type',
])

export function applyUpdateGlobalField(
  spec: Spec,
  path: string,
  value: unknown,
  context?: PatchContext,
): PatchResult {
  if (!ALLOWED_GLOBAL_PATHS.has(path)) {
    return { spec, error: `Field path '${path}' is not in the allowlist for update_global_field` }
  }

  // Brand-input freeze: once the workflow has started extraction (status set
  // to pending / completed / failed / locked), the input it ran against is
  // pinned. Re-extraction must go through a workflow-side `TERMINATE_IF_RUNNING`
  // restart, not an in-place input swap.
  if (
    path === 'brand_extraction_input' &&
    spec.global_constraints.brand_extraction_status !== null
  ) {
    return {
      spec,
      error: 'BRAND_INPUT_FROZEN: brand_extraction_input cannot change once extraction has started',
    }
  }

  // brand_style_* (directive / text / preview_url) are meaningless until the
  // bank exists and freeze once it locks. Writes are accepted only in the
  // 'completed' window (brand_review) -- all ride the atomic confirm patch.
  if (path.startsWith('brand_style_')) {
    const status = spec.global_constraints.brand_extraction_status
    if (status !== 'completed') {
      return {
        spec,
        error: `${path} can only be written while brand_extraction_status === 'completed' (current: ${status ?? 'null'})`,
      }
    }
  }

  // brand_video_type is captured by the planner during mode_confirmation
  // (section 2.6.5 chip ASK_CLARIFY or inference) and frozen at
  // MODE_CONFIRMED. Section 2.6.6 refinement is made against the chosen
  // type and feeds bootstrap_script; revising the type later would leave
  // refinement answers misaligned with the new arc.
  if (path === 'brand_video_type') {
    const phase = context?.phase
    if (phase !== 'mode_confirmation') {
      return {
        spec,
        error: `brand_video_type can only be written while todo_state.phase is 'mode_confirmation' (current: ${phase ?? 'null'})`,
      }
    }
  }

  // directives / must_not_violate are the video brief's "do" / "don't" lists.
  // Patchable in every phase: the patch lands in global_constraints, and in
  // refinement the planner re-wakes after PATCH_SPEC to realize it via
  // the visual-script / script tool -- so the brief write is recorded AND the
  // storyboard regenerates, instead of the old hard-ban that dropped the write.

  // Strict pacing enum check: reject anything outside the three valid labels
  // with an explicit error so the planner retry sees why it failed.
  if (path === 'pacing' && value !== null && value !== '') {
    const parsed = PacingSchema.safeParse(value)
    if (!parsed.success) {
      return {
        spec,
        error: `update_global_field path=pacing value=${JSON.stringify(value)} is not a valid pacing. Must be one of: ${PacingSchema.options.join(' | ')}`,
      }
    }
  }

  const gc = spec.global_constraints as Record<string, unknown>
  const normalizedValue = canonicalizeGlobalConstraintValue(path, value)

  if (path.includes('.')) {
    const [parent, child] = path.split('.')
    if (!gc[parent] || typeof gc[parent] !== 'object') {
      gc[parent] = {}
    }
    ;(gc[parent] as Record<string, unknown>)[child] = normalizedValue
  } else {
    gc[path] = normalizedValue
  }

  return { spec }
}
