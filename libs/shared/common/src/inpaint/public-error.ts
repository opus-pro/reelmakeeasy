import type { PublicRunError } from './public-state'
import type { SerializedError } from './task-types'

// Generic user-facing copy for EDIT_NOT_APPLIED. The specific judge reason (when
// available) is delivered separately on PublicRunError.reason.
export const EDIT_NOT_APPLIED_GENERIC_MESSAGE =
  'The edit did not take effect - you were not charged.'

// Follow-up copy for EDIT_NOT_APPLIED, rendered under the reason: the judge now rejects
// edits whose text does not hold across the clip, which baked-in text cannot satisfy.
export const EDIT_NOT_APPLIED_KEYFRAME_HINT =
  'If the text is baked into the footage, edit the keyframe instead of the clip.'

// User-facing copy for ANCHOR_EDIT_NOT_APPLIED, mirroring the throw in edit-gen-run.ts.
export const ANCHOR_EDIT_NOT_APPLIED_MESSAGE =
  'The edit did not change the keyframe - you were not charged.'

// Generic user-facing copy for REFERENCE_CLIP_TOO_LONG. The specific durationSec/maxSec
// (when available) is delivered separately on PublicRunError.reason.
export const REFERENCE_CLIP_TOO_LONG_MESSAGE =
  'This edit needs a reference clip longer than this model accepts. Shorten the edit range and try again.'

// Generic user-facing copy for CLIP_TOO_SHORT_FOR_ANCHOR. The specific
// durationSec/minSec (when available) is delivered separately on PublicRunError.reason.
export const CLIP_TOO_SHORT_FOR_ANCHOR_MESSAGE =
  'This clip is too short for this model to apply your edit at the very start or end of it - you were not charged. Choose a different frame or use a longer clip.'

// User-facing copy for an anchor generation content refusal (blocked_* category or a
// safety/prohibited finishReason).
export const ANCHOR_GENERATION_BLOCKED_MESSAGE =
  'This edit was blocked by content filters. Change the prompt and try again.'

// User-facing copy for an anchor generation that produced no image (NO_IMAGE/STOP
// finishReason, or infra_model -- the model returned nothing, same user-visible event).
export const ANCHOR_GENERATION_NO_IMAGE_MESSAGE =
  'The model could not produce an edit for this frame. Reword the prompt and try again.'

// Generic user-facing copy for an ANCHOR_GENERATION_FAILED whose details are missing or
// unrecognized. Still non-retryable: the throw site already proved the failure is permanent.
export const ANCHOR_GENERATION_FAILED_GENERIC_MESSAGE = 'The keyframe edit could not be generated.'

