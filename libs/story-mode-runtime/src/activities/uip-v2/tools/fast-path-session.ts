// Do NOT import from workflow.ts
//
// UIP V2 -- FAST-PATH SessionState builder (no event log).
//
// The normal UIP path materializes a SessionState by folding the event log
// (`foldSession`/`prepareToolRuntime`). The fast path (`confirm_fast`) has no
// interactive planner session and therefore no event log; it fires at
// `script_review` with the confirmed spec + uploads already in storage. This module
// reconstructs the SAME SessionState shape `foldSession` would produce for a
// session sitting at `bootstrap_visual`, so the shared anchor+VS batch core
// (`runAnchorVsBatch`) runs byte-identically on both paths (zero drift).
//
// Everything here is PURE (no I/O): the fast-path activity reads the spec +
// PersistedSessionState from storage and passes them in, so this builder can be
// deep-equal-tested against `foldSession` of a synthetic event log.

import {
  brandStagedAssetsToUploads,
  type PersistedSessionState,
  type SessionState,
  type Spec,
  type UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

export interface BuildFastPathSessionStateInput {
  generationResolution?: { imageSize?: string; videoResolution?: string }
  imageModel?: string
  /**
   * Quality tier snapshot. Threaded as a direct input rather than
   * read off `persisted`, matching imageModel: confirm_fast has no event log to
   * fold, so anything the VS tool reads has to arrive explicitly or it is
   * silently undefined and the tool falls back to the compiled-in chain.
   */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  /** ISO timestamp for created_at/updated_at (activity passes new Date()). */
  nowIso: string
  orgId?: string
  persisted: PersistedSessionState
  projectId: string
  /** Confirmed full script the VS arm builds shots from. */
  script: string
  spec: Spec
  transitionVideoModel?: string
  /** User uploads only (brand bank is sourced by the tool from spec). */
  userUploadedAssets: UploadedAsset[]
}

/**
 * Build a `bootstrap_visual`-ready SessionState from storage-loaded inputs, mirroring
 * `buildBaseState` (session-state.ts) field-for-field. Only the fields the
 * anchor/VS tools read are load-bearing; the rest match the base-state defaults
 * so the shape is indistinguishable from a folded session.
 */
export function buildFastPathSessionState(input: BuildFastPathSessionStateInput): SessionState {
  const {
    generationResolution,
    imageModel,
    modelSelectorTier,
    nowIso,
    orgId,
    persisted,
    projectId,
    script,
    spec,
    transitionVideoModel,
    userUploadedAssets,
  } = input

  return {
    // `bootstrap_visual` is REQUIRED for the anchor FULL-scope guard
    // (tool-runtime.ts) -- a session at any other phase rejects scope=FULL.
    bootstrap: persisted.bootstrap ?? { remix_context: null, seed_style_instruction: null },
    cached_artifacts: {
      // emptyCachedArtifacts() defaults -- both are required by the tools.
      recovery_failures: [],
      tool_events: [],
      // User uploads only. The anchor tool's buildAnchorUploadPool merges brand
      // bank itself from spec.global_constraints.brand_bank -- pre-merging here
      // would double-count brand assets.
      uploaded_assets: userUploadedAssets,
      // pending_vs_apply=true makes the VS arm consume the confirmed full script
      // (shouldPreferFullScriptArtifact) rather than re-deriving from empty shots.
      working_script: {
        pending_vs_apply: true,
        scope: { scope: 'FULL' },
        script,
        shot_edits: [],
      },
      // Carry the confirmed prompt route so the VS arm biases identically to the
      // normal path (session-state.json persists it under either key).
      prompt_route: persisted.cached_artifacts?.prompt_route ?? persisted.prompt_route ?? undefined,
    },
    conversation_summary: '',
    created_at: nowIso,
    generationResolution,
    imageModel,
    is_processing: false,
    modelSelectorTier,
    orgId,
    queued_items: [],
    review_auto_continue_deadline_at: null,
    sessionId: projectId,
    spec,
    spec_history: [],
    todo_state: { items: [], phase: 'bootstrap_visual' },
    tool_call_states: [],
    transitionVideoModel: transitionVideoModel ?? persisted.transitionVideoModel,
    transcript: [],
    updated_at: nowIso,
    voiceProfile: persisted.voiceProfile,
  }
}

/**
 * User uploads for `cached_artifacts.uploaded_assets` -- session-state.json
 * carries the catalog under both a legacy top-level field and the newer
 * cached_artifacts path; dedupe by asset_id (first wins). Mirrors the
 * `sessionUploadedAssets` merge in uip-confirm-fast-orchestration.ts. Brand-bank
 * assets are intentionally excluded (the anchor tool sources them from spec).
 */
export function buildFastPathUserUploads(persisted: PersistedSessionState): UploadedAsset[] {
  const seen = new Set<string>()
  return [
    ...(persisted.uploaded_assets ?? []),
    ...(persisted.cached_artifacts?.uploaded_assets ?? []),
  ].filter((a) => {
    if (!a.asset_id || seen.has(a.asset_id)) {
      return false
    }
    seen.add(a.asset_id)
    return true
  })
}

/**
 * PRE-dedup merge (user uploads + brand-bank synthetics) for
 * `buildUserUploadAnchorEntries` in the convert step. Mirrors the normal
 * confirm path's `mergedUploadedAssets` (uip-confirm-orchestration.ts): the
 * script writer force-binds brand_<bucket>_<hash> ids whose bytes can also exist
 * as a real upload, and dedup strips exactly those synthetic ids -- resolving
 * shot bindings against the PRE-dedup pool keeps them from being dropped.
 */
export function buildFastPathMergedUploads(
  persisted: PersistedSessionState,
  spec: Spec,
): UploadedAsset[] {
  return [
    ...(persisted.uploaded_assets ?? []),
    ...(persisted.cached_artifacts?.uploaded_assets ?? []),
    ...brandStagedAssetsToUploads(spec.global_constraints.brand_bank ?? null),
  ]
}
