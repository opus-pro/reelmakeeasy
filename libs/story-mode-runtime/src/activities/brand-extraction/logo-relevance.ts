/**
 * Strict logo relevance: keep a staged logo only if it is actually THIS
 * brand's own mark. A brand site routinely shows third-party logos (sponsors,
 * partners, "as seen on" press marks, payment badges like Visa/Stripe, app
 * stores), and the crawler scoops them all into the logo bucket. Left in, they
 * render as brand anchors.
 *
 * Text-only LLM step: from each logo's description, keep it only if it is an
 * actual logo that belongs to this brand. Drops two ways: a logo owned by
 * someone else (sponsor / third-party), or something that is not a logo at all
 * (a photo / screenshot / og:image episode thumbnail the crawler misclassified),
 * even when it is the brand's own content. Judges OWNERSHIP by the mark, not
 * literal name-in-text, so an icon-only mark with no wordmark is still kept.
 * Separate from generateImageDescription so the shared image-description model
 * is never perturbed.
 *
 * Best-effort and never blocking: any throw, an empty brand name, or no logos
 * degrades to "keep all logos". Default-keep on a missing/ambiguous verdict so
 * the real logo is never dropped over an LLM hiccup.
 */
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { PLANNER_TOOL_MODELS_LIGHT, type StagedAssetRef } from '@reelmakeeasy/uip-planner-runtime'
import { z } from 'zod'

const logger = createSubLogger('brand-logo-relevance')

const LogoRelevanceSchema = z.object({
  verdicts: z
    .array(
      z.object({
        index: z.number(),
        is_brand_logo: z.boolean(),
        reason: z.string().default(''),
      }),
    )
    .default([]),
})

export interface FilterBrandLogosInput {
  brandName: string
  logos: StagedAssetRef[]
  projectId: string
  runId: string
}

export interface FilterBrandLogosResult {
  droppedUris: Set<string>
}

// Signals that describe could not actually read the image (e.g. a black-on-
// transparent logo flattened to black). A logo matching this is kept, never
// dropped, since the relevance verdict would be judging empty content.
const UNREADABLE_DESCRIPTION =
  /no (visible|discernible|identifiable) (content|detail|features?)|completely black|solid (black|colou?r)|blank|empty image|nothing (is )?visible|cannot be (seen|made out|identified)|illegible/i

interface LogoVerdict {
  isBrandLogo: boolean
  reason: string
}

export async function filterBrandLogos(
  input: FilterBrandLogosInput,
): Promise<FilterBrandLogosResult> {
  const { brandName, logos, projectId, runId } = input
  const keepAll: FilterBrandLogosResult = { droppedUris: new Set() }

  const trimmedName = brandName.trim()
  if (!trimmedName || logos.length === 0) {
    return keepAll
  }

  try {
    const verdicts = await judgeLogoRelevance(trimmedName, logos, projectId, runId)
    const droppedUris = new Set<string>()
    for (let i = 0; i < logos.length; i++) {
      const ref = logos[i]
      if (!ref) {
        continue
      }
      const verdict = verdicts.get(i)
      if (!verdict || verdict.isBrandLogo) {
        continue
      }
      // Never drop a logo describe could not actually read (a black-on-
      // transparent mark that flattened to black, a blank/empty render). The
      // verdict is judging a description with no content, so we cannot tell --
      // keep it rather than discard the brand's real mark.
      if (isUnreadableLogoDescription(ref.description)) {
        logger.info(
          `[${projectId}/${runId}] keeping unreadable-description logo (describe saw no content) uri=${ref.staging_uri} reason="${verdict.reason || ''}"`,
        )
        continue
      }
      droppedUris.add(ref.staging_uri)
      logger.info(
        `[${projectId}/${runId}] dropping non-brand logo brand="${trimmedName}" uri=${ref.staging_uri} reason="${verdict.reason || 'not this brand'}"`,
      )
    }
    return { droppedUris }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[${projectId}/${runId}] logo relevance check failed; keeping all logos: ${message}`,
    )
    return keepAll
  }
}

function buildRelevancePrompt(
  brandName: string,
  candidates: { description: string; index: number }[],
): string {
  const lines = candidates.map((c) => `[${c.index}] ${c.description}`).join('\n')
  return `You decide which candidates are a real logo belonging to the brand "${brandName}".

Set is_brand_logo=true ONLY if the candidate is an actual logo owned by this brand: its primary logo, a wordmark/lettermark, or an icon/symbol variant of its mark.

Set is_brand_logo=false in either of these cases:
- Owned by someone else: a sponsor, partner, "as seen on"/press mark, payment or security badge (Visa, Mastercard, Stripe, PayPal, Norton, ...), app-store badge, or any other third-party brand (e.g. Spotify).
- Not a logo at all: a photograph, screenshot, podcast/episode thumbnail, social-share/preview (og:image) graphic, infographic, banner, or any scene / product / person image -- even when it is clearly this brand's own content.

Rules:
- Judge brand OWNERSHIP by the mark, not whether the brand name literally appears. The brand's own icon-only mark with NO text is still is_brand_logo=true.
- If a description indicates the image could not be read (blank, empty, completely black, or no visible content), you cannot judge it -- set is_brand_logo=true (keep it).
- When you are unsure whether a genuine logo belongs to this brand, keep it (is_brand_logo=true). But do NOT keep an image merely because it is the brand's own content -- if it is not actually a logo (a photo, screenshot, thumbnail, or scene), set is_brand_logo=false.

Return one verdict object per candidate index.

Candidates:
${lines}`
}

function isUnreadableLogoDescription(description: null | string | undefined): boolean {
  const text = description?.trim()
  if (!text) {
    return true
  }
  return UNREADABLE_DESCRIPTION.test(text)
}

async function judgeLogoRelevance(
  brandName: string,
  logos: StagedAssetRef[],
  projectId: string,
  runId: string,
): Promise<Map<number, LogoVerdict>> {
  const candidates = logos.map((ref, index) => ({
    description: ref.description?.trim() || '(no description available)',
    index,
  }))
  const result = await completion({
    models: PLANNER_TOOL_MODELS_LIGHT,
    prompt: buildRelevancePrompt(brandName, candidates),
    reasoningEffort: 'low',
    responseFormat: LogoRelevanceSchema,
    task: 'uip-brand-logo-relevance',
    temperature: 0,
    timeout: 30_000,
  })
  logger.info(
    `[${projectId}/${runId}] logo relevance judged brand="${brandName}" logos=${logos.length} verdicts=${result.verdicts.length}`,
  )
  const byIndex = new Map<number, LogoVerdict>()
  for (const verdict of result.verdicts) {
    byIndex.set(verdict.index, { isBrandLogo: verdict.is_brand_logo, reason: verdict.reason })
  }
  return byIndex
}
