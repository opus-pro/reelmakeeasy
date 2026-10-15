// Do NOT import from workflow.ts
//
// applyPatchActivity is the thin V2 activity that validates a set of PatchOps
// against the projected spec by reusing the V1 applyPatch kernel. It runs on
// the activity (Node) side, so VALUE
// imports of foldSession + applyPatch are allowed. Keep it out of workflow
// modules, so they stay light and testable.
//
// Responsibility: rebuild the V1 SessionState from the event log via
// foldSession, run V1 applyPatch against the current spec, and report whether
// the ops applied cleanly plus the resulting spec_version. The workflow owns
// what to do with the result (append a spec_patched event on ok, re-prompt /
// surface the error otherwise) -- this activity never mutates the log.

import type { PatchOp } from '@reelmakeeasy/uip-planner-runtime'
import { applyPatch, getAllowedUploadedAssetIds } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { foldSession } from './session-state'
import { resolveSpecCheckpoint } from './spec-checkpoint'

export interface ApplyPatchInput {
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  ops: PatchOp[]
}

export interface ApplyPatchResult {
  error?: string
  ok: boolean
  specVersionAfter: number
}

/**
 * Project the event log into a V1 SessionState, then run V1 applyPatch on the
 * current spec with base_version pinned to the current spec_version.
 *
 * On success applyPatch returns the bumped spec; on error it returns the
 * unchanged spec, so specVersionAfter is the pre-patch version in the error
 * case (correct -- nothing was applied).
 */
export async function applyPatchActivity(input: ApplyPatchInput): Promise<ApplyPatchResult> {
  const { currentArtifacts, events, ops } = input

  const checkpointSpec = await resolveSpecCheckpoint(events)
  const session = foldSession(events, currentArtifacts, checkpointSpec)
  const res = applyPatch(
    session.spec,
    {
      // V1 parity (spec-runtime.ts): without this, add_preselected_asset for any
      // source=user_upload asset is rejected ("not in uploaded_assets allowlist")
      // because patch-apply defaults the allowlist to empty -- so adding an
      // uploaded image to a shot silently no-ops in V2.
      allowed_user_upload_asset_ids: getAllowedUploadedAssetIds(session),
      base_version: session.spec.meta.spec_version,
      diff_summary: '',
      ops,
    },
    // V1 parity: spec-runtime passes the folded phase so phase-gated writes
    // (update_global_field brand_video_type, update_brand_bank_field,
    // remove_brand_asset) validate against the real phase, not null.
    {
      phase: session.todo_state.phase,
      transitionVideoModel: session.transitionVideoModel,
    },
  )

  return {
    error: res.error,
    ok: !res.error,
    specVersionAfter: res.spec.meta.spec_version,
  }
}