// Business-safe error metadata keyed by the normalized internal error type.
// `nonRetryable` is intentionally explicit per error type: the engine may fail an
// activity fast for operational reasons that should still allow a user retry.
const PUBLIC_ERROR_BY_TYPE: Record<string, PublicRunError> = {
  ANCHOR_EDIT_NOT_APPLIED: {
    code: 'anchor_edit_not_applied',
    message: ANCHOR_EDIT_NOT_APPLIED_MESSAGE,
    nonRetryable: true,
  },
  ANCHOR_GENERATION_FAILED: {
    message: ANCHOR_GENERATION_FAILED_GENERIC_MESSAGE,
    nonRetryable: true,
  },
  CIRCUIT_BREAKER_OPEN: { message: 'Generation service unavailable' },
  CLIP_TOO_SHORT_FOR_ANCHOR: {
    message: CLIP_TOO_SHORT_FOR_ANCHOR_MESSAGE,
    nonRetryable: true,
  },
  EDIT_NOT_APPLIED: {
    code: 'edit_not_applied',
    message: EDIT_NOT_APPLIED_GENERIC_MESSAGE,
    nonRetryable: true,
  },
  // Auth/outage failures are ours, not the user's, and may clear on their own -- retryable.
  FAL_AUTH_ERROR: { message: 'Generation service unavailable' },
  // The fal-side equivalent of PROVIDER_INVALID_INPUT: a permanently invalid 422 payload.
  FAL_VALIDATION_ERROR: {
    message: 'The provider rejected this edit. Change the edit and try again.',
    nonRetryable: true,
  },
  GENERATION_FAILED: { message: 'Video generation failed' },
  POLICY_BLOCKED: {
    code: 'content_policy_blocked',
    message: 'Content blocked by provider policy',
    nonRetryable: true,
  },
  PROVIDER_AUTH_ERROR: { message: 'Generation service unavailable' },
  PROVIDER_INVALID_INPUT: {
    message: 'The provider rejected this edit. Change the edit and try again.',
    nonRetryable: true,
  },
  REFERENCE_CLIP_TOO_LONG: {
    message: REFERENCE_CLIP_TOO_LONG_MESSAGE,
    nonRetryable: true,
  },
  // A poisoned reference asset the provider cannot fetch. User-retryable (the fetch can
  // clear), but coded so the editor can keep it out of the paid-escalation offer: a
  // stronger model reads the same unreachable asset. Message matches the generic
  // fallback of every record this can surface on, so the copy is unchanged.
  REFERENCE_FETCH_FAILED: { code: 'reference_fetch_failed', message: 'Video generation failed' },
  // A moderation verdict on the submitted content: re-running the same prompt is
  // blocked again, so the user has to change the edit rather than retry.
  SAFETY_BLOCK: { message: 'Content blocked by safety filters', nonRetryable: true },
}

// Exhaustive public mappings for Ark's currently documented moderation codes.
// Keep this exact rather than pattern-based: an unknown qualifier must not be
// presented to users as a known reason. Source:
// https://docs.byteplus.com/en/docs/ModelArk/1299023
const PUBLIC_ERROR_BY_ARK_CODE: Readonly<Record<string, PublicRunError>> = {
  SensitiveContentDetected: {
    code: 'input_text_sensitive_content',
    message: 'The prompt may contain sensitive content. Change it and try again.',
    nonRetryable: true,
  },
  InputTextSensitiveContentDetected: {
    code: 'input_text_sensitive_content',
    message: 'The prompt may contain sensitive content. Change it and try again.',
    nonRetryable: true,
  },
  InputImageSensitiveContentDetected: {
    code: 'input_image_sensitive_content',
    message: 'The input image may contain sensitive content. Replace it and try again.',
    nonRetryable: true,
  },
  InputVideoSensitiveContentDetected: {
    code: 'input_video_sensitive_content',
    message: 'The input video may contain sensitive content. Replace it and try again.',
    nonRetryable: true,
  },
  InputAudioSensitiveContentDetected: {
    code: 'input_audio_sensitive_content',
    message: 'The input audio may contain sensitive content. Replace it and try again.',
    nonRetryable: true,
  },
  OutputTextSensitiveContentDetected: {
    code: 'output_text_sensitive_content',
    message: 'The generated text may contain sensitive content. Change the input and try again.',
    nonRetryable: true,
  },
  OutputImageSensitiveContentDetected: {
    code: 'output_image_sensitive_content',
    message: 'The generated image may contain sensitive content. Change the input and try again.',
    nonRetryable: true,
  },
  OutputVideoSensitiveContentDetected: {
    code: 'output_video_sensitive_content',
    message: 'The generated video may contain sensitive content. Change the input and try again.',
    nonRetryable: true,
  },
  OutputAudioSensitiveContentDetected: {
    code: 'output_audio_sensitive_content',
    message: 'The generated audio may contain sensitive content. Change the input and try again.',
    nonRetryable: true,
  },
  'InputTextSensitiveContentDetected.PolicyViolation': {
    code: 'input_text_copyright',
    message: 'The prompt may include copyrighted material. Change it and try again.',
    nonRetryable: true,
  },
  'InputImageSensitiveContentDetected.PolicyViolation': {
    code: 'input_image_copyright',
    message: 'The input image may include copyrighted material. Replace it and try again.',
    nonRetryable: true,
  },
  'InputVideoSensitiveContentDetected.PolicyViolation': {
    code: 'input_video_copyright',
    message: 'The input video may include copyrighted material. Replace it and try again.',
    nonRetryable: true,
  },
  'InputAudioSensitiveContentDetected.PolicyViolation': {
    code: 'input_audio_copyright',
    message: 'The input audio may include copyrighted material. Replace it and try again.',
    nonRetryable: true,
  },
  'OutputVideoSensitiveContentDetected.PolicyViolation': {
    code: 'output_video_copyright',
    message:
      'The generated video may include copyrighted material. Change the input and try again.',
    nonRetryable: true,
  },
  'OutputAudioSensitiveContentDetected.PolicyViolation': {
    code: 'output_audio_copyright',
    message:
      'The generated audio may include copyrighted material. Change the input and try again.',
    nonRetryable: true,
  },
  'InputImageSensitiveContentDetected.PrivacyInformation': {
    code: 'input_image_real_person',
    message: 'The input image may contain a real person. Replace it and try again.',
    nonRetryable: true,
  },
  'InputVideoSensitiveContentDetected.PrivacyInformation': {
    code: 'input_video_real_person',
    message: 'The input video may contain a real person. Replace it and try again.',
    nonRetryable: true,
  },
  'OutputImageSensitiveContentDetected.DeepFake': {
    code: 'output_image_counterfeit_document',
    message:
      'The generated image may contain counterfeit documents or credentials. Change the input and try again.',
    nonRetryable: true,
  },
}

