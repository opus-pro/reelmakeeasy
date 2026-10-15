/**
 * Brand-extraction synthesis activity (UIP Brand Extraction).
 *
 * Produces a content-only `BrandBank` (without `staged_assets`) from one of
 * two input kinds:
 *
 *   - `kind: 'url'`     -- multi-page raw scrape harvested by `crawl-brand-site`
 *                          is read back from storage (`_raw/scrape.json`) and
 *                          embedded into the prompt; up to N screenshots are
 *                          attached as multimodal `image_url` content for
 *                          vision-aware palette / voice extraction.
 *   - `kind: 'freeform'` -- user-provided text (no crawler output) is the
 *                           sole source; palette / socials / ctas typically
 *                           empty since the model has nothing visual to derive.
 *
 * Single `completion()` call with `PLANNER_TOOL_MODELS_LIGHT`
 * (gemini-2.5-flash + gpt-5-mini fallback). Schema is
 * `BrandBankSchema.omit({ staged_assets: true })` so the LLM cannot accidentally
 * write staged_assets (those are the crawler's responsibility, threaded
 * separately through the workflow signal payload).
 */

import type { Content } from '@reelmakeeasy/common/llm/clients/client'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type BrandBank,
  BrandBankSchema,
  PLANNER_TOOL_MODELS_LIGHT,
} from '@reelmakeeasy/uip-planner-runtime'

import { withActivityHeartbeat, withLongTakeContext } from '../long-take/common'

import type { BrandRawScrape } from './crawl-brand-site'
import { BRAND_RAW_DIR, brandRunPath, createBrandExtractionStorage } from './storage'

const logger = createSubLogger('brand-extraction:synthesize')

const SynthesisOutputSchema = BrandBankSchema.omit({ staged_assets: true })

export type BrandExtractionInputForSynthesis =
  | { kind: 'freeform'; text: string }
  | { kind: 'url'; url: string }

export interface SynthesizeBrandActivityParams {
  input: BrandExtractionInputForSynthesis
  projectId: string
  runId: string
  /**
   * store addresses (`store://path`) for screenshots staged by `crawl-brand-site`.
   * Attached as multimodal `image_url` content so Gemini can see the visual
   * brand identity (palette, layout density). Soft-capped to 3 to stay under
   * Gemini Flash's per-prompt image limit and keep latency in budget.
   */
  screenshotUris?: string[]
  userEmail?: string
  userId: string
}

export interface SynthesizeBrandActivityResult {
  bankWithoutAssets: Omit<BrandBank, 'staged_assets'>
}

export class BrandSynthesisError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'BrandSynthesisError'
  }
}

const MAX_SCREENSHOTS = 3

export async function synthesizeBrandActivity(
  params: SynthesizeBrandActivityParams,
): Promise<SynthesizeBrandActivityResult> {
  const { runId, projectId, userId, userEmail, input, screenshotUris } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      // The crawl writes the (potentially multi-MB) raw scrape to storage rather
      // than returning it inline, so load it back here for the url kind.
      // Freeform has no scrape; leave it undefined.
      const rawScrape = input.kind === 'url' ? await readRawScrape(projectId, runId) : undefined
      const prompt = buildSynthesisPrompt(input, rawScrape)
      const contents = buildContents(screenshotUris)
      logger.info(
        `[brand-extraction] synthesis start runId=${runId} kind=${input.kind} promptChars=${prompt.length} screenshots=${contents.length}`,
      )
      try {
        const result = await completion({
          contents: contents.length > 0 ? contents : undefined,
          models: PLANNER_TOOL_MODELS_LIGHT,
          prompt,
          reasoningEffort: 'low',
          responseFormat: SynthesisOutputSchema,
          task: 'uip-brand-extraction-synthesize',
          temperature: 0.1,
          timeout: 90_000,
        })
        // Persist the bank to storage alongside the raw scrape. The workflow
        // signal payload is the canonical handoff to the parent; this file
        // exists so the bank outlives the workflow run
        // and is readable from the storage console for debugging.
        try {
          const storage = createBrandExtractionStorage(projectId)
          await storage.writeJsonFile(brandRunPath(runId, `${BRAND_RAW_DIR}/bank.json`), result)
        } catch (err) {
          logger.warn(
            `[brand-extraction] failed to persist bank.json runId=${runId} message=${ensureError(err).message}`,
          )
        }
        logger.info(
          `[brand-extraction] synthesis done runId=${runId} businessName=${
            result.basic_info.business_name
          } durationMs=${Date.now() - startedAt}`,
        )
        return { bankWithoutAssets: result }
      } catch (err) {
        const cause = ensureError(err)
        logger.warn(`[brand-extraction] synthesis failed runId=${runId} message=${cause.message}`)
        throw new BrandSynthesisError(cause.message, cause)
      }
    }),
  )
}

