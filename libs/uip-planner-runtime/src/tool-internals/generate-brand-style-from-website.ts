/**
 * Website -> brand style prompt synthesis (v3, brand-library create flow).
 *
 * One LLM call that turns the brand-extraction crawl's raw scrape (per-page
 * copy + computed design tokens) into a single reusable visual style prompt.
 * The caller feeds the returned text into the custom-style analyzer
 * (`StyleAnalyzerService.analyzeStyle({ styleDescription })`) unchanged, which
 * is exactly the pipeline the designer validated: extraction prompt output
 * pasted into the style builder's text intake.
 *
 * `WEBSITE_STYLE_EXTRACTION_INSTRUCTION` is a verbatim port of a
 * designer-authored v3 brand style extraction prompt, with two adaptations:
 *   - ADD: an evidence-framing preamble. v3 makes what the site visually
 *     looks like the source of truth and demotes copy to fallback; in
 *     production the website arrives as a structured scrape with no
 *     screenshots, so the framing maps the measured design tokens (colors,
 *     typography, spacing), section layout hints, and image descriptions onto
 *     v3's "visual input" and the page copy + metadata onto its "written
 *     content".
 *   - REWRITE: output as structured JSON ({ style_prompt }) instead of free
 *     text, matching the house structured-output pattern (same adaptation the
 *     V6 analyzer port made in style-analyzer.prompts.ts).
 * Changes to the prompt need an explicit edit + diff review here.
 *
 * Failure model: single attempt; on failure return `null` and the caller
 * falls back to the bank-text synthesis chain (`generateBrandStyling`), so an
 * outage degrades to the previous behavior, never to a broken run.
 */

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS_LIGHT } from '../model-config'

const logger = createSubLogger('uip-planner-runtime:generate-brand-style-from-website')

const WebsiteStyleOutputSchema = z.object({
  style_prompt: z.string().min(1),
})

export interface GenerateBrandStyleFromWebsiteOptions {
  scrape: WebsiteScrapeEvidence
  url: string
}

// Loose mirror of the fields we read from the crawl's `BrandRawScrape`
// (story-mode-runtime activities/brand-extraction/page-scrape-source.ts). The
// scrape crosses a storage JSON boundary, so every field is optional and
// defensively read; the dependency direction (story-mode ->
// uip-planner-runtime) forbids importing the real type. Keep the field names
// in sync with the crawler.
export interface WebsiteScrapeEvidence {
  pages?: WebsiteScrapePageEvidence[]
}

export interface WebsiteScrapePageEvidence {
  images?: { alt?: string; isHero?: boolean; section?: string }[]
  meta?: {
    description?: string
    ogDescription?: string
    ogTitle?: string
    title?: string
  }
  sections?: {
    body?: string
    heading?: string
    layout?: string
    subheading?: string
    tag?: string
  }[]
  slug?: string
  tokens?: {
    colors?: string[]
    fontUsage?: { family?: string; sizes?: string[]; weights?: string[] }[]
    spacing?: string[]
  }
  url?: string
}