export function publicErrorFromArkErrorCode(rawProviderCode: string): PublicRunError | undefined {
  return PUBLIC_ERROR_BY_ARK_CODE[rawProviderCode]
}

// Detail attached to an EDIT_NOT_APPLIED failure by the gen workflow, carrying the
// judge verdict that rejected the last candidate. Written and read here so the two
// sides of the contract cannot drift.
const EDIT_NOT_APPLIED_DETAIL_KIND = 'edit_not_applied'

export function editNotAppliedDetail(
  judgeReason: string,
  failedCheck?: string,
  anchorFailureKind?: string,
  genMode?: string,
): Record<string, string> {
  return {
    judgeReason,
    kind: EDIT_NOT_APPLIED_DETAIL_KIND,
    ...(failedCheck === undefined ? {} : { failedCheck }),
    ...(anchorFailureKind === undefined ? {} : { anchorFailureKind }),
    ...(genMode === undefined ? {} : { genMode }),
  }
}

// The failing check, for analytics. Its sibling judgeReason stays out of any event:
// the check is a four-value enum, the reason is unbounded model-authored text.
export function failedCheckFromDetails(error: {
  readonly details?: null | readonly unknown[]
}): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== EDIT_NOT_APPLIED_DETAIL_KIND) {
      continue
    }
    const failedCheck = fields['failedCheck']
    return typeof failedCheck === 'string' ? failedCheck : undefined
  }
  return undefined
}

// Why the anchor check rejected the edit, for analytics. Absent on a failure that never
// reached the judge.
export function anchorFailureKindFromDetails(error: {
  readonly details?: null | readonly unknown[]
}): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== EDIT_NOT_APPLIED_DETAIL_KIND) {
      continue
    }
    const anchorFailureKind = fields['anchorFailureKind']
    return typeof anchorFailureKind === 'string' ? anchorFailureKind : undefined
  }
  return undefined
}

// Which generation mode produced the rejected clip, for analytics.
export function genModeFromDetails(error: {
  readonly details?: null | readonly unknown[]
}): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== EDIT_NOT_APPLIED_DETAIL_KIND) {
      continue
    }
    const genMode = fields['genMode']
    return typeof genMode === 'string' ? genMode : undefined
  }
  return undefined
}

// Detail attached to a failure that happened after paid segment generation, carrying
// the spend the attempt had already incurred. Written and read here so the two sides of
// the contract cannot drift.
const GEN_COST_DETAIL_KIND = 'gen_cost'

