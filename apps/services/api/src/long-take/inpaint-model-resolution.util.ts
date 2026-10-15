// Resolves which model family regenerates an inpaint edit, from the SOURCE VIDEO's
// recorded provenance rather than the live org/session state. A project rendered on
// Seedance 2.5 (merged-transition clips up to 30s) must keep regenerating on 2.5 so the
// edit follows the model that produced the footage instead of silently downgrading.

import { INPAINT_FAMILY_SUPPORTS_V2V_REF } from '@reelmakeeasy/common/inpaint/call-type'
import type { EditPlanCase } from '@reelmakeeasy/common/inpaint/edit-plan-case'
import type { InpaintModelFamily } from '@reelmakeeasy/common/inpaint/types'
import {
  isSeedance2Model,
  isSeedance25Model,
  SEEDANCE_2_TRANSITION_VIDEO_MODEL,
} from '@reelmakeeasy/common/veo3/model'
import { getVideoModelFallbackChain } from '@reelmakeeasy/common/veo3/video-model-selection'
import { DEFAULT_INPAINT_MODEL_FAMILY } from '@reelmakeeasy/common/video-models/inpaint'
import type { DebugSettings } from '@shared/types/project/debug-settings'

const SEEDANCE_1_5_MODEL_ID = 'seedance-1-5-pro-251215'
const DEFAULT_MODEL_FAMILY: InpaintModelFamily = DEFAULT_INPAINT_MODEL_FAMILY

export type ResolvedInpaintModel = { modelFamily: InpaintModelFamily; modelId: string }

function familyForModelId(modelId: string): InpaintModelFamily | undefined {
  if (isSeedance25Model(modelId)) {
    return 'seedance-2-5'
  }
  if (isSeedance2Model(modelId)) {
    return 'seedance-2-0'
  }
  if (modelId === SEEDANCE_1_5_MODEL_ID) {
    return 'seedance-1-5'
  }
  return undefined
}

// A family fits only if it takes a v2v reference clip at all. Clip LENGTH is not a
// criterion: the editor speeds an over-ceiling reference up to the model's ceiling
// before sending it, so a long clip no longer rules a family out.
function fits(family: InpaintModelFamily): boolean {
  return INPAINT_FAMILY_SUPPORTS_V2V_REF[family]
}

/**
 * Provenance-only resolution, with no duration to check against: this runs at edit
 * creation, before any clip length exists to gate on. Never throws -- a project with no
 * recorded or recognized provenance simply gets the legacy default.
 *
 * A reference-incapable provenance family also gets the default. It is the same
 * rejection resolveInpaintModel makes, applied here so plan-time and charge-time agree
 * on one family: returning it would plan case4 against a family generation can never
 * run, which is exactly the divergence this exists to prevent.
 */
/**
 * Raw recorded provenance, for observability ONLY -- never for routing.
 *
 * Deliberately NOT resolveInpaintProvenanceFamily: that one collapses a
 * reference-incapable family (e.g. seedance-1-5) to DEFAULT_MODEL_FAMILY so plan-time
 * and run-time agree. Reusing it here would report every 1.5-sourced edit as 2.0 and
 * make the reroute -- most projects, at a higher cost -- invisible in
 * analytics. 'none' covers absent and unrecognized provenance.
 */
export function recordedInpaintFamily(debugSettings: DebugSettings): string {
  const recordedModelId = debugSettings.transitionVideoModel
  return (recordedModelId ? familyForModelId(recordedModelId) : undefined) ?? 'none'
}

export function resolveInpaintProvenanceFamily(debugSettings: DebugSettings): InpaintModelFamily {
  const recordedModelId = debugSettings.transitionVideoModel
  const recordedFamily = recordedModelId ? familyForModelId(recordedModelId) : undefined
  if (!recordedFamily || !INPAINT_FAMILY_SUPPORTS_V2V_REF[recordedFamily]) {
    return DEFAULT_MODEL_FAMILY
  }
  return recordedFamily
}

/**
 * Resolution order:
 *   a) the family the source video was actually rendered with (debugSettings.transitionVideoModel)
 *   b) a fallback candidate from the recorded model's config fallbackChain
 *   c) the hardcoded default 'seedance-2-0' (today's behavior for provenance-less projects)
 *
 * Each candidate is accepted only if it takes a v2v reference clip at all. `_planCase`
 * used to gate on the plan's longest clip; the editor now speeds an over-ceiling
 * reference down to the model's ceiling, so length no longer excludes a family. It stays
 * in the signature for the v1 caller in resolvePlanModel (inpaint-plan-charge.util.ts),
 * as does `_orgId`.
 *
 * Deliberately does NOT call validateVideoModelId / passesVideoModelRequiredGate: those
 * validate a LIVE user selection against the org's current entitlement and fail closed to
 * the config default, which would silently move a 2.5 project back to 2.0 the moment the
 * org loses access to 2.5 -- recreating the bug. An edit on an existing video
 * follows the model that produced it regardless of current entitlement (explicit product
 * decision).
 */
export function resolveInpaintModel(
  debugSettings: DebugSettings,
  _orgId: string,
  _planCase?: EditPlanCase,
): ResolvedInpaintModel {
  const recordedModelId = debugSettings.transitionVideoModel
  const recordedFamily = recordedModelId ? familyForModelId(recordedModelId) : undefined
  if (recordedModelId && recordedFamily && fits(recordedFamily)) {
    return { modelFamily: recordedFamily, modelId: recordedModelId }
  }
  if (recordedModelId) {
    for (const fallbackId of getVideoModelFallbackChain(recordedModelId)) {
      const fallbackFamily = familyForModelId(fallbackId)
      if (fallbackFamily && fits(fallbackFamily)) {
        return { modelFamily: fallbackFamily, modelId: fallbackId }
      }
    }
  }
  return { modelFamily: DEFAULT_MODEL_FAMILY, modelId: SEEDANCE_2_TRANSITION_VIDEO_MODEL }
}
