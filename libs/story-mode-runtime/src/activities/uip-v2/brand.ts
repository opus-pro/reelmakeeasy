// Do NOT import from workflow.ts
//
// UIP V2 brand activity (Phase 4). Builds the named brand PatchOps for a given
// brand action, validates them against the folded session via the V1
// `applyPatch` (so the brand status/phase preconditions in patch-apply.ts are
// enforced), and returns the ops + resulting spec version. The workflow appends
// them as a `spec_patched` event (contract #6: activities never mutate the log).
//
// Reuses the V1 op-builders verbatim (buildBrandExtractionOps,
// brandBankEditPayloadToPatchOp) rather than re-authoring them. Runs on the
// activity (Node) side, so value imports of the V1 runtime are allowed.

import type { PatchOp, SessionState } from '@reelmakeeasy/uip-planner-runtime'
import type {
  BrandBriefSubmitSignalPayload,
  ConfirmBrandReviewSignalPayload,
} from '@reelmakeeasy/uip-planner-runtime'
import { applyPatch } from '@reelmakeeasy/uip-planner-runtime'
// Deep imports (pure helpers, not in the barrel's mocked surface): the URL
// detection + normalization the v1 runtime auto-start uses, reused verbatim.
import { normalizeBrandUrl } from '@reelmakeeasy/uip-planner-runtime/patch-apply'
import { detectBrandAutoStartUrl } from '@reelmakeeasy/uip-planner-runtime/runtime/auto-brand-extraction'

import type { BrandExtractionReadySignalPayload } from '../../workflows/uip-v2/signal-payloads'
import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { buildBrandExtractionOps } from './apply-brand-extraction-patch'
import { brandBankEditPayloadToPatchOp } from './run-planner-turn-brand-signals'
import { foldSession } from './session-state'
import { resolveSpecCheckpoint } from './spec-checkpoint'

/** One brand machine / user action to translate into named PatchOps. */
export interface ApplyBrandPatchInput {
  action: BrandPatchAction
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
}

export interface ApplyBrandPatchResult {
  // article_probe only: the first URL detected in the user's
  // messages, normalized. Rides on this activity's result (never as ops --
  // article extraction has no spec field) so the news-door trigger reuses the
  // exact v1 detector + normalizer without a new activity type.
  articleUrl?: string
  // Post-apply spec.global_constraints.brand_video_type (only set on ok). The
  // v2 null-shape defer at MODE_CONFIRMED reads it: null means the carried
  // source predates the shape field and the planner owes the 2.6.5 ask.
  brandVideoTypeAfter?: null | string
  ok: boolean
  ops: PatchOp[]
  specVersionAfter: number
}

export type BrandPatchAction =
  | { brief: BrandBriefSubmitSignalPayload; kind: 'brief' } // C2 fix: brandBriefSubmit ops
  | { confirm: ConfirmBrandReviewSignalPayload; kind: 'confirm' }
  | { kind: 'article_probe' } // News-door URL detection only (no ops); result rides ApplyBrandPatchResult.articleUrl
  | { kind: 'auto_start' } // v2 parity for v1's runtime URL auto-start
  | { kind: 'carry_fallback' } // Carry-by-default at MODE_CONFIRMED
  | { kind: 'failed'; reason: string }
  // Fold the user's init-prompt uploads into a reused saved brief's
  // bank (no extraction child runs on that path, so the fresh fold never fires).
  | { kind: 'fold_uploads' }
  | { kind: 'ready'; ready: BrandExtractionReadySignalPayload }
  // v2 parity for v1's re-extraction re-fire (change_brand_extraction_source
  // / retry). Lowers brand_reextraction_pending + stamps the new run.
  | { kind: 'reextraction_started'; runId: string; startedAt: string }
  | { kind: 'started'; runId: string; startedAt: string }

