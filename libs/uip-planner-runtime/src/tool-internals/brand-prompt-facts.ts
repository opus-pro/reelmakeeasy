import type { BrandBank, GlobalConstraints } from '../types'

/**
 * Tier 1 brand facts threaded into downstream LLM prompts when the
 * session is on the brand path. Strictly a subset of `brand_bank` -- the
 * fields the user sees and can edit on the brand-review card, plus the
 * `brand_video_type` narrative-arc selector that lives on
 * `GlobalConstraints`.
 *
 * Tier 3 fields (voice.persona, signature_phrases, mission, target_audience,
 * etc.) are intentionally NOT included -- they are synthesized but not
 * consumed in v1. See the tier model on `buildStructuredBriefJson` below.
 */
export interface BrandPromptFacts {
  about_us_summary: null | string
  business_name: string
  primary_cta_label: null | string
  video_type: 'friction_to_flow' | 'industry_explainer' | 'product_showcase' | null
}

const ARC_HINT: Record<NonNullable<BrandPromptFacts['video_type']>, string> = {
  friction_to_flow:
    'Problem -> Solution arc: open on a concrete pain moment, pivot to relief by the product',
  product_showcase:
    'Spotlight what the product does and why it matters -- features / use cases / proof',
  industry_explainer:
    "Break down a concept, trend, or topic in the user's space -- explain, don't sell hard",
}

/**
 * Build BrandPromptFacts from `session.spec.global_constraints`. Returns
 * null when no brand bank is present -- callers MUST guard their
 * brand-aware code paths on null to keep flag-off sessions byte-identical
 * to non-brand sessions.
 */
export function brandPromptFactsFromConstraints(gc: GlobalConstraints): BrandPromptFacts | null {
  if (!gc.brand_bank) {
    return null
  }
  return {
    business_name: gc.brand_bank.basic_info.business_name,
    about_us_summary: gc.brand_bank.basic_info.about_us_summary,
    primary_cta_label: gc.brand_bank.ctas[0]?.label ?? null,
    video_type: gc.brand_video_type,
  }
}

/**
 * Build the structuredBrief JSON string passed to the script tool's
 * VIDEO BRIEF section. Enforces the tier model at the data boundary:
 *
 * - Tier 1 (editorial, user controls) -- preserved as-is:
 *     basic_info.{business_name, about_us_summary, location}, ctas,
 *     staged_assets, brand_style_directive
 * - Tier 2 (structural extracts) -- kept as null placeholders so a later
 *   change can wire them through STYLE-gated reads without re-shaping the JSON:
 *     palette, fonts, socials, derived_style_text
 * - Tier 3 (inferential narrative) -- STRIPPED. Synthesized but not
 *   consumed in v1; the LLM should not even passively read them off
 *   the JSON dump:
 *     voice.persona, voice.signature_phrases,
 *     basic_info.{founders, target_audience, pain_points_addressed,
 *                 vision_and_values, origin_quotes},
 *     product_offerings (values; keys are observable structural names
 *                        and are kept in BRAND ASSET PREFERENCE's
 *                        trigger-word block separately),
 *     testimonials
 *
 * Non-brand sessions (brand_bank === null) get raw
 * `JSON.stringify(gc, null, 2)`.
 */
export function buildStructuredBriefJson(gc: GlobalConstraints): string {
  if (!gc.brand_bank) {
    return JSON.stringify(gc, null, 2)
  }
  const redactedConstraints = {
    ...gc,
    brand_bank: redactBrandBankForStructuredBrief(gc.brand_bank),
  }
  return JSON.stringify(redactedConstraints, null, 2)
}

/**
 * Render the BRAND CONTEXT block injected into script + intent prompts.
 * Returns an empty string when `facts` is null -- callers can interpolate
 * unconditionally without spawning blank lines on non-brand sessions.
 *
 * Individual lines (about, narrative-arc, CTA) are omitted when their
 * source field is null. The business_name line is always present when
 * the block is rendered (business_name is a required field on
 * `BrandBank.basic_info`).
 */
export function renderBrandContextBlock(facts: BrandPromptFacts | null): string {
  if (!facts) {
    return ''
  }
  const lines: string[] = [
    'BRAND CONTEXT (real brand -- ground copy in these facts, do not invent product specs):',
    `- Business: ${facts.business_name}`,
  ]
  if (facts.about_us_summary) {
    lines.push(`- About: ${facts.about_us_summary}`)
  }
  if (facts.video_type) {
    lines.push(`- Narrative arc: ${facts.video_type} -- ${ARC_HINT[facts.video_type]}`)
  }
  if (facts.primary_cta_label) {
    lines.push(`- Primary CTA: ${facts.primary_cta_label}`)
  }
  return lines.join('\n')
}

function redactBrandBankForStructuredBrief(bank: BrandBank): Record<string, unknown> {
  return {
    basic_info: {
      business_name: bank.basic_info.business_name,
      about_us_summary: bank.basic_info.about_us_summary,
      location: bank.basic_info.location,
    },
    ctas: bank.ctas,
    staged_assets: bank.staged_assets,
    // Tier 2 placeholders (for future STYLE-gated reads).
    palette: null,
    fonts: null,
    socials: null,
    derived_style_text: null,
  }
}