function buildContents(screenshotUris: string[] | undefined): Content[] {
  const uris = (screenshotUris ?? []).slice(0, MAX_SCREENSHOTS)
  return uris.map((uri) => ({ imageUrl: uri, type: 'image_url' as const }))
}

function buildSynthesisPrompt(
  input: BrandExtractionInputForSynthesis,
  rawScrape: BrandRawScrape | undefined,
): string {
  const sourceBlock =
    input.kind === 'url'
      ? buildUrlSourceBlock(input.url, rawScrape)
      : buildFreeformSourceBlock(input.text)

  return `${SYNTHESIS_INSTRUCTION}

${sourceBlock}`
}

/**
 * Load the raw scrape the crawler staged at `_raw/scrape.json`. For the url
 * kind this file is the sole crawl->synthesis handoff, so a read failure must
 * NOT degrade to a thin-signal run: that would persist a near-empty bank.json
 * that looks like success. Throw a BrandSynthesisError instead so the engine
 * retries the activity on a transient storage blip, and on permanent failure the
 * workflow surfaces synthesis_failed rather than a garbage brief.
 */
async function readRawScrape(projectId: string, runId: string): Promise<BrandRawScrape> {
  const storage = createBrandExtractionStorage(projectId)
  try {
    return await storage.readJsonFile<BrandRawScrape>(
      brandRunPath(runId, `${BRAND_RAW_DIR}/scrape.json`),
    )
  } catch (err) {
    const cause = ensureError(err)
    logger.warn(
      `[brand-extraction] failed to read scrape.json runId=${runId} message=${cause.message}`,
    )
    throw new BrandSynthesisError(`failed to load raw scrape for runId=${runId}`, cause)
  }
}

const SYNTHESIS_INSTRUCTION = `You are synthesizing a brand identity card from raw signals about a single brand.
Produce a single JSON object matching the response schema. The object describes the brand
itself (the company / product), not the website it was extracted from. The downstream
script-generation pipeline reads this card to ground the brand voice, palette, CTAs, and
target audience -- so prefer concrete facts you can support from the source over guesses.

When screenshots are attached, use them to validate / refine the palette and the
"derived_style_text" hint. The text JSON is the source of truth for everything else;
the screenshots are a visual sanity check.

Field guidance:

- basic_info.business_name: the brand's commonly-used name. Prefer the canonical form (e.g.
  "Gymshark", not "GYMSHARK INC."). If unknown leave empty.
- basic_info.founders: list founder names if and only if explicitly stated.
- basic_info.target_audience: 1-3 short phrases naming who this brand serves (e.g. "fitness
  enthusiasts in their 20s-30s", "Indian software engineers"). Empty if no signal.
- basic_info.pain_points_addressed: short phrases naming problems the brand solves.
- basic_info.vision_and_values: { mission: string|null, values: string[] }. Mission should
  be one sentence. Values are short phrases.
- basic_info.about_us_summary: 2-4 sentences. Conversational tone. Null if no signal.
- basic_info.origin_quotes: 1-3 verbatim quotes from the source about the brand's origin
  (founder voice, founding story). Drop quotes that are generic marketing copy.
- basic_info.location: HQ city / country if stated.

- product_offerings: an object mapping product/service category to details. Free-form;
  prefer hierarchical structure when meaningful. Empty object {} if no signal.

- testimonials: customer/press quotes with attribution. Skip generic praise.

- voice: { persona: string|null, signature_phrases: string[] }. Persona is 1-2 sentences
  describing the tonal voice. Signature_phrases are 0-5 verbatim phrases the brand
  repeats (taglines, recurring CTAs, etc.).

- palette: array of { hex, role, frequency }. Roles include "primary", "secondary",
  "accent", "background", "text", or whatever the source signals. Frequency is a
  relative weight (0-1 or raw count is fine). Empty array if no visual signal.

- ctas: a single { label, href } object wrapped in a one-element array. Write a
  fresh CTA label in the brand's voice -- use voice.persona,
  basic_info.pain_points_addressed, product_offerings, and the value proposition
  you derived in the same response as context. Lead with an action verb tied to
  the value prop and keep it short (<= 6 words). Reject generic patterns
  ("Shop Now", "Learn More", "Get Started", "Sign Up", "Click Here") unless they
  genuinely match the brand voice (e.g. the scraped section CTAs use them
  consistently and the voice is minimal). For href, pick from a section CTA in
  the source pages -- do not invent URLs. If no section CTA is a good fit, use
  the source URL. In the freeform path (no website crawled), set href to a URL
  the user explicitly mentioned in their description, or "" (empty string) if
  none -- never invent a URL. Return [] only if you cannot derive a meaningful
  label from the source at all.

- socials: object mapping platform name (instagram, twitter, youtube, tiktok, etc.) to
  the canonical profile URL. Empty {} if none.

- derived_style_text: optional short style descriptor (one sentence) summarizing the
  brand's visual / tonal identity. Used as a soft hint in downstream tools. Null if
  you can't derive a clean one-liner.

If a field has no support in the source, prefer null / empty over invented content.
Do not include staged_assets -- the asset list is managed by the crawler separately.`