export async function applyBrandPatchActivity(
  input: ApplyBrandPatchInput,
): Promise<ApplyBrandPatchResult> {
  const { events } = input
  const checkpointSpec = await resolveSpecCheckpoint(events)
  const session = foldSession(events, input.currentArtifacts, checkpointSpec)
  const baseVersion = session.spec.meta.spec_version
  // article_probe: URL detection only, no ops and no spec write.
  // Same detector + normalizer as the brand auto_start so the two doors can
  // never disagree about what counts as a pasted URL.
  if (input.action.kind === 'article_probe') {
    const detected = detectBrandAutoStartUrl(session.transcript)
    const url = detected == null ? null : normalizeBrandUrl(detected)
    return {
      ok: false,
      ops: [],
      specVersionAfter: baseVersion,
      ...(url ? { articleUrl: url } : {}),
    }
  }
  const ops = await buildOps(input.action, session as SessionState)
  if (ops.length === 0) {
    return { ok: false, ops: [], specVersionAfter: baseVersion }
  }

  // applyPatch enforces the brand status/phase preconditions (null->pending->
  // completed->locked; update_brand_bank_field requires completed+brand_review+
  // !locked, etc). A rejected patch is a no-op -- return ok:false so the workflow
  // appends nothing.
  const result = applyPatch(
    session.spec,
    { base_version: baseVersion, diff_summary: `brand.${input.action.kind}`, ops },
    {
      phase: session.todo_state?.phase,
      transitionVideoModel: session.transitionVideoModel,
    },
  )
  if (result.error) {
    return { ok: false, ops: [], specVersionAfter: baseVersion }
  }
  return {
    brandVideoTypeAfter: result.spec.global_constraints?.brand_video_type ?? null,
    ok: true,
    ops,
    specVersionAfter: result.spec.meta.spec_version,
  }
}