export async function generateBrandStyleFromWebsite(
  opts: GenerateBrandStyleFromWebsiteOptions,
): Promise<null | string> {
  const evidence = buildWebsiteEvidenceBlock(opts)
  if (!evidence) {
    logger.warn('[uip-website-style] scrape has no usable pages; skipping v2 synthesis')
    return null
  }
  const prompt = `${WEBSITE_STYLE_EXTRACTION_INSTRUCTION}\n\n${evidence}`
  const startedAt = Date.now()
  // Single attempt, no retry: the caller's bank-text fallback chain is the
  // retry. Style gen runs inside the create stream's `generating_style` SSE
  // phase, and the FE tears the stream down after ~2 minutes -- a retry here
  // stacks on top of the fallback's own 2x30s budget and pushes the whole
  // phase past that window.
  try {
    const result = await completion({
      models: PLANNER_TOOL_MODELS_LIGHT,
      prompt,
      responseFormat: WebsiteStyleOutputSchema,
      reasoningEffort: 'low',
      task: 'brand-library-generate-style-from-website',
      temperature: 0.4,
      timeout: 45_000,
      enableSearch: false,
    })
    const text = result.style_prompt.trim()
    if (!text) {
      throw new Error('empty style_prompt')
    }
    logger.info(`[uip-website-style] ok durationMs=${Date.now() - startedAt} chars=${text.length}`)
    return text
  } catch (err) {
    logger.warn(
      `[uip-website-style] synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

// Per-page caps mirror the bank-synthesis serializer
// (story-mode-runtime synthesize-brand.ts buildPageBlock), plus per-string
// truncation and an overall soft cap so a content-heavy scrape can't blow the
// model's context window (which would fail the call and silently drop every
// rich site to the bank-text fallback).
const MAX_PAGES = 10
const MAX_SECTIONS_PER_PAGE = 12
const MAX_COLORS_PER_PAGE = 30
const MAX_FONTS_PER_PAGE = 8
// v3 promotes spacing/whitespace/density to high-priority visual evidence, so
// the computed spacing values ride along (short padding shorthands, cheap).
const MAX_SPACING_PER_PAGE = 12
const MAX_IMAGE_ALTS_PER_PAGE = 10
const MAX_TEXT_FIELD_CHARS = 500
const MAX_EVIDENCE_CHARS = 60_000

const clip = (value: string | undefined): string | undefined =>
  value ? value.slice(0, MAX_TEXT_FIELD_CHARS) : undefined

export function buildWebsiteEvidenceBlock(
  opts: GenerateBrandStyleFromWebsiteOptions,
): null | string {
  const allPages = opts.scrape.pages ?? []
  const pages = allPages.slice(0, MAX_PAGES)
  if (pages.length === 0) {
    return null
  }
  const pageBlocks = pages.map((page) => {
    // Field-by-field pick: the raw scrape carries prompt-hostile payloads the
    // types don't show (meta.ogImage can be a data: URI, sections[].images are
    // URL lists), so never spread a scrape object into the summary wholesale.
    const summary = {
      slug: page.slug,
      url: page.url,
      meta: {
        title: clip(page.meta?.title),
        description: clip(page.meta?.description),
        ogTitle: clip(page.meta?.ogTitle),
        ogDescription: clip(page.meta?.ogDescription),
      },
      design_tokens: {
        colors: (page.tokens?.colors ?? []).slice(0, MAX_COLORS_PER_PAGE),
        fontUsage: (page.tokens?.fontUsage ?? []).slice(0, MAX_FONTS_PER_PAGE),
        spacing: (page.tokens?.spacing ?? []).slice(0, MAX_SPACING_PER_PAGE),
      },
      sections: (page.sections ?? []).slice(0, MAX_SECTIONS_PER_PAGE).map((s) => ({
        tag: s.tag,
        layout: s.layout,
        heading: clip(s.heading),
        subheading: clip(s.subheading),
        body: clip(s.body),
      })),
      image_descriptions: (page.images ?? [])
        .filter((i) => (i.alt ?? '').trim().length > 0)
        .slice(0, MAX_IMAGE_ALTS_PER_PAGE)
        .map((i) => ({ alt: clip(i.alt), isHero: i.isHero ?? false })),
    }
    return `## page: ${page.slug || page.url || 'unknown'}\n${JSON.stringify(summary)}`
  })

  const shownNote = allPages.length > pages.length ? ` (showing first ${String(pages.length)})` : ''
  const header = `WEBSITE (structured scrape):
Source URL: ${opts.url}
Pages crawled: ${String(allPages.length)}${shownNote}`

  let body = ''
  for (const block of pageBlocks) {
    if (body.length + block.length > MAX_EVIDENCE_CHARS) {
      break
    }
    body += `${body ? '\n\n---\n\n' : ''}${block}`
  }
  // A single oversized first block still gets included, truncated at the cap.
  if (!body) {
    body = (pageBlocks[0] ?? '').slice(0, MAX_EVIDENCE_CHARS)
  }

  return `${header}\n\n${body}`
}

/**
 * Verbatim port of the designer-authored v3 brand style extraction prompt; see the
 * file docblock for the two adaptations (evidence framing, JSON output).
 */
