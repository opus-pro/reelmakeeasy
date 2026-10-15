/**
 * Shared photo-passthrough constants + realism classifier.
 *
 * Consumed by BOTH workflow code (stages/transitions.ts routes photo
 * shots away from i2v) and activity code (keyframes.ts decides when to
 * composite the raw photo). The single import below is a deep import into a
 * dependency-free shared module (no node/activity code), so workflow code
 * stays light.
 */

import { PHOTO_PASSTHROUGH_IMAGE_MODEL } from '@reelmakeeasy/common/long-take/photo-passthrough-constants'

/**
 * `LongTakeKeyframeItem.imageModel` tag for a keyframe that IS the raw
 * article photograph composited verbatim (no image-model generation).
 * Mirrors the 'logo-passthrough' convention; the transitions
 * stage keys the no-i2v pan/zoom path off this tag. Lives in
 * @reelmakeeasy/common/long-take/photo-passthrough-constants, a dependency-free
 * module, so the api scope (which may not import @reelmakeeasy/story-mode-runtime)
 * can reach it too and this workflow file stays light; re-exported here so
 * this module's existing consumers need no change.
 */
export { PHOTO_PASSTHROUGH_IMAGE_MODEL }

// Style texts that describe real-world/photographic footage. A match means a
// real photograph belongs in the video AS-IS (verbatim passthrough + pan/zoom
// instead of AI regeneration).
const REALISTIC_STYLE_REGEX =
  /photo[\s-]*real|realistic|documentary|broadcast|live[\s-]?action|real[\s-]?world|photograph/i

// Obvious stylization markers. Any AFFIRMATIVE match wins over the realistic
// keywords so e.g. "semi-realistic anime" is NOT treated as realistic --
// under a stylized look the photo should be restyled to fit, not shown
// verbatim.
const STYLIZED_STYLE_REGEX =
  /anime|cartoon|comic|illustrat|clay|lego|pixel|voxel|watercolor|paint|sketch|hand[\s-]?draw|3d[\s-]?render|low[\s-]?poly|origami|paper[\s-]?craft|stop[\s-]?motion|puppet|toy|plastic|miniature|doll/i

// Negated clauses: realistic style texts routinely FORBID stylization
// ("Absolutely no illustration, cartoon, anime, or 3D-render stylization",
// "Avoid: - Any form of illustration ..."), which must not read as stylized
// markers. A negation cue eats its clause up to the next sentence boundary,
// plus any immediately following "- ..." bullet lines (Avoid-list blocks).
// The span stops at contrast words (but / rather / instead / however / yet)
// so an affirmative tail like "not watercolor BUT anime-inspired linework"
// keeps its stylized marker.
const NEGATED_CLAUSE_REGEX =
  /\b(?:absolutely\s+)?(?:no|not|never|without|avoid(?:ing)?)\b(?:(?!\b(?:but|rather|instead|however|yet)\b)[^.;\n])*(?:\n\s*-[^\n]*)*/gi

/**
 * True when the style text describes a realistic / photographic look (or is
 * absent -- the pipeline's no-style default is photoreal). Under a realistic
 * style, real article photos are used verbatim; under a stylized one they are
 * restyled into the chosen look, so this must stay conservative: an
 * unrecognized named style returns false and keeps today's behavior.
 *
 * Both keyword lists run on the negation-stripped text: forbidding a style
 * ("no cartoon") is realism evidence, not stylization, and a negated realism
 * claim ("not realistic") must not count as realism.
 */
export function isRealisticStyleText(styleText: null | string | undefined): boolean {
  const text = styleText?.trim()
  if (!text) {
    return true
  }
  const affirmative = text.replace(NEGATED_CLAUSE_REGEX, ' ')
  if (STYLIZED_STYLE_REGEX.test(affirmative)) {
    return false
  }
  return REALISTIC_STYLE_REGEX.test(affirmative)
}