export function costUsdFromDetails(error: {
  readonly details?: null | readonly unknown[]
}): number | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== GEN_COST_DETAIL_KIND) {
      continue
    }
    const costUsd = fields['costUsd']
    return typeof costUsd === 'number' ? costUsd : undefined
  }
  return undefined
}

export function genCostDetail(costUsd: number): Record<string, number | string> {
  return { costUsd, kind: GEN_COST_DETAIL_KIND }
}

// Detail attached to a REFERENCE_CLIP_TOO_LONG failure, carrying the measured reference
// clip duration and the model's ceiling. Written and read here so the two sides of the
// contract cannot drift.
const REF_CEILING_DETAIL_KIND = 'reference_clip_too_long'

export function refCeilingDetail(
  durationSec: number,
  maxSec: number,
): Record<string, number | string> {
  return { durationSec, kind: REF_CEILING_DETAIL_KIND, maxSec }
}

// Detail attached to a CLIP_TOO_SHORT_FOR_ANCHOR failure, carrying the measured clip
// duration and the model's minimum. Written and read here so the two sides of the
// contract cannot drift.
const ANCHOR_DROPPED_DETAIL_KIND = 'clip_too_short_for_anchor'

export function anchorDroppedDetail(
  durationSec: number,
  minSec: number,
): Record<string, number | string> {
  return { durationSec, kind: ANCHOR_DROPPED_DETAIL_KIND, minSec }
}

// Detail attached to an ANCHOR_GENERATION_FAILED failure, carrying the classifier
// category and (when present) the provider finishReason. Written and read here so
// the two sides of the contract cannot drift.
const ANCHOR_GENERATION_DETAIL_KIND = 'anchor_generation_failed'

export function anchorGenerationDetail(
  category: string,
  finishReason?: string,
): Record<string, string> {
  return {
    category,
    kind: ANCHOR_GENERATION_DETAIL_KIND,
    ...(finishReason === undefined ? {} : { finishReason }),
  }
}

// The judge reason is model-authored free text, so normalize before it can reach a
// browser: single-line and length-capped. Not an escaping concern (React escapes),
// but an unbounded multi-line string is not renderable in an error tile.
const MAX_REASON_LENGTH = 240

function anchorDroppedReasonFromDetails(error: SerializedError): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== ANCHOR_DROPPED_DETAIL_KIND) {
      continue
    }
    const durationSec = fields['durationSec']
    const minSec = fields['minSec']
    // Both fields must be finite numbers. A malformed detail must degrade to the
    // generic message, never render "undefineds" into the composed sentence.
    if (
      typeof durationSec !== 'number' ||
      !Number.isFinite(durationSec) ||
      typeof minSec !== 'number' ||
      !Number.isFinite(minSec)
    ) {
      return undefined
    }
    return `Clip is ${durationSec.toFixed(1)}s, shorter than the ${minSec}s this model needs to apply an edit at the start or end of the clip.`
  }
  return undefined
}

function judgeReasonFromDetails(error: SerializedError): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== EDIT_NOT_APPLIED_DETAIL_KIND) {
      continue
    }
    const judgeReason = fields['judgeReason']
    if (typeof judgeReason === 'string') {
      return sanitizeReason(judgeReason)
    }
  }
  return undefined
}

function rawProviderCodeFromDetails(error: SerializedError): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (
      fields['kind'] !== 'provider_error' ||
      (fields['providerCode'] !== 'policy_blocked' &&
        fields['providerCode'] !== 'policy_blocked_image')
    ) {
      continue
    }
    const rawProviderCode = fields['rawProviderCode']
    if (typeof rawProviderCode === 'string') {
      return rawProviderCode
    }
  }
  return undefined
}

function refCeilingReasonFromDetails(error: SerializedError): string | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    if (fields['kind'] !== REF_CEILING_DETAIL_KIND) {
      continue
    }
    const durationSec = fields['durationSec']
    const maxSec = fields['maxSec']
    // Both fields must be finite numbers -- a malformed detail must degrade to the
    // generic message, never render "undefineds" into the composed sentence.
    if (
      typeof durationSec !== 'number' ||
      !Number.isFinite(durationSec) ||
      typeof maxSec !== 'number' ||
      !Number.isFinite(maxSec)
    ) {
      return undefined
    }
    return `Reference clip is ${durationSec.toFixed(1)}s, longer than the ${maxSec}s maximum this model accepts.`
  }
  return undefined
}