function aggregateSocials(rawScrape: BrandRawScrape): Record<string, string> {
  const out: Record<string, string> = {}
  for (const page of rawScrape.pages) {
    for (const s of page.socials) {
      if (!out[s.platform]) {
        out[s.platform] = s.url
      }
    }
  }
  return out
}

function buildFreeformSourceBlock(text: string): string {
  return `Source kind: user-provided freeform text

The user described their brand in their own words below. There is no crawled website
data; rely entirely on the user's description. Many fields will be empty (e.g. palette,
socials) -- that is expected, do not invent them. For ctas, write a label in the
brand's voice from the user's description, but leave href as "" unless the user
explicitly stated a URL.

# user description
${text}`
}

function buildPageBlock(page: BrandRawScrape['pages'][number]): string {
  // Drop large per-page fields that synthesis doesn't need (videos, fontUrls binary
  // listings, full image arrays). Keep a short fingerprint of each.
  const summary = {
    slug: page.slug,
    url: page.url,
    meta: page.meta,
    tokens: {
      colors: page.tokens.colors.slice(0, 30),
      cssVars: page.tokens.cssVars.slice(0, 20),
      fontUsage: page.tokens.fontUsage.slice(0, 8),
      spacing: page.tokens.spacing.slice(0, 12),
    },
    sections: page.sections.slice(0, 12).map((s) => ({
      id: s.id,
      tag: s.tag,
      heading: s.heading,
      subheading: s.subheading,
      body: s.body,
      cta: s.cta,
    })),
    logoCount: page.logos.length,
    fontFamilies: [
      ...new Set(
        page.fontUrls.map((f) => f.family).filter((f) => f && f !== 'unknown' && f !== 'preloaded'),
      ),
    ].slice(0, 8),
  }
  return `## page: ${page.slug}
${stringifyForPrompt(summary)}`
}

function buildUrlSourceBlock(url: string, rawScrape: BrandRawScrape | undefined): string {
  if (!rawScrape) {
    return `Source URL: ${url}
Source kind: crawled website (no scrape data attached)

The crawler ran but no per-page scrape was forwarded. Treat this as a thin signal
and prefer null / empty over guesses.`
  }
  const pagesBlock = rawScrape.pages.map((page) => buildPageBlock(page)).join('\n\n---\n\n')

  return `Source URL: ${url}
Source kind: crawled website
Origin: ${rawScrape.origin}
Pages crawled: ${String(rawScrape.pages.length)}

The following per-page scrape was harvested from the brand's website. Each page block
contains: meta (title/description/og), tokens (colors / fonts / spacing), sections
(headings + body + ctas), logos, fontUrls, socials. Use them as the primary source of
truth.

# Aggregated socials (across all pages)
${stringifyForPrompt(aggregateSocials(rawScrape))}

# Per-page scrape
${pagesBlock}`
}

function stringifyForPrompt(value: unknown): string {
  if (value === undefined) {
    return '(not available)'
  }
  try {
    const json = JSON.stringify(value, null, 2)
    // Soft cap so a single huge sections file can't blow out the context window.
    const cap = 60_000
    if (json.length > cap) {
      return `${json.slice(0, cap)}\n... [truncated ${String(json.length - cap)} chars]`
    }
    return json
  } catch {
    return '(unserializable)'
  }
}
