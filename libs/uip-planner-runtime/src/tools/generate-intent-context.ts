import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS_LIGHT } from '../model-config'
import { analyzeStyle } from '../tool-internals/analyze-style'
import {
  ArticlePromptFacts,
  renderArticleContextBlock,
} from '../tool-internals/article-prompt-facts'
import { BrandPromptFacts, renderBrandContextBlock } from '../tool-internals/brand-prompt-facts'
import { parseConversationContext } from '../tool-internals/conversation-context'
import { matchPresetByName, type StylePreset } from '../tool-internals/style-catalog'
import type { GlobalConstraints } from '../types'

const logger = createSubLogger('uip-planner-runtime:generate-intent-context')

const GeneratedIntentContextPacingSchema = z.enum([
  'active (3-6s per shot)',
  'fast (2-4s per shot)',
  'moderate (4-8s per shot)',
])

const IntentContextSchema = z.object({
  // `style` and `voice_actor` are NOT produced by the LLM:
  //   - `style` is injected from params.seedStyleInstruction after the call
  //   - voice selection lives outside this spec (UipSession.voiceId)
  global_constraints: z.object({
    video_type: z.string(),
    script_category: z.enum(['object_centric', 'concept_centric']),
    topic: z.string(),
    key_entities: z.array(z.string()),
    geo_scope: z.string(),
    time_scope: z.string(),
    brand_scope: z.string(),
    target_audience: z.string(),
    tone: z.string(),
    script_language: z.string().default(''),
    pacing: GeneratedIntentContextPacingSchema,
    directives: z.array(z.string()),
    must_not_violate: z.array(z.string()),
  }),
  // Deliberately a SIBLING of global_constraints, not a field inside
  // it: it is raw LLM extraction that this tool resolves into `style` on its way
  // out, and keeping it outside the object means it can never reach the spec
  // through the auto-apply artifact mapper (which copies whole
  // global_constraints paths).
  requested_style: z
    .object({
      description: z.string(),
      label: z.string(),
    })
    .nullable()
    .default(null),
})

