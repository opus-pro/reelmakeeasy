import type { BrandBank, Spec } from '../types'

import type { PatchResult } from './patch-apply'

// Brand carry v2: direct brand carry-over on remix. Split out of patch-apply.ts to
// keep that dispatch file under the max-lines cap; wired into the patch-apply
// switch by import.

/**
 * Apply the staged brand carry: seed the carried bank + input + shape and set
 * brand_extraction_status='completed'.
 *
 * Setting status 'completed' WITHOUT ever going through 'pending' is the whole
 * mechanism: maybeStartBrandExtractionChild only fires on status null (so the
 * extraction child is skipped), and canonicalizePlannerPhase flips
 * bootstrap_brand -> brand_review on status 'completed' (so the user lands at
 * the existing confirm/pick step). The resulting spec is indistinguishable from
 * post-extraction state, so the escape hatches at brand_review
 * (change_brand_extraction_source, manual edits) work on a carried bank too.
 *
 * `via` records whether the planner emitted the op or the runtime applied the
 * carry-by-default fallback at MODE_CONFIRMED (handleModeConfirmedAction).
 */
export function applyBrandCarry(spec: Spec, via: 'fallback' | 'op' = 'op'): PatchResult {
  const carry = spec.global_constraints.brand_carry_state
  if (carry === null) {
    return { spec, error: 'BRAND_CARRY_INVALID: no brand_carry_state to apply' }
  }
  if (carry.status !== 'pending') {
    return {
      spec,
      error: `BRAND_CARRY_INVALID: status must be 'pending', got '${carry.status}'`,
    }
  }
  if (spec.global_constraints.brand_extraction_status !== null) {
    return { spec, error: 'BRAND_CARRY_INVALID: extraction already started' }
  }
  if (spec.global_constraints.brand_extraction_input !== null) {
    return { spec, error: 'BRAND_CARRY_INVALID: brand_extraction_input already set' }
  }
  if (carry.source_brand_bank === null) {
    // Unreachable for a seeded carry (session-init always seeds a bank, and the
    // bank is only nulled on resolve), but the schema permits null post-resolve.
    return { spec, error: 'BRAND_CARRY_INVALID: pending carry has no bank' }
  }
  spec.global_constraints.brand_extraction_input = carry.source_brand_extraction_input
  // A null carried shape (pre-shape-era source) must not clobber a shape the
  // planner already wrote this session; the section 2.6.5 ask fills the gap.
  if (carry.source_brand_video_type !== null) {
    spec.global_constraints.brand_video_type = carry.source_brand_video_type
  }
  spec.global_constraints.brand_bank = carry.source_brand_bank
  spec.global_constraints.brand_extraction_status = 'completed'
  // Drop the bank from the carry record: global_constraints.brand_bank is the
  // live copy now, and keeping both would double the bank's bytes in every
  // spec persist / activity payload for the rest of the session.
  spec.global_constraints.brand_carry_state = {
    ...carry,
    source_brand_bank: null,
    status: 'applied',
    applied_via: via,
  }
  return { spec }
}

// Clone URIs are `brand-carry/<bucket>/<hash8>-<source-basename>`; strip the
// 8-hex prefix to recover the source basename the remix FE re-uploads under.
const CLONE_PREFIX_RE = /^[0-9a-f]{8}-/

/**
 * Identity keys for every image in a carried bank: `hash:<content_hash>` plus
 * `name:<source basename, lowercased>`. Computed at session-init and stored on
 * `brand_carry_state.carried_asset_keys` so they outlive the bank (dropped on
 * resolve). The extraction fold uses them to skip init-prompt uploads that are
 * the remix FE's re-attachments of the carried brand's images: after a brand
 * switch those would otherwise re-fold the OLD brand's logo into the NEW
 * brand's bank.
 */
export function buildBrandCarryAssetKeys(bank: BrandBank): string[] {
  const keys = new Set<string>()
  const { staged_assets } = bank
  for (const ref of [...staged_assets.logo, ...staged_assets.product, ...staged_assets.character]) {
    if (ref.content_hash) {
      keys.add(`hash:${ref.content_hash}`)
    }
    const basename = ref.staging_uri.split('/').findLast(Boolean)
    if (basename) {
      keys.add(`name:${basename.replace(CLONE_PREFIX_RE, '').toLowerCase()}`)
    }
  }
  return [...keys]
}

/**
 * Mark a still-pending carry 'discarded'. Called from
 * applySetBrandExtractionInput's success paths: the planner setting a NEW brand
 * input is the "user changed the brand" exception, which supersedes the carry.
 * No-op when there is no carry or it is already resolved.
 */
export function discardPendingBrandCarry(spec: Spec): void {
  const carry = spec.global_constraints.brand_carry_state
  if (carry?.status === 'pending') {
    // Drop the bank too: a discarded carry never seeds it, so keeping it would
    // only bloat every later spec persist with dead bytes.
    spec.global_constraints.brand_carry_state = {
      ...carry,
      source_brand_bank: null,
      status: 'discarded',
    }
  }
}
