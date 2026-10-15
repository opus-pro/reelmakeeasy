import { isSeedanceModel } from './bytedance'
import { VIDEO_MODEL_CAPABILITIES, type VideoGenModel } from './capabilities'
import type { ModelCapabilities } from './types'

/**
 * The inpaint model families the editor can route an edit to. A family is a
 * user-facing choice; each one resolves to a concrete v2v and i2v model below.
 */
export type InpaintFamilyModels = {
  i2v: VideoGenModel
  v2v: VideoGenModel
}

export type InpaintModelFamily = 'kling-o3-pro' | 'seedance-1-5' | 'seedance-2-0' | 'seedance-2-5'

export const INPAINT_FAMILY_MODELS = {
  'kling-o3-pro': { v2v: 'kling-o3-pro-v2v', i2v: 'kling-o3-pro-i2v' },
  'seedance-1-5': { v2v: 'seedance-1-5-pro-251215', i2v: 'seedance-1-5-pro-251215' },
  'seedance-2-0': { v2v: 'dreamina-seedance-2-0-260128', i2v: 'dreamina-seedance-2-0-260128' },
  'seedance-2-5': { v2v: 'dreamina-seedance-2-5-260628', i2v: 'dreamina-seedance-2-5-260628' },
} as const satisfies Record<InpaintModelFamily, InpaintFamilyModels>

export const ALL_INPAINT_MODEL_FAMILIES: readonly InpaintModelFamily[] = Object.keys(
  INPAINT_FAMILY_MODELS,
) as InpaintModelFamily[]

/**
 * Legacy default for provenance-less projects (no recorded transitionVideoModel), and
 * the fallback for plan/gen task args persisted before the family was threaded through
 * them.
 */
export const DEFAULT_INPAINT_MODEL_FAMILY: InpaintModelFamily = 'seedance-2-0'

/**
 * The family a failed shot's final retry can be escalated onto, as a paid choice, when
 * the source video's own provenance is weaker than it.
 */
export const INPAINT_ESCALATION_MODEL_FAMILY = 'seedance-2-5' satisfies InpaintModelFamily

/**
 * Max generation duration the model will accept, per family and call type.
 *
 * For v2v, clips longer than this stay v2v: generation is capped at this
 * duration and the output is slowed back down in post (see resolveSpeed /
 * postProcessVideoActivity), matching the Python reference. Only clips shorter
 * than the family's v2v reference minimum fall back to i2v.
 *
 * Declared, NOT derived from each model's `durationsSec`. Three of the four
 * families happen to match their model's ceiling, but kling-o3-pro's i2v cap is
 * deliberately 10 while `kling-o3-pro-i2v` itself accepts up to 15 -- deriving
 * would silently raise it. `inpaint.consistency.test.ts` asserts the weaker
 * invariant that actually matters: no family cap may EXCEED what its model
 * accepts (the failure mode).
 */
export const INPAINT_MAX_OUTPUT_DURATION_SEC = {
  'kling-o3-pro': { v2v: 10, i2v: 10 },
  'seedance-1-5': { v2v: 12, i2v: 12 },
  'seedance-2-0': { v2v: 15, i2v: 15 },
  'seedance-2-5': { v2v: 30, i2v: 30 },
} as const satisfies Record<InpaintModelFamily, { i2v: number; v2v: number }>

function familyRecord<T>(pick: (family: InpaintModelFamily) => T): Record<InpaintModelFamily, T> {
  return Object.fromEntries(ALL_INPAINT_MODEL_FAMILIES.map((f) => [f, pick(f)])) as Record<
    InpaintModelFamily,
    T
  >
}

function referenceVideoSec(family: InpaintModelFamily): undefined | { max: number; min: number } {
  const caps: ModelCapabilities = VIDEO_MODEL_CAPABILITIES[INPAINT_FAMILY_MODELS[family].v2v]
  return caps.referenceVideoSec
}

/**
 * True for a family whose v2v model declares a reference-video envelope, i.e. can
 * actually accept a reference clip. False means the family can never run a v2v edit
 * and must be routed to another family before any generation starts -- this is the
 * predicate to check, not a comparison against MIN/MAX_V2V_REF_SEC's sentinels below.
 */
export const INPAINT_FAMILY_SUPPORTS_V2V_REF: Record<InpaintModelFamily, boolean> = familyRecord(
  (f) => referenceVideoSec(f) !== undefined,
)

/**
 * v2v minimum reference video length per family. Below this the reference clip
 * is too short to drive v2v reliably, so the worker falls back to i2v
 * (resolveCallType in apps/services/editor/src/inpaint/segment-params.ts).
 */
export const MIN_V2V_REF_SEC: Record<InpaintModelFamily, number> = familyRecord(
  (f) => referenceVideoSec(f)?.min ?? Number.POSITIVE_INFINITY,
)

/**
 * v2v maximum reference video length per family. The provider rejects a longer
 * reference outright, so an over-length clip can never generate -- this must be
 * checked before any generation starts, not just capped for the output request.
 *
 * This bounds the INPUT reference clip; INPAINT_MAX_OUTPUT_DURATION_SEC bounds
 * the generated OUTPUT. They coincide numerically for every family today but
 * mean different things -- the two stay independently declared and neither is
 * derived from the other. Per-model provenance for each bound is on
 * the model's `referenceVideoSec` row in ./bytedance.ts and ./fal.ts.
 *
 * A family whose v2v model declares no envelope (reference-incapable, e.g.
 * seedance-1-5) gets sentinels that can never admit a clip: MAX 0, MIN
 * +Infinity. This makes every direct MIN/MAX_V2V_REF_SEC consumer fail closed
 * without a type change. Do not compare against these sentinels to detect a
 * reference-incapable family -- use INPAINT_FAMILY_SUPPORTS_V2V_REF instead.
 */
export const MAX_V2V_REF_SEC: Record<InpaintModelFamily, number> = familyRecord(
  (f) => referenceVideoSec(f)?.max ?? 0,
)

/**
 * Aspect ratios accepted by each family, derived from its v2v model. 'adaptive'
 * is dropped: this table lists only concrete ratios, because its consumer
 * (snapAspectRatio) picks the nearest real ratio to the source clip.
 */
export const MODEL_SUPPORTED_ASPECT_RATIOS: Record<InpaintModelFamily, readonly string[]> =
  familyRecord((f) =>
    VIDEO_MODEL_CAPABILITIES[INPAINT_FAMILY_MODELS[f].v2v].aspectRatios.filter(
      (ratio) => ratio !== 'adaptive',
    ),
  )

/**
 * True for every BytePlus-hosted family. Two independent behaviors key off this and
 * must never drift apart from each other or from INPAINT_FAMILY_MODELS above:
 *   1. Inputs must be uploaded and referenced as asset:// URIs (prepareSegmentForActivity);
 *      a raw storage/CDN URL is rejected at the provider call.
 *   2. They share the "motion/camera/timing reference only" prompt style, distinct from
 *      kling's "strict structure, pixel-identical endpoints" style.
 * kling-o3-pro is fal-hosted and takes neither path. Derived from INPAINT_FAMILY_MODELS so
 * adding a family to that table cannot silently leave this behind.
 */
export function isSeedanceInpaintFamily(modelFamily: InpaintModelFamily): boolean {
  return isSeedanceModel(INPAINT_FAMILY_MODELS[modelFamily].v2v)
}