const GENERATE_INTENT_CONTEXT_PROMPT = `You are an expert bootstrap planner for short explainer videos (30-120 seconds).

Read the shared context once and produce a single canonical GLOBAL RULE set: global_constraints.

Shared Context

{articleContext}{brandContext}Pinned raw user prompt (highest priority, parsed from conversationContext):
{pinnedRawUserPrompt}

Recent conversation context (parsed from conversationContext):
{recentConversationContext}

Latest user message (parsed from conversationContext):
{latestUserMessage}

Script (optional; when present, the primary grounding for topic / key_entities / directives / must_not_violate):
In audio-mode sessions this is the ASR transcript of the user's uploaded voice — treat it as immutable ground truth of intent. Otherwise treat as a draft.
{script}

Asset descriptions (JSON, optional but should be respected when user references uploaded assets):
{assetDescriptionsJson}

Asset context (light JSON):
{assetContextLightJson}

global_constraints must capture:
- video_type
- script_category
- topic
- key_entities
- geo_scope
- time_scope
- brand_scope
- target_audience
- tone
- script_language
- pacing
- directives
- must_not_violate

Rules:
- If script is present, use it as strong evidence for topic, structure, and narrative direction.
- If script is missing, infer topic and overall direction from user intent context and uploaded assets.
- script_language: detect the source script / voice-over language as a short BCP-47-style tag
  when possible (for example "en", "es", "sq", "pt-BR"). Use an empty string if unknown.
- target_audience and video_type must ALWAYS be a best-effort inference from the
  user's prompt, uploaded assets, and topic -- NEVER leave them empty. If the audience
  is genuinely underdetermined, default to a sensible general audience for the topic
  (e.g. "general audience interested in <topic>"); if video_type is unclear, pick the
  closest fitting type. The user sees and can correct both in the brief, so a reasonable
  inferred value is always better than a blank that blocks the pipeline.
- Be specific and grounded in physically plausible scenes; avoid abstract buzzwords.
- Keep output concise and production-usable for downstream shot-level planning.

directives vs must_not_violate — read this carefully, they are easy to confuse:
- directives = the POSITIVE things the user explicitly wants the video to include or do: specific
  opening / ending moments, required on-screen content, colors, transitions, character appearances,
  a required soundtrack, a transformation, etc. Capture these EVEN WHEN the user phrases them with
  "must" / "need to" / "should" — the word "must" does NOT make something a must_not_violate item.
  Each directive is one concise imperative sentence. Reflect explicit user intent, not your own
  speculation. Do NOT extract session-control commands (lock/undo/confirm).
- must_not_violate = PROHIBITIONS / compliance / safety only: things the video must NOT do, almost
  always phrased "no X" / "don't X" / "avoid X". Violating them makes the video unshippable.
    Examples: "no profanity", "no unverified medical claims", "avoid mentioning competitor brand X",
    "no copyrighted music", "no visible logos on the outfit".
- ROUTING RULE: a positive requirement worded with "must" goes to directives, NOT must_not_violate.
  must_not_violate is ONLY for prohibitions. When unsure, ask "is this telling me to DO something
  (-> directives) or to NOT do something (-> must_not_violate)?"
  Examples of correct routing:
    "the video must open with the band"            -> directives
    "the eyes must glow green near the end"        -> directives
    "use the uploaded audio as the soundtrack"     -> directives
    "no visible brand logos on the outfit"         -> must_not_violate
    "do not misrepresent the people in the photos" -> must_not_violate
- Soft aesthetic / tone / pacing rails are NOT must_not_violate items — those are produced downstream
  by the world-bible expert as creative_guardrails.
{pacingRules}

requested_style — the visual style the user EXPLICITLY asked for, in their own words. This is a
sibling of global_constraints, not one of its fields.
- Set it ONLY when the user names or describes a visual medium, technique, or look for the video
  itself: "claymation", "stop-motion", "watercolor", "3D product render", "anime", "shot like a
  1970s film". Use their wording; never upgrade or reinterpret it.
- label: the style's short name, 1-3 words, as the user said it (for example "claymation").
- description: everything they said about how it should look — medium, palette, lighting, texture,
  materials, camera language. Keep their detail and phrasing. Empty string when they named the
  style without describing it.
- Output null when the user asked for no visual style. NEVER infer one from the topic, the brand,
  the audience, or what you think would look good: a style nobody asked for must not appear here,
  because this field OVERRIDES the automatic style selection.
- A style that only exists in an uploaded reference image is NOT this field; describe nothing there.
- Tone words about the video's feel ("energetic", "professional") are not a visual style on their
  own — they belong in tone.

Return JSON only. Do not output markdown.`