async function buildOps(action: BrandPatchAction, session: SessionState): Promise<PatchOp[]> {
  switch (action.kind) {
    case 'article_probe': {
      // Handled entirely in applyBrandPatchActivity (URL detection, no ops);
      // defensive no-op here so a future refactor can't fall through.
      return []
    }
    case 'auto_start': {
      // V1 parity (maybeAutoStartBrandExtractionFromPrompt): the
      // RUNTIME -- never the planner -- sets brand_extraction_input from a URL
      // in the user's messages. Idempotent: no-op once input or status is set.
      const constraints = session.spec.global_constraints
      if (
        constraints.brand_extraction_input != null ||
        constraints.brand_extraction_status != null ||
        // User detached an injected saved brief with "remove the brand brief":
        // no brand this session, so a brand URL still in the prompt
        // must not re-trigger extraction. Mirrors the v1 guard.
        constraints.brand_extraction_declined === true
      ) {
        return []
      }
      const detected = detectBrandAutoStartUrl(session.transcript)
      // Normalize HERE, not just in patch-apply: the op payload in the event
      // log is what latestBrandInput hands to the BrandExtractionWorkflow
      // child (the workflow reads the LOG op, not the normalized spec), and a
      // bare domain crashes new URL() in crawl-brand-site. A null normalize
      // (invalid URL) is a no-op, mirroring v1's reject-then-Stage-1 behavior.
      const url = detected == null ? null : normalizeBrandUrl(detected)
      if (url == null) {
        return []
      }
      // Same-source re-paste is a REUSE, not a change: emit the
      // carry apply directly so the op-shape folds (hasBrandInput/brandStatus)
      // stay truthful -- patch-apply would convert a same-URL set anyway, but
      // the event log must record what actually happened.
      const carry = constraints.brand_carry_state
      if (
        carry?.status === 'pending' &&
        carry.source_brand_extraction_input.kind === 'url' &&
        carry.source_brand_extraction_input.url === url
      ) {
        return [{ op: 'apply_brand_carry' }]
      }
      return [{ input: { kind: 'url', url }, op: 'set_brand_extraction_input' }]
    }
    case 'brief': {
      // C2 fix: apply the brand brief submission as a named op (mirrors V1
      // applyBrandBriefSubmit in run-planner-turn-brand-signals.ts). Sets
      // brand_extraction_input so the planner sees it and the auto-start guard
      // (maybeStartBrandChild) can fire once extraction_status is still null.
      // patch-apply enforces BRAND_INPUT_FROZEN once status != null, so this
      // is idempotent if the brief was somehow applied twice.
      // Note: uploaded assets are recorded on the session via uploaded_assets
      // (separate path); the brand-extraction child will pick them up during
      // synthesis. We do not emit add_brand_asset ops here because those are
      // for staged assets produced by the crawler, not raw user uploads.
      return [{ input: action.brief.input, op: 'set_brand_extraction_input' }]
    }
    case 'carry_fallback': {
      // V1 parity (applyCarryByDefaultFallback): MODE_CONFIRMED arrived with
      // the carry still pending -- apply it deterministically (PM default:
      // same brand). Preconditions mirror the v1 interceptor; applyPatch
      // enforces the spec-level guards again. via 'fallback' keeps the
      // applied_via attribution honest (the planner op path folds as 'op').
      const constraints = session.spec.global_constraints
      if (
        constraints.brand_carry_state?.status !== 'pending' ||
        constraints.brand_extraction_input != null ||
        constraints.brand_extraction_status != null
      ) {
        return []
      }
      return [{ op: 'apply_brand_carry', via: 'fallback' }]
    }
    case 'confirm': {
      const editOps = (action.confirm.edits ?? []).map((edit) =>
        brandBankEditPayloadToPatchOp(edit, session.sessionId),
      )
      const directiveOps: PatchOp[] =
        action.confirm.styleDirective === undefined
          ? []
          : [
              {
                op: 'update_global_field',
                path: 'brand_style_directive',
                value: action.confirm.styleDirective,
              },
            ]
      // Previewed style text + preview URL ride the same atomic confirm patch
      // (mirrors V1 _applyConfirmBrandReview): the text locks in the exact
      // previewed look for bootstrap_script, the URL lets the brand card
      // re-render the two-up after the bank locks.
      const styleTextOps: PatchOp[] = action.confirm.brandStyleText
        ? [
            {
              op: 'update_global_field',
              path: 'brand_style_text',
              value: action.confirm.brandStyleText,
            },
          ]
        : []
      const previewUrlOps: PatchOp[] = action.confirm.brandStylePreviewUrl
        ? [
            {
              op: 'update_global_field',
              path: 'brand_style_preview_url',
              value: action.confirm.brandStylePreviewUrl,
            },
          ]
        : []
      return [
        ...directiveOps,
        ...styleTextOps,
        ...previewUrlOps,
        ...editOps,
        { op: 'lock_brand_bank', locked_at: new Date().toISOString() },
      ]
    }
    case 'failed': {
      return buildBrandExtractionOps('failed', { failureReason: action.reason }, session)
    }
    case 'fold_uploads': {
      // Emits add_brand_asset ops for the init-prompt uploads (user_upload).
      // applyPatch enforces assertNotLocked; on a seeded editable review the
      // bank is completed + unlocked, so the ops apply.
      return buildBrandExtractionOps('fold_uploads', {}, session)
    }
    case 'ready': {
      // Reuses the shared V1 op-builder, which now folds init uploads + dedupes
      // brand-asset candidates (it needs the session for that); the
      // seed_brand_synthesis + add_brand_asset ops are what the review card renders.
      return buildBrandExtractionOps(
        'ready',
        {
          assetDescriptions: action.ready.assetDescriptions,
          bankWithoutAssets: action.ready.bankWithoutAssets,
          stagedAssetCandidates: action.ready.stagedAssetCandidates,
        },
        session,
      )
    }
    case 'reextraction_started': {
      return buildBrandExtractionOps(
        'reextraction_started',
        {
          runId: action.runId,
          startedAt: action.startedAt,
        },
        session,
      )
    }
    case 'started': {
      return buildBrandExtractionOps(
        'started',
        {
          runId: action.runId,
          startedAt: action.startedAt,
        },
        session,
      )
    }
  }
}
