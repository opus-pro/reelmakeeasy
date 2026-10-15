/**
 * Structured gender resolution + validation for character anchors.
 *
 * Anchor gender used to exist only as free prose inside `visual_reference`
 * and inside the generated `generation_prompt`, so a prompt-spec LLM that
 * emitted the opposite gender -- while asserting in its own rationale that
 * it was complying -- was indistinguishable at runtime from a correct one.
 * Both hops now declare gender as a typed field, and the two
 * are compared by equality here.
 *
 * The comparison is deliberately NOT a text match against
 * `generation_prompt`: "female" contains "male", and a prompt can carry
 * gender through pronouns, "woman", or nothing at all, so prose matching
 * is unreliable in both directions.
 *
 * `'unknown'` is the universal opt-out. It means "do not validate this
 * anchor", never "no gender" -- see `resolveAnchorGender` for the cases
 * that produce it.
 */

import type { VoiceProfileGender } from '@shared/types/api/voice-profile'

import type { AnchorAssetCandidate } from '../anchor-types'

export type AnchorGender = VoiceProfileGender

/**
 * Reserved anchor id for the canonical music-video singer. This anchor
 * carries the sung/rap performance and lip sync, so the uploaded voice --
 * not the brief -- is authoritative for its gender.
 */
export const CANONICAL_SINGER_ANCHOR_ID = 'char_singer'

/**
 * Reserved anchor id for the canonical narrator / main on-screen speaker.
 * This character speaks the voiceover, so when the brief does not otherwise
 * establish a gender the uploaded voice is the best remaining signal for it
 * (a male voiceover was yielding a female narrator).
 */
export const CANONICAL_NARRATOR_ANCHOR_ID = 'char_narrator'

export type AnchorGenderBasis =
  /** Resolved from the asset manager's structured `subject_gender`. */
  | 'candidate'
  /** Not validated; see `ResolvedAnchorGender.reason`. */
  | 'unvalidated'
  /** Resolved from the voice profile's `perceivedGender`. */
  | 'voice'

export interface ResolvedAnchorGender {
  basis: AnchorGenderBasis
  /** `'unknown'` iff `basis` is `'unvalidated'`. */
  gender: AnchorGender
  /** Short machine-readable tag for the log line. */
  reason: string
}

export function isCanonicalSingerAnchor(
  candidate: Pick<AnchorAssetCandidate, 'anchor_id' | 'type'>,
): boolean {
  return candidate.type === 'CHARACTER' && candidate.anchor_id === CANONICAL_SINGER_ANCHOR_ID
}

export function isNarratorAnchor(
  candidate: Pick<AnchorAssetCandidate, 'anchor_id' | 'type'>,
): boolean {
  return candidate.type === 'CHARACTER' && candidate.anchor_id === CANONICAL_NARRATOR_ANCHOR_ID
}

/**
 * Decide the gender a character anchor must be generated as, and whether
 * it can be validated at all.
 *
 * Precedence, highest first:
 *
 *   1. A user edit instruction naming any attribute is a user-authorized
 *      identity override. Its value lives in free prose we cannot resolve
 *      structurally, so validation is disabled rather than guessed at.
 *   2. A bound source image is an identity reference; the photo, not the
 *      brief, decides who this is. Validation disabled.
 *   3. For `char_singer`, the voice profile wins over the brief -- the
 *      singer must lip-sync the actual audio.
 *   4. Every other character resolves from the asset manager's
 *      `subject_gender`. The voice describes one speaker and has no
 *      bearing on the rest of the cast.
 *   5. For `char_narrator`, when `subject_gender` was left unstated, fall
 *      back to the voice profile -- the narrator speaks the voiceover, so a
 *      male voice should not yield a female narrator. Unlike the
 *      singer at step 3, this never overrides an explicitly stated
 *      `subject_gender`, and it still never leaks onto the rest of the cast.
 *   6. An absent or `'unknown'` value never participates.
 *
 * Objects have no gender and are always unvalidated.
 */
export function resolveAnchorGender(params: {
  candidate: Pick<
    AnchorAssetCandidate,
    'anchor_id' | 'source_asset_ids' | 'subject_gender' | 'type'
  >
  /**
   * The EFFECTIVE edit instructions for this run -- the same list the
   * prompt is built from (`resolveEffectiveEditInstructions`), which folds
   * in the current request's instruction on the ANCHOR_IDS path. Reading
   * the candidate's own fields instead would miss an edit not yet merged
   * onto the candidate, and the validator would then fight the user's
   * override back to the stale value.
   */
  editInstructions?: string[]
  voiceGender?: AnchorGender
}): ResolvedAnchorGender {
  const { candidate } = params

  if (candidate.type !== 'CHARACTER') {
    return unvalidated('not_a_character')
  }

  if (params.editInstructions?.some((entry) => entry.trim())) {
    return unvalidated('user_edit_instruction')
  }

  if ((candidate.source_asset_ids ?? []).length > 0) {
    return unvalidated('bound_source_image')
  }

  const voiceGender = normalizeGender(params.voiceGender)
  if (isCanonicalSingerAnchor(candidate) && voiceGender) {
    return { basis: 'voice', gender: voiceGender, reason: 'singer_voice_profile' }
  }

  const candidateGender = normalizeGender(candidate.subject_gender)
  if (candidateGender) {
    return { basis: 'candidate', gender: candidateGender, reason: 'asset_plan_subject_gender' }
  }

  // Narrator fallback: the narrator speaks the voiceover, so an unstated
  // gender resolves from the uploaded voice rather than being left unpinned
  // (which lets the image model free-choose -- observed: a male voice
  // produced a female narrator). Below `subject_gender`, so an
  // explicit narrator gender still wins; scoped to the narrator, so the voice
  // never decides the rest of the cast.
  if (isNarratorAnchor(candidate) && voiceGender) {
    return { basis: 'voice', gender: voiceGender, reason: 'narrator_voice_profile' }
  }

  return unvalidated('no_resolved_gender')
}

/**
 * True when the prompt-spec declared a gender that contradicts the
 * resolved one. Either side being `'unknown'` (or absent) is not a
 * contradiction -- it is an abstention.
 */
export function isAnchorGenderMismatch(params: {
  depicted: AnchorGender | undefined
  resolved: ResolvedAnchorGender
}): boolean {
  const depicted = normalizeGender(params.depicted)
  if (!depicted || params.resolved.basis === 'unvalidated') {
    return false
  }
  return depicted !== params.resolved.gender
}

/**
 * Corrective directive appended to the prompt on the one retry after a
 * mismatch. Names the required value explicitly rather than restating the
 * original MUST, which the model already had and ignored.
 */
export function buildAnchorGenderCorrection(resolved: ResolvedAnchorGender): string {
  return `

CORRECTION -- your previous attempt for this anchor emitted the wrong gender. This character's gender is ${resolved.gender}, resolved from ${resolved.reason}. Set depicted_gender to "${resolved.gender}" and write generation_prompt to depict a ${resolved.gender} subject. Do not restate or reinterpret this value.`
}

function normalizeGender(value: AnchorGender | undefined): AnchorGender | null {
  return value && value !== 'unknown' ? value : null
}

function unvalidated(reason: string): ResolvedAnchorGender {
  return { basis: 'unvalidated', gender: 'unknown', reason }
}