// Audio upload markers must not outrank the canonical transcript.
const AUDIO_UPLOAD_MARKER_START_REGEX = /@audio\[[^\]\r\n]*\]\(/g

export async function generateIntentContext(params: {
  /**
   * Optional article source facts.
   * When present, an ARTICLE SOURCE block is prepended to the Shared
   * Context so topic / key entities / directives ground on the pasted
   * article. Null on non-news sessions; the prompt is byte-identical then.
   */
  article?: ArticlePromptFacts | null
  assetContextLightJson: string
  assetDescriptionsJson: string
  /**
   * Optional Tier 1 brand facts. When present, a BRAND CONTEXT block is
   * prepended to the Shared Context so the LLM grounds topic, key
   * entities, and tone against the user's brand. Null on non-brand
   * sessions; the block is left out in that case.
   */
  brand?: BrandPromptFacts | null
  conversationContext: string
  /** Quality tier, forwarded to analyzeStyle for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  /**
   * Project / session id used as the file store prefix for reading the
   * style reference image during the chained `analyze_style` step.
   * Optional so legacy callers without a session context (tests, dry-runs)
   * still work; when omitted, style analysis is skipped even if a style
   * image is present.
   */
  projectId?: string
  /**
   * Optional UIP-v2 substep progress reporter. When present, the tool's
   * per-step awaits report `running`/`done` for the subTools display.
   * Absent (tests, legacy callers) = no reporting, no behavioral change.
   */
  reportSubstep?: SubstepReporter
  script?: null | string
  /**
   * Optional style seed captured at session-creation time. Injected
   * verbatim into `global_constraints.style` after the LLM call -- the LLM
   * itself does not produce a `style` field. If not provided, `style` is left
   * empty and can be filled later via `update_global_field`.
   */
  seedStyleInstruction?: null | {
    style_image_uri?: string
    style_name?: string
    style_text?: string
    style_thumbnail_url?: string
  }
  /**
   * Real UIP session id, forwarded to analyzeStyle purely as the model-routing
   * randomization unit. Distinct from `projectId`, which is the storage prefix.
   */
  sessionId?: string
  // Set by tool-runtime when audio_source=user_audio and the ASR
  // transcript is already seeded.
  stripAudioUploadMarkersInContext?: boolean
  /**
   * Preset catalog the prompt-expressed style is resolved against.
   * Same preset list select_auto_style ranks, read off
   * `spec.meta.style_catalog`. Absent / empty is fine: an unmatched style is
   * applied as free text, so the capture still works without a catalog.
   */
  styleCatalog?: null | StylePreset[]
}): Promise<{
  global_constraints: GlobalConstraints
}> {
  const conversationContext = params.stripAudioUploadMarkersInContext
    ? stripAudioUploadMarkers(params.conversationContext)
    : params.conversationContext
  const parsedContext = parseConversationContext(conversationContext)
  const articleBlock = renderArticleContextBlock(params.article ?? null)
  const brandBlock = renderBrandContextBlock(params.brand ?? null)
  // Single-pass template fill with a FUNCTION replacer: sequential
  // String.replace would rescan already-injected content, so untrusted text
  // (article body, user prompt) containing a literal placeholder token would
  // hijack later replacements, and string replacements would expand `$&`-style
  // patterns. One pass over the pristine template is immune to both.
  const replacements: Record<string, string> = {
    '{articleContext}': articleBlock ? `${articleBlock}\n\n` : '',
    '{assetContextLightJson}': params.assetContextLightJson,
    '{assetDescriptionsJson}': params.assetDescriptionsJson,
    '{brandContext}': brandBlock ? `${brandBlock}\n\n` : '',
    '{latestUserMessage}': parsedContext.latestUserMessage,
    '{pacingRules}': renderPacingRules(),
    '{pinnedRawUserPrompt}': parsedContext.pinnedRawUserPrompt,
    '{recentConversationContext}': parsedContext.recentConversationContext,
    '{script}': params.script?.trim() || '(not available yet)',
  }
  const prompt = GENERATE_INTENT_CONTEXT_PROMPT.replace(
    /\{(?:articleContext|assetContextLightJson|assetDescriptionsJson|brandContext|latestUserMessage|pacingRules|pinnedRawUserPrompt|recentConversationContext|script)\}/g,
    (token) => replacements[token] ?? token,
  )

  logger.info(
    `[uip-intent-context] start promptChars=${prompt.length} hasScript=${Boolean(params.script?.trim())}`,
  )
  const startedAt = Date.now()

  // Run the main intent LLM and the chained style analysis in parallel
  // when a style reference image is present. Style analysis was
  // originally chained after the main call so it could pass the intent
  // summary as `intentAnalysis` -- but NST's
  // style-analysis prompt explicitly treats user/intent context as a
  // low-weight signal (see "Style Authority Rule" at the top of the
  // prompt: the reference image is the sole source of truth for visual
  // style). Passing `intentAnalysis: null` is safe per NST's contract
  // (`IdentifyLongTakeStyleActivityParams.intentAnalysis: null | string`)
  // and shaves the slower of the two LLM calls off every intent-context
  // turn -- the dominant latency saving in the planner loop.
  //
  // Best-effort: failure inside `analyzeStyle` returns null so intent
  // context generation never fails on style analysis alone.
  const styleImageStorePath = params.seedStyleInstruction?.style_image_uri?.trim()
  const userPrompt = parsedContext.pinnedRawUserPrompt || parsedContext.latestUserMessage
  const projectId = params.projectId
  const [result, styleAnalysis] = await Promise.all([
    runSubstep(params.reportSubstep, 'intent_llm', () =>
      completion({
        models: PLANNER_TOOL_MODELS_LIGHT,
        prompt,
        responseFormat: IntentContextSchema,
        reasoningEffort: 'low',
        task: 'user-intent-planner-generate_intent_context',
        temperature: 0.1,
        timeout: 30_000,
      }),
    ),
    styleImageStorePath && projectId
      ? runSubstep(params.reportSubstep, 'style_analysis', () =>
          analyzeStyle({
            intentAnalysis: null,
            modelSelectorTier: params.modelSelectorTier,
            projectId,
            sessionId: params.sessionId,
            styleImageStorePath,
            styleText: params.seedStyleInstruction?.style_text?.trim() ?? null,
            userPrompt,
          }),
        )
      : Promise.resolve(null),
  ])

  logger.info(`[uip-intent-context] done durationMs=${Date.now() - startedAt}`)

  // A style the user asked for in the prompt body, resolved here so
  // it is already applied when the runtime dispatches select_auto_style right
  // after this tool completes. Null on every session where the user named no
  // style, or where a seeded style already owns the slot.
  const promptStyle = resolvePromptStyle({
    catalog: params.styleCatalog ?? [],
    requested: result.requested_style ?? null,
    seed: params.seedStyleInstruction ?? null,
  })
  if (promptStyle) {
    logger.info(
      `[uip-intent-context] captured prompt style name=${promptStyle.style_name} matchedPreset=${promptStyle.matchedPreset}`,
    )
  }

  return {
    global_constraints: {
      ...result.global_constraints,
      // Provenance of a captured style: 'manual', because the user chose it
      // themselves -- that is also what stops a select_auto_style pick already
      // in flight from overwriting it (auto-apply's userCommitted check).
      // `selection_method` carries WHICH user act it was, so the once-per-brief
      // re-pick can leave a prompt-expressed style alone.
      ...(promptStyle
        ? { selection_method: 'user_prompt' as const, style_source: 'manual' as const }
        : {}),
      // style is not produced by the main LLM call; it comes from the
      // user-supplied style seed (or, failing that, the style the user
      // described in their prompt) plus the chained `analyze_style` LLM
      // output (when a style image was provided).
      style: {
        style_name: promptStyle?.style_name ?? params.seedStyleInstruction?.style_name?.trim(),
        style_text: promptStyle?.style_text ?? params.seedStyleInstruction?.style_text?.trim(),
        style_thumbnail_url:
          promptStyle?.style_thumbnail_url ??
          params.seedStyleInstruction?.style_thumbnail_url?.trim(),
        ...(styleAnalysis
          ? {
              color_palette: styleAnalysis.color_palette,
              key_style_tags: styleAnalysis.key_style_tags,
              reproduction_guidance: styleAnalysis.reproduction_guidance ?? null,
              reusable_prompt: styleAnalysis.reusable_style_prompt,
              style_description: styleAnalysis.style_description,
            }
          : {}),
      },
      // Brand fields are owned by the workflow, not this LLM call. Initialize
      // to null; the planner sets `brand_extraction_input` via a separate
      // patch once it classifies brand intent.
      brand_extraction_input: null,
      brand_extraction_status: null,
      brand_extraction_failure_reason: null,
      brand_extraction_started_at: null,
      brand_extraction_run_id: null,
      brand_extraction_retry_count: 0,
      brand_source_change_count: 0,
      brand_reextraction_pending: false,
      brand_extraction_declined: false,
      brand_bank: null,
      brand_bank_source: null,
      brand_bank_locked_at: null,
      brand_style_directive: null,
      brand_style_text: null,
      brand_style_preview_url: null,
      brand_video_type: null,
      brand_carry_state: null,
    },
  }
}

export function stripAudioUploadMarkers(input: string): string {
  let stripped = ''
  let cursor = 0
  for (const match of input.matchAll(AUDIO_UPLOAD_MARKER_START_REGEX)) {
    if (match.index < cursor) {
      continue
    }
    const end = findAudioUploadMarkerEnd(input, match.index + match[0].length)
    if (end !== -1) {
      stripped += input.slice(cursor, match.index)
      cursor = end
    }
  }
  return (stripped + input.slice(cursor))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function findAudioUploadMarkerEnd(input: string, start: number): number {
  let depth = 1
  let encodedDepth = 0
  let end = start
  // The next character can be user text, not a separator.
  // Balance URL parentheses before deciding where the marker closes.
  while (end < input.length && depth > 0) {
    const char = input[end]
    if (char === '\n' || char === '\r') {
      break
    }
    // Stored URLs may encode only the closing parenthesis, or both sides.
    if (input.startsWith('%28', end)) {
      encodedDepth++
      end += 3
      continue
    }
    if (input.startsWith('%29', end)) {
      if (encodedDepth > 0) {
        encodedDepth--
      } else if (depth > 1) {
        depth--
      }
      end += 3
      continue
    }
    if (char === '(') {
      depth++
    }
    if (char === ')') {
      depth--
    }
    end++
  }
  return depth === 0 ? end : -1
}

function renderPacingRules(): string {
  return [
    '- pacing is a visual shot-duration target for the downstream beat-sheet expert. Pick exactly one of:',
    '  - "active (3-6s per shot)"   -- typical explainer rhythm',
    '  - "fast (2-4s per shot)"     -- punchy, high-energy, many cuts',
    '  - "moderate (4-8s per shot)" -- relaxed, contemplative',
    '- Select based on the script energy / the user stated pace.',
    '- Do not output any other pacing value.',
  ].join('\n')
}

/**
 * Word count at which the user's own style description REPLACES a matched
 * preset's curated `styleText` rather than being appended to it. A bare
 * "claymation" carries less production signal than the catalog entry written
 * for the image model, but a real description ("gritty handcrafted claymation,
 * visible clay fingerprints, cinematic rim light") carries MORE: it is the
 * user's actual intent, and flattening it back to the preset text is how
 * the request got lost in the first place.
 */
const RICH_STYLE_DESCRIPTION_WORDS = 8

interface ResolvedPromptStyle {
  /** True when the description resolved to a catalog preset (id + thumbnail). */
  matchedPreset: boolean
  style_name: string
  style_text: string
  style_thumbnail_url: string
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

/**
 * `style_text` for a matched preset. A short description is APPENDED to the
 * curated text rather than dropped: "claymation, black and white" carries a
 * real instruction in three words, and choosing the preset's own (warm-palette)
 * text over it would lose the only colour direction the user gave -- the same
 * silent-drop failure this feature exists to fix. A description long enough to
 * stand on its own replaces the preset text instead of fighting it.
 */
function presetStyleText(preset: StylePreset, description: string): string {
  if (description === '') {
    return preset.styleText
  }
  if (countWords(description) >= RICH_STYLE_DESCRIPTION_WORDS) {
    return description
  }
  return `${preset.styleText}\n\nUser direction: ${description}`
}

/**
 * Turn the style the user described in their prompt into an applied `style`.
 *
 * A seeded style always wins: picking a preset (or uploading a style image) in
 * the composer is a deliberate UI act, and silently overriding it from prose
 * would be the same class of bug in the other direction. Style conflicts in
 * seeded sessions are surfaced by the planner instead, not resolved here.
 *
 * With no seed, a name that resolves to a preset keeps that preset's identity
 * (id + thumbnail) so the candidates rail can render and highlight it, while a
 * description rich enough to beat the preset's own wording is kept as
 * `style_text`. An unmatched style is applied as free text with no thumbnail --
 * the rail already renders thumbnail-less cards.
 */
function resolvePromptStyle(input: {
  catalog: StylePreset[]
  requested: null | { description: string; label: string }
  seed:
    | null
    | undefined
    | {
        style_image_uri?: string
        style_name?: string
        style_text?: string
        style_thumbnail_url?: string
      }
}): null | ResolvedPromptStyle {
  const { requested, seed } = input
  if (!requested) {
    return null
  }
  const seeded =
    (seed?.style_name?.trim() ?? '') !== '' ||
    (seed?.style_text?.trim() ?? '') !== '' ||
    (seed?.style_image_uri?.trim() ?? '') !== ''
  if (seeded) {
    return null
  }

  const label = requested.label.trim()
  const description = requested.description.trim()
  if (label === '' && description === '') {
    return null
  }

  const preset = matchPresetByName(input.catalog, label)
  if (preset) {
    return {
      matchedPreset: true,
      style_name: preset.id,
      style_text: presetStyleText(preset, description),
      style_thumbnail_url: preset.thumbnailUrl,
    }
  }

  return {
    matchedPreset: false,
    style_name: label,
    style_text: description || label,
    style_thumbnail_url: '',
  }
}