const WEBSITE_STYLE_EXTRACTION_INSTRUCTION = `You are an expert creative director, brand strategist, art director, visual designer, cinematographer, motion designer, and visual semiotician.

Analyze the website and extract its underlying brand visual style so it can be reused consistently across video generation keyframes.

The website is provided below as a structured scrape rather than a live page or screenshots. Treat the computed design tokens (the exact colors, typography, and spacing values measured from the rendered site), the per-section layout hints, and the image descriptions as the visual input: they are the visible design language. Treat the page copy and metadata as the written content. Wherever the guidance below refers to visual input or visual evidence, read it as this measured design-token evidence.

The goal is not to describe the website. The goal is to infer the brand's reusable visual world: its art direction, mood, atmosphere, visual grammar, materiality, composition, lighting, camera language, spatial depth, frame design, implied movement, and aesthetic rules.

The final output will be used to guide keyframes for video generation. It should define how individual frames should look and feel so they remain visually consistent when used as part of a generated video. Do not write full animation instructions, shot lists, scene actions, or sequence choreography. Focus on the visual style of keyframes.

## Source Priority

Use the visible design language as the source of truth for the brand style.

The final style extraction should be based on the visual input wherever the visual input is sufficiently established.

Read the written content, but do not use it as a normal weighted input. The written content is not a co-equal source of style. It is not 25%, 20%, or any fixed percentage of the final style.

Use the written content only as fallback evidence when the visual input is missing, sparse, generic, incomplete, ambiguous, or has clear gaps.

The final style must accurately reflect what the brand looks like visually.

If the visual input clearly establishes a stylistic characteristic, do not use the text to alter, intensify, replace, reinterpret, or override that characteristic.

If the text describes a vibe that is not visually present, ignore that vibe as a style direction. Do not adopt it as part of the final visual style.

If the text and visuals point in different directions, preserve the visual identity and use the text only where it helps resolve missing or unclear visual information.

If the visuals are strong enough to define the color, lighting, composition, atmosphere, materiality, camera language, shape language, spatial density, visual weight, or overall aesthetic, rely only on the visuals for those dimensions.

If the visuals are weak or incomplete for a specific dimension, the text may be used to infer that missing dimension, but only in a way that remains visually compatible with the established visual evidence.

Do not invent a dramatically different style world from the text alone when the visuals already establish a clear aesthetic.

## Core Task

Extract the brand's reusable visual style system.

Focus on the overall brand language, not website-specific UI, page structure, navigation, product screenshots, logos, layouts, buttons, sections, or individual assets.

However, do not ignore recurring site-level visual composition. White space, breathing room, visual density, crowdedness, compression, visual weight, scale, spacing rhythm, and how much information the brand allows into a frame are valid visual style evidence when they recur across the site.

Do not describe those traits as website layout. Translate them into reusable keyframe composition rules.

For example:

- Generous website whitespace should translate into keyframes with open negative space, calm framing, and uncluttered subject placement.
- Dense or crowded website visuals should translate into keyframes with higher scene density, layered visual information, compressed spacing, and busier compositions.
- Heavy visual blocks should translate into keyframes with stronger visual mass, grounded framing, and more substantial subject presence.
- Light, airy layouts should translate into keyframes with spacious framing, softer visual weight, and more breathing room around subjects.
- Asymmetrical spacing should translate into keyframes with directional negative space and off-center compositional balance.
- Highly structured spacing should translate into keyframes with ordered spatial hierarchy and deliberate frame organization.

Generalize recurring visual patterns into creative rules that can be applied to entirely different keyframes while preserving the same recognizable brand aesthetic.

The output should work as a standalone visual style prompt for video keyframe generation.

The final prompt should help a keyframe model understand how to compose, light, color, frame, texture, and stylize any subject while staying true to the brand's visual identity.

## Visual Evidence First

Begin by extracting the visual style without relying on the written content.

Identify recurring visual patterns across:

- color
- contrast
- lighting
- typography as visual tone
- spacing
- white space
- visual weight
- scene density
- crowdedness
- openness
- compression
- breathing room
- composition
- framing
- imagery
- illustration style
- iconography
- shapes
- textures
- materials
- depth
- atmosphere
- visual density
- negative space
- subject treatment
- camera angle
- lens feel
- keyframe rhythm
- implied movement

For each major style dimension, determine whether the visual evidence is:

- strongly established
- partially established
- weak
- missing
- generic
- ambiguous
- inconsistent

Only use written content for dimensions where the visual evidence is partially established, weak, missing, generic, ambiguous, or inconsistent.

If a style dimension is strongly established visually, the text should not influence that dimension.

## Site-Level Spatial Style Signals

The website's visual organization is part of the brand's visual evidence, even though the final output must not describe website layout.

Extract recurring spatial and density traits from the site as visual style signals.

Pay special attention to:

- how much white space is used
- how much breathing room surrounds important elements
- whether compositions feel open, balanced, dense, crowded, compressed, sparse, or layered
- whether the brand favors isolated focal points or many simultaneous visual elements
- whether the visual system feels light, medium-weight, or heavy
- whether spacing feels luxurious, editorial, technical, playful, compact, maximal, minimal, or utilitarian
- whether compositions rely on symmetry, asymmetry, grids, clusters, large empty fields, dense groupings, or stacked layers
- whether the frame should feel calm and spacious or active and information-rich
- whether subjects should appear isolated, surrounded, embedded, layered, or visually crowded
- whether keyframes should preserve large negative space or fill the frame with visual material

Treat these spatial traits as high-priority visual evidence.

Do not discard them just because they come from website composition.

Translate recurring site-level spacing and density into keyframe art direction, not UI description.

## Written Content Fallback

Read the written content carefully, but treat it as fallback context rather than style authority.

Use the text only to fill visual gaps related to:

- subject matter
- audience
- emotional intent
- cultural or genre references
- recurring themes
- narrative world
- level of formality or playfulness
- category conventions
- implied atmosphere
- implied use context
- values or perceptions the brand wants to create

Then translate only the necessary fallback information into concrete visual direction.

Do not copy marketing adjectives directly into the final style.

For example, do not simply say "bold," "premium," "playful," "innovative," "human," "trustworthy," "cinematic," or "futuristic."

Translate text-derived fallback information only into specific visual qualities such as contrast, scale, density, framing, lighting, color temperature, material finish, spatial depth, texture, lens behavior, subject treatment, or compositional rhythm.

Use the text to complete the visual extraction only when the visuals do not already answer the question.

## Conflict Resolution

When visual and textual evidence disagree, follow these rules:

- Strong recurring visual evidence always wins over written claims.
- Text cannot override the visible aesthetic.
- Text cannot override observed spacing, visual density, crowdedness, white space, visual weight, or compositional rhythm.
- Text cannot make the style more expressive, futuristic, premium, playful, cinematic, luxurious, human, technical, rebellious, artistic, or emotional unless those qualities are visually present or the visual evidence is too weak to decide.
- Text may fill gaps where visuals are missing, weak, generic, or ambiguous.
- Text may help verify whether a visual interpretation is reasonable.
- Text may clarify subject-world context, but only if the resulting style remains visually consistent with the site.
- Do not force the brand into a genre, mood, or cultural aesthetic that is only present in the copy and not visible in the design.
- If the text implies a stronger style than the visuals show, do not express that stronger style unless the visuals leave a clear gap for it.
- If the visuals are restrained and the text is expressive, keep the final style restrained.
- If the visuals are expressive and the text is plain, keep the final style expressive.
- If the visuals are open and spacious while the text feels intense or energetic, keep the keyframe style open and spacious.
- If the visuals are dense or crowded while the text feels minimal or calm, keep the keyframe style visually dense or crowded.
- If the visuals are generic and the text is specific, use the text conservatively to make the style more complete.
- If both visuals and text are weak, make conservative visual inferences based on the most recurring available evidence.

## Genre and Cultural Signals

When the written content signals an artistic tradition, genre, medium, cultural aesthetic, or visual discipline, such as anime, manga, cyberpunk, luxury fashion, architecture, documentary, scientific visualization, editorial illustration, retro gaming, wellness, streetwear, cinema, institutional design, or high-end technology, do not automatically apply that genre to the final style.

Only use text-derived genre or cultural signals when:

- the visuals also support them, or
- the visuals are too sparse, generic, incomplete, or ambiguous to establish a clear alternative.

Do not merely mention the genre. If the genre is eligible as fallback, translate it into concrete visual direction through:

- composition
- lighting
- color
- contrast
- camera language
- material choices
- atmosphere
- depth
- texture
- framing
- subject treatment
- graphic density
- lens feel
- keyframe rhythm

Avoid over-applying genre conventions when the visible brand style is more restrained.

## Keyframe-Specific Guidance

Because the output will be used for video generation keyframes, extract static-frame visual principles rather than full animation instructions.

Describe how the style should appear within individual keyframes and across a set of related keyframes.

Include recurring or implied principles for:

- framing
- shot scale
- camera angle
- lens feel
- composition
- subject placement
- depth
- perspective
- lighting continuity
- color continuity
- atmospheric treatment
- material behavior
- texture
- background treatment
- negative space
- visual density
- crowdedness or openness
- visual weight
- spatial compression
- breathing room
- spatial hierarchy
- implied motion
- transition-readiness
- keyframe-to-keyframe consistency

Do not invent specific actions, scenes, or narrative events.

Do not describe full camera moves, character movement, object movement, or environmental animation unless they are expressed as implied visual qualities within a still keyframe.

For example, prefer "frames should feel poised for slow lateral movement through layered depth, with stable compositions and subtle parallax potential" over "the camera slowly moves sideways through the scene."

Prefer "subjects should be framed with quiet forward momentum and directional negative space" over "the subject walks forward."

Prefer "keyframes should preserve generous negative space and low visual crowding" over "the scene is minimal like the homepage."

Prefer "keyframes should feel layered and information-rich, with controlled crowding and strong spatial hierarchy" over "the layout is busy."

The output should describe the visual conditions that make keyframes feel consistent, cinematic, and ready for video generation, without becoming a full video prompt.

## Color Requirements

Identify the recurring color system from the visuals.

Use visual evidence as the authority for color.

Do not infer brand colors from text unless the visual color system is missing, extremely sparse, or impossible to determine.

Integrate colors naturally into the final prompt. Whenever mentioning a color, include both its descriptive name and Hex value, for example: Deep Forest Green color (#1F5A3A).

Preserve exact Hex values when they are directly observed or provided.

If a Hex value is estimated from visual sampling rather than directly provided, use a reasonable approximation and do not imply that it is exact.

Do not overpopulate the final prompt with too many colors. Focus on the dominant and signature colors that define the brand's visual identity.

## Internal Analysis - Do Not Output

Before writing the final style prompt, analyze the brand system behind the site.

First, perform a visual-only analysis.

Identify:

- The dominant visual style based on observed visual evidence.
- The recurring visual patterns across the site.
- The underlying visual strategy that connects the recurring design choices.
- The recurring design principles that could be applied to entirely new keyframes.
- The signature visual characteristics that make the style immediately recognizable.
- The emotional tone and perceptual effect created by the visuals.
- The established color system.
- The established lighting style.
- The established composition and framing logic.
- The established use of white space, negative space, visual density, crowdedness, compression, breathing room, and visual weight.
- The established camera language and lens feel.
- The established material, texture, depth, and atmosphere.
- The established shape language and subject treatment.
- The recurring principles of framing, spatial behavior, lighting continuity, implied movement, and keyframe-to-keyframe visual consistency, if supported or clearly implied.

Then identify any visual gaps.

For each major style dimension, determine whether the visual evidence is strong, partial, weak, missing, generic, ambiguous, or inconsistent.

After that, read the written content.

Use the written content only to identify fallback context for unresolved visual gaps, including:

- underlying brand idea
- subject matter
- audience
- cultural or genre context
- recurring written themes
- emotional cues
- positioning signals
- narrative world
- values or perceptions the brand wants to create

Then determine:

- Which stylistic characteristics are directly established by the visuals.
- Which stylistic characteristics are missing or unclear from the visuals.
- Whether the text helps fill those missing or unclear areas.
- Whether any text-derived inference remains compatible with the observed visual identity.
- Whether any text-derived inference should be ignored because it conflicts with the visuals.
- What each major recurring visual pattern communicates.
- Why those visual patterns were likely chosen.
- How those visual patterns should shape viewer perception.
- How the observed spacing, density, crowdedness, white space, and visual weight should translate into keyframe composition.

Base interpretations on recurring evidence.

Prefer conservative conclusions over unsupported speculation.

When visual and textual evidence differ, preserve the visual identity first. Use the text only as fallback for missing or unclear visual information.

Use this internal analysis to synthesize the final prompt rather than simply describing what is visible.

## Output

Write a single reusable visual style prompt of 250-400 words.

The prompt should read like creative direction for an art director, cinematographer, and video keyframe generation model.

The prompt must capture the brand's:

- overall visual identity
- atmosphere
- emotional tone
- subject-world
- audience sensibility
- creative direction
- color system
- lighting
- composition
- camera language
- lens feel
- framing
- depth
- perspective
- white space
- negative space
- visual density
- crowdedness or openness
- visual weight
- spatial compression or breathing room
- implied movement
- keyframe rhythm
- transition-readiness
- materials
- textures
- shape language
- subject treatment
- genre-specific visual conventions, only when visually supported or needed as fallback
- overall artistic direction

The final prompt should express the style as a cohesive visual language that applies specifically to video generation keyframes.

Do not mention the company, brand name, products, services, logos, website, webpages, UI elements, layouts, buttons, navigation, copy, headlines, or specific content.

Do not describe individual website elements.

Do not explain the analysis.

Do not include source weighting in the final output.

Do not say what was visual evidence versus textual fallback evidence.

Do not mention that the text was used as fallback.

Do not include caveats or uncertainty language in the final output unless the visual evidence is genuinely too sparse to form a coherent style.

The result should be a standalone visual style prompt suitable for any video keyframe generation model.

Return ONLY structured JSON conforming to this schema:

{
  "style_prompt": "<the 250-400 word reusable visual style prompt per the guidance above>"
}

The string must be non-empty.`