// Content refusal takes precedence over "no image produced" when a payload matches
// both, since a blocked_* category can still carry a NO_IMAGE/STOP finishReason.
function anchorGenerationErrorFromDetails(error: SerializedError): PublicRunError | undefined {
  for (const detail of error.details ?? []) {
    if (!detail || typeof detail !== 'object') {
      continue
    }
    const fields = detail as Record<string, unknown>
    // Runs that failed before the detail carried a `kind` persisted an untagged
    // { category, finishReason } in workflow state, and that state outlives the
    // deploy -- accept it so those keep their specific copy. Safe to admit an
    // untagged detail here: the caller already gated on ANCHOR_GENERATION_FAILED,
    // whose throw site attaches no other detail.
    if (fields['kind'] !== undefined && fields['kind'] !== ANCHOR_GENERATION_DETAIL_KIND) {
      continue
    }
    const category = fields['category']
    const finishReason = fields['finishReason']
    if (typeof category !== 'string') {
      continue
    }
    if (
      category.startsWith('blocked_') ||
      finishReason === 'IMAGE_SAFETY' ||
      finishReason === 'PROHIBITED_CONTENT'
    ) {
      return {
        code: 'anchor_generation_blocked',
        message: ANCHOR_GENERATION_BLOCKED_MESSAGE,
        nonRetryable: true,
      }
    }
    if (finishReason === 'NO_IMAGE' || finishReason === 'STOP' || category === 'infra_model') {
      return {
        code: 'anchor_generation_no_image',
        message: ANCHOR_GENERATION_NO_IMAGE_MESSAGE,
        nonRetryable: true,
      }
    }
  }
  return undefined
}

function sanitizeReason(reason: string): string | undefined {
  const collapsed = reason.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return undefined
  }
  return collapsed.length > MAX_REASON_LENGTH
    ? `${collapsed.slice(0, MAX_REASON_LENGTH - 3)}...`
    : collapsed
}

// Project an internal error to the client-safe business contract. Unknown errors
// use the task-level fallback; raw provider text and details never reach the browser.
export function toPublicRunError(error: SerializedError, fallbackMessage: string): PublicRunError {
  if (error.type === 'EDIT_NOT_APPLIED') {
    const base = PUBLIC_ERROR_BY_TYPE['EDIT_NOT_APPLIED']
    const reason = judgeReasonFromDetails(error)
    return reason ? { ...base, reason } : base
  }
  if (error.type === 'REFERENCE_CLIP_TOO_LONG') {
    const base = PUBLIC_ERROR_BY_TYPE['REFERENCE_CLIP_TOO_LONG']
    const reason = refCeilingReasonFromDetails(error)
    return reason ? { ...base, reason } : base
  }
  if (error.type === 'CLIP_TOO_SHORT_FOR_ANCHOR') {
    const base = PUBLIC_ERROR_BY_TYPE['CLIP_TOO_SHORT_FOR_ANCHOR']
    const reason = anchorDroppedReasonFromDetails(error)
    return reason ? { ...base, reason } : base
  }
  if (error.type === 'POLICY_BLOCKED') {
    const rawProviderCode = rawProviderCodeFromDetails(error)
    const arkError = rawProviderCode && publicErrorFromArkErrorCode(rawProviderCode)
    return arkError || PUBLIC_ERROR_BY_TYPE['POLICY_BLOCKED']
  }
  if (error.type === 'ANCHOR_GENERATION_FAILED') {
    return (
      anchorGenerationErrorFromDetails(error) ?? PUBLIC_ERROR_BY_TYPE['ANCHOR_GENERATION_FAILED']
    )
  }
  return (error.type && PUBLIC_ERROR_BY_TYPE[error.type]) || { message: fallbackMessage }
}
