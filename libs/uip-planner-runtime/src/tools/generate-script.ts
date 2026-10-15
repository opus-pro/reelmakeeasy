/**
 * UIP `generate_explainer_script` tool -- single-phase script generation.
 *
 * Earlier versions ran a two-phase pipeline (a Phase 1 classifier that
 * detected user-pasted scripts AND picked a V4 track, plus a Phase 2
 * generator that routed by track). That has been replaced with a single
 * LLM call against a unified prompt. Rationale:
 *
 * - SCRIPT DETECTION (passthrough vs generate) is now embedded directly
 *   in the script prompt's first section -- one LLM call covers both
 *   the detection and the action.
 * - V4 track selection has been removed entirely. Track-specific shaping
 *   was high-maintenance for marginal benefit; the new prompt's RULES
 *   block handles category-agnostic style requirements (spoken words
 *   only, ad CTA, factual grounding) directly.
 * - Script-direction refinement Q&A (the "ask up to 2 questions before
 *   writing" pattern) has moved up into the planner's mode_confirmation
 *   phase (see mode-confirmation-prompt section 2.6). By the time this tool
 *   runs, the planner has already gathered the direction it needed; the
 *   tool itself is single-shot WRITE.
 *
 * The tool keeps the existing FULL / PARTIAL scope split: FULL is used
 * during bootstrap_script (and refinement full-script refresh), PARTIAL
 * for refinement scope=SHOT_IDS / SHOT_RANGE rewrites. Both flavors call
 * the same single LLM with a scope-specific prompt body.
 */

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { narrationRatePerMinute } from '@reelmakeeasy/common/story-mode/long-video-attribution'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { evaluateAndTrimScript } from '@reelmakeeasy/common/utils/script-limits-core'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'
import { z } from 'zod'

import { SCRIPT_TOOL_MODELS } from '../model-config'
import {
  type DurationSource,
  estimatePastedScriptNaturalDurationSeconds,
} from '../runtime/pasted-script-duration'
import { ArticlePromptFacts } from '../tool-internals/article-prompt-facts'
import { BrandPromptFacts } from '../tool-internals/brand-prompt-facts'
import { parseConversationContext } from '../tool-internals/conversation-context'
import { extractPastedScript } from '../tool-internals/extract-pasted-script'
import {
  buildFullScopeScriptPrompt,
  buildPartialScopeScriptPrompt,
  ScriptReferenceImage,
} from '../tool-internals/script-generation-prompt'
import { SCRIPT_WORD_CAP } from '../tool-internals/script-word-cap-audit'
import {
  applyRequestedTtsMarkupToText,
  extractRequestedTtsMarkup,
} from '../tool-internals/tts-markup'
import { Message, PlannerToolParams, ScriptShotEdit } from '../types'
import { computeWordCountBudget, countWords } from '../word-budget'

const logger = createSubLogger('uip-planner-runtime:generate-script')

/**
 * Tightened from 1.2x. Previously the prompt told the LLM the cap was
 * 1.2x the target (so target=1085 -> cap=1302). LLMs treat "cap" as
 * permission and routinely overshot it by another 20-30%, landing
 * above what users selected in the duration picker. 1.05x keeps the
 * cap close to target so the LLM has minimal room to over-aim; the
 * real defenses are the rewrite + sentence-trim safety net below.
 */
const MAX_WORDS_OVERSHOOT_RATIO = 1.05

const DEFAULT_TARGET_WORDS = 200
const DEFAULT_MAX_WORDS = Math.round(DEFAULT_TARGET_WORDS * MAX_WORDS_OVERSHOOT_RATIO)
export type { ScriptReferenceImage } from '../tool-internals/script-generation-prompt'

export interface GenerateScriptOptions {
  /**
   * Optional article source facts.
   * When present, an ARTICLE SOURCE block is threaded into the script
   * prompt so the script states what the article states -- the article
   * text is the authoritative source for factual claims.
   */
  article?: ArticlePromptFacts | null
  /**
   * Optional Tier 1 brand facts. When present, a BRAND CONTEXT block is
   * threaded into the script prompt to ground copy in the user's brand
   * (business name, about, CTA, narrative arc). Also disables web search
   * grounding (`enableSearch: false`) -- the brand_bank is the
   * authoritative source for factual claims in brand sessions.
   */
  brand?: BrandPromptFacts | null
  conversationContext?: string
  /**
   * Recent transcript (mode_confirmation Q&A + post-confirmation user
   * messages). Threaded into the prompt's CHAT CONTEXT block so the
   * LLM can read direction-refinement answers in context.
   */
  conversationHistory: Message[]
  /**
   * `spec.meta.mode_state.duration_seconds`. When set, drives word
   * budget via `duration_seconds/60 * WPM`; otherwise falls back to a
   * neutral default.
   */
  durationSeconds?: null | number
  /**
   * Session-pinned transcript voice preview gate. When true, the prompt may
   * allow supported inline TTS markup, but only when the user explicitly asks
   * for emotion tags, pronunciation mapping, or voice direction.
   */
  enableTtsMarkup?: boolean
  /**
   * Existing shots as seen by the tool-runtime caller (usually
   * `session.spec.visual_script.shots`), JSON-stringified. Used for
   * PARTIAL scope target-id resolution and per-shot word-budget hint.
   */
  existingShotsJson?: string
  /**
   * Optional reference image descriptions from describe_uploaded_images.
   * Threaded into the prompt so the LLM can ground the script in the
   * user's uploads.
   */
  imageAnalyses?: ScriptReferenceImage[]
  /**
   * Session-pinned `input_type` from mode-confirmation (see
   * mode-confirmation-prompt.ts section 2.6). Bootstrap calls with
   * `script_only` / `prompt_and_script` route through the pasted-script
   * extractor; null (legacy sessions) keeps the legacy behavior.
   */
  inputType?:
    | 'audio_music'
    | 'audio_script'
    | 'prompt_and_script'
    | 'prompt_only'
    | 'script_only'
    | null
  params: PlannerToolParams
  /** Semantic provenance used to retain a user-requested expansion budget. */
  pastedScriptDurationSource?: DurationSource | null
  /** Runtime-verified permission for duration-derived pasted-script rewriting. */
  pastedScriptFit?: 'preserve' | 'rewrite_to_duration' | null
  previousScript?: string
  /** Session id for telemetry only. Optional for tests. */
  projectId?: string
  /**
   * Optional UIP-v2 substep progress reporter (Task 6 wiring). When
   * present, the tool's per-step awaits report `running`/`done` for the
   * subTools display. Absent (tests, legacy callers) = no reporting, no
   * behavioral change.
   */
  reportSubstep?: SubstepReporter
  /**
   * Planner-set gate for the pasted-script extractor in the NON-bootstrap
   * phases (script_review / refinement). Default off: when false/undefined
   * the extractor LLM call is skipped and the tool writes/rewrites from
   * intent. The bootstrap path ignores this and gates on `inputType`.
   */
  runExtractor?: boolean
  /**
   * Structured brief (global_constraints), JSON-stringified. Produced
   * by `generate_intent_context` before this tool runs.
   */
  structuredBriefJson: string
  /** Trusted runtime extraction; consumed only when preservation was verified. */
  verifiedPastedScript?: null | {
    script: string
    shotEdits: ScriptShotEdit[]
  }
}

export interface GenerateScriptResult {
  script: string
  shot_edits: ScriptShotEdit[]
}

// Pasted-script extractor wiring. Types live up here (next to GenerateScript*)
// so eslint sort-modules doesn't re-interleave them with later
// functions and detach their JSDocs.
type ExtractorOutcome = ExtractorPreserveOutcome | ExtractorRewriteOutcome | null

interface ExtractorPreserveOutcome {
  kind: 'preserve'
  script: string
  shot_edits: ScriptShotEdit[]
}

interface ExtractorRewriteOutcome {
  kind: 'rewrite'
  script: string
}

interface MaybeExtractInput {
  effectiveMaxScriptWords: number
  fullCoverage: boolean
  inputType: null | string
  isBootstrap: boolean
  latestUserMessage: string
  pastedScriptFit?: 'preserve' | 'rewrite_to_duration' | null
  previousScript: null | string
  projectId: string
  rawUserPrompt: string
  reportSubstep?: SubstepReporter
  /** Planner gate for the non-bootstrap (script_review / refinement) path. */
  runExtractor: boolean
  /** Runtime-owned duration selected for a verified rewrite. */
  targetDurationSeconds?: null | number
  /**
   * The target-duration word cap (budget.maxWords). It participates only when
   * pastedScriptFit explicitly authorizes rewrite_to_duration; the absolute TTS
   * cap is enforced independently for every pasted script.
   */
  targetMaxWords?: number
}

export async function generateExplainerScript(
  options: GenerateScriptOptions,
): Promise<GenerateScriptResult> {
  const { params, durationSeconds } = options
  const parsedContext = parseConversationContext(options?.conversationContext?.trim() || '')
  const rawUserPrompt = pickRawInput(parsedContext)
  const existingShotsJson = options?.existingShotsJson?.trim() || '[]'
  let previousScript = options?.previousScript?.trim() || '(none)'
  const existingShots = extractExistingShots(existingShotsJson)
  const existingShotIds = existingShots.map((shot) => shot.shot_id)
  const targetShotIds = resolveTargetShotIds(params, existingShotIds)
  const fullCoverage = isFullScopeOrCoverage(params, existingShotIds, targetShotIds)
  // Single TTS-vendor word ceiling (1700) for every session.
  const effectiveMaxScriptWords = EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords
  // `script_language` (from the brief) sizes the word budget at the CJK rate
  // for non-space-separated languages -- otherwise a Chinese target is
  // budgeted at the English 150-wpm rate and comes back ~half-length.
  const scriptLanguage = parseScriptLanguage(options.structuredBriefJson)
  let budget = computeWordBudget(durationSeconds ?? null, effectiveMaxScriptWords, scriptLanguage)
  let budgetDurationSeconds = durationSeconds ?? null

  const isBootstrap = previousScript === '(none)'
  const detectedTtsMarkup = extractRequestedTtsMarkup(
    [
      rawUserPrompt,
      parsedContext.latestUserMessage,
      parsedContext.recentConversationContext,
      ...options.conversationHistory.map((message) => message.content),
    ].join('\n'),
  )
  const requestedTtsMarkup = options.enableTtsMarkup === true ? detectedTtsMarkup : null
  logger.info(
    `[uip-script] tts markup projectId=${options.projectId ?? 'unknown'} enabled=${options.enableTtsMarkup === true} detectedEmotion=${detectedTtsMarkup?.emotion ?? 'none'} detectedPronunciations=${detectedTtsMarkup?.pronunciations.length ?? 0}`,
  )

  // Run the pasted-script extractor first. preserve -> return
  // the extracted script verbatim; rewrite -> swap in as previousScript
  // for the CREATIVE path; null / no_paste -> fall through unchanged.
  const extractorOutcome =
    options.pastedScriptFit === 'preserve' && options.verifiedPastedScript?.script.trim()
      ? {
          kind: 'preserve' as const,
          script: options.verifiedPastedScript.script,
          shot_edits: options.verifiedPastedScript.shotEdits,
        }
      : await maybeExtractPastedScript({
          fullCoverage,
          isBootstrap,
          inputType: options.inputType ?? null,
          rawUserPrompt,
          latestUserMessage: parsedContext.latestUserMessage,
          pastedScriptFit: options.pastedScriptFit ?? null,
          previousScript: isBootstrap ? null : previousScript,
          effectiveMaxScriptWords,
          runExtractor: options.runExtractor === true,
          projectId: options.projectId ?? 'unknown',
          reportSubstep: options.reportSubstep,
          targetDurationSeconds: budgetDurationSeconds,
          targetMaxWords: budget.maxWords,
        })
  if (extractorOutcome?.kind === 'preserve') {
    logger.info(
      `[uip-script] extract_and_preserve short-circuit scriptChars=${extractorOutcome.script.length} shotEdits=${extractorOutcome.shot_edits.length}`,
    )
    return {
      script: applyRequestedTtsMarkupToText(extractorOutcome.script, requestedTtsMarkup, {
        addEmotion: true,
      }),
      shot_edits: extractorOutcome.shot_edits.map((edit, index) => ({
        ...edit,
        audio_vo: applyRequestedTtsMarkupToText(edit.audio_vo, requestedTtsMarkup, {
          addEmotion: index === 0,
        }),
      })),
    }
  }
  if (extractorOutcome?.kind === 'rewrite') {
    logger.info(
      `[uip-script] extract_and_rewrite -- feeding extracted script as previousScript to CREATIVE path scriptChars=${extractorOutcome.script.length}`,
    )
    previousScript = extractorOutcome.script
    if (!shouldUseDurationBudgetForPastedRewrite(options, extractorOutcome.script)) {
      budget = computeSourceRewriteBudget(extractorOutcome.script, effectiveMaxScriptWords)
      budgetDurationSeconds = null
    }
  }

  // edit_mode comes from the planner. The old label-regex auto-promotion
  // to EXACT was removed -- the extractor above subsumes it.
  const editMode: 'CREATIVE' | 'EXACT' = params.edit_mode === 'EXACT' ? 'EXACT' : 'CREATIVE'
  const exactLocks = (params.exact_locks ?? []).map((lock) => ({
    shot_id: lock.shot_id,
    text: lock.text,
  }))

  const globalShotWordBudgetJson = serializeGlobalShotWordBudget(existingShots)

  const prompt = fullCoverage
    ? buildFullScopeScriptPrompt({
        scope: 'FULL',
        article: options.article ?? null,
        brand: options.brand ?? null,
        budget,
        durationSeconds: budgetDurationSeconds,
        rawUserPrompt,
        structuredBrief: options.structuredBriefJson,
        imageAnalyses: options.imageAnalyses,
        conversationHistory: options.conversationHistory,
        editMode,
        exactLocks,
        existingShotsJson,
        globalShotWordBudgetJson,
        previousScript,
        effectiveMaxScriptWords,
        enableTtsMarkup: options.enableTtsMarkup === true,
      })
    : buildPartialScopeScriptPrompt({
        scope: 'PARTIAL',
        article: options.article ?? null,
        brand: options.brand ?? null,
        budget,
        durationSeconds: budgetDurationSeconds,
        rawUserPrompt,
        structuredBrief: options.structuredBriefJson,
        imageAnalyses: options.imageAnalyses,
        conversationHistory: options.conversationHistory,
        targetShotIds,
        editMode,
        exactLocks,
        existingShotsJson,
        globalShotWordBudgetJson,
        previousScript,
        wordCapBudget: computePartialRewriteHeadroom(
          existingShots,
          targetShotIds,
          effectiveMaxScriptWords,
        ),
        effectiveMaxScriptWords,
        enableTtsMarkup: options.enableTtsMarkup === true,
      })

  // Temperature policy mirrors the legacy code:
  //   FULL  + CREATIVE -> 0.9 (more divergent generation)
  //   FULL  + EXACT    -> 0.3 (user content must be kept verbatim; less drift)
  //   PARTIAL          -> 0.3 (edit existing script; style-consistency)
  const temperature = fullCoverage ? (editMode === 'EXACT' ? 0.3 : 0.9) : 0.3

  const startedAt = Date.now()
  const timeoutMs = computeScriptToolTimeoutMs(budget.targetWords)
  logger.info(
    `[uip-script] generate start scope=${fullCoverage ? 'FULL' : 'PARTIAL'} promptChars=${prompt.length} targetWords=${budget.targetWords} maxWords=${budget.maxWords} temperature=${temperature} timeoutMs=${timeoutMs}`,
  )

  // Single LLM call. enableSearch grounds factual claims against the live
  // web (product specs, brand details, public-figure facts) -- the script
  // tool's RULES forbid inventing stats, so search is the only way to
  // pull in facts beyond the brief.
  //
  // Flipped off when a brand_bank is present: the BRAND CONTEXT
  // block in the prompt provides authoritative facts for the user's
  // brand, and live-web grounding risks pulling in stale / wrong details
  // about the same business (about-page changes, outdated product specs,
  // unrelated namesakes).
  const result = await runSubstep(options.reportSubstep, 'main_llm', () =>
    completion({
      models: SCRIPT_TOOL_MODELS,
      prompt,
      responseFormat: ScriptOutputSchema,
      reasoningEffort: 'low',
      task: 'user-intent-planner-generate-script',
      temperature,
      // Timeout scales with target word count. Web-search + reasoning + a
      // ~1000-word structured output regularly takes 60-150s on the slow
      // tail; a flat 30s caused every retry across gpt-5.5 / seed-2 /
      // gemini-3.1-pro to abort on long scripts. Now: 60s base
      // + 0.1s per target word, clamped [60s, 300s].
      timeout: timeoutMs,
      enableSearch: !options.brand,
    }),
  )

  // Word-count defense chain. LLMs cannot reliably hit a stated word
  // cap; a 1700-word "max" routinely produces 2000+ words. We don't
  // use maxTokens (it cuts mid-thought / mid-reasoning) so the cap is
  // enforced post-hoc:
  //   1. If over maxWords, ask the LLM to rewrite, aiming for 85% of cap.
  //   2. If still over, sentence-boundary trim with evaluateAndTrimScript.
  // Only the first generation pays the rewrite cost; common case (already
  // under cap) is a no-op.
  result.script = await enforceScriptLengthCap({
    script: result.script,
    targetWords: budget.targetWords,
    maxWords: budget.maxWords,
    temperature,
    enableTtsMarkup: options.enableTtsMarkup === true,
    reportSubstep: options.reportSubstep,
  })
  result.script = applyRequestedTtsMarkupToText(result.script, requestedTtsMarkup, {
    addEmotion: true,
  })

  let normalizedShotEdits = (result.shot_edits ?? []).map((edit) => ({
    shot_id: edit.shot_id.trim(),
    audio_vo: edit.audio_vo.trim(),
  }))
  if (!fullCoverage) {
    // For PARTIAL, constrain shot_edits to the target set in case the LLM
    // strays outside scope.
    const targetSet = new Set(targetShotIds)
    normalizedShotEdits = normalizedShotEdits.filter((edit) => targetSet.has(edit.shot_id))
  }
  // FULL-scope shot_edits inventions are not blocked here. The script
  // tool's prompt is responsible for the contract (default to `[]`,
  // populate only when the user clearly pre-segmented their pasted
  // script). Any inconsistency between non-empty shot_edits and the
  // downstream visual-script tool's natural segmentation is caught by
  // `validateFixedSegmentsForFullVs` (tool-runtime.ts) after the VS
  // tool runs. Mirrors main's behavior.
  normalizedShotEdits = normalizedShotEdits.map((edit, index) => ({
    ...edit,
    audio_vo: applyRequestedTtsMarkupToText(edit.audio_vo, requestedTtsMarkup, {
      addEmotion: index === 0,
    }),
  }))

  logger.info(
    `[uip-script] generate done durationMs=${Date.now() - startedAt} scriptChars=${result.script.length} shotEdits=${normalizedShotEdits.length}`,
  )

  return {
    script: result.script.trim(),
    shot_edits: normalizedShotEdits,
  }
}

const ScriptOutputSchema = z.object({
  script: z.string().trim().min(1),
  shot_edits: z
    .array(
      z.object({
        shot_id: z.string().trim().min(1),
        audio_vo: z.string().trim().min(1),
      }),
    )
    .default([]),
})

/**
 * Word-budget for the script LLM. Two layers:
 * 1. Convert `duration_seconds` into a "natural" word count at the
 *    language-appropriate narration rate (`narrationRatePerMinute`): 150 wpm
 *    for space-separated languages, 300 chars/min for CJK (where `countWords`
 *    counts each character as a word). Sizing a Chinese target at the English
 *    150-wpm rate under-provisions it by half -- a 90s zh video came back
 *    ~56s, trimmed mid-sentence.
 * 2. Cap both target and max at SCRIPT_WORD_CAP (1700) -- the
 *    downstream TTS vendor's per-video hard limit. Without this cap,
 *    a long confirmed duration would imply more words than the vendor
 *    allows, so the first-pass script would ship over the cap, fail
 *    the post-script word-cap audit, and disable the "Create video"
 *    CTA.
 *
 * Exported for unit tests that lock the cap-clamp behavior.
 */
export function computeWordBudget(
  durationSeconds: null | number,
  effectiveMaxWords: number = SCRIPT_WORD_CAP,
  scriptLanguage?: null | string,
): {
  maxWords: number
  targetWords: number
} {
  // Clamp the caller-supplied cap to the codebase ceiling (SCRIPT_WORD_CAP,
  // 1700) to defend against bad upstream inputs.
  const effectiveCap = Math.min(SCRIPT_WORD_CAP, Math.max(1, Math.round(effectiveMaxWords)))
  if (!durationSeconds || durationSeconds <= 0) {
    return {
      targetWords: Math.min(DEFAULT_TARGET_WORDS, effectiveCap),
      maxWords: Math.min(DEFAULT_MAX_WORDS, effectiveCap),
    }
  }
  const wordsPerMinute = narrationRatePerMinute(scriptLanguage)
  const naturalTarget = Math.max(1, Math.round((durationSeconds / 60) * wordsPerMinute))
  const targetWords = Math.min(naturalTarget, effectiveCap)
  const maxWords = Math.min(Math.round(targetWords * MAX_WORDS_OVERSHOOT_RATIO), effectiveCap)
  return { targetWords, maxWords }
}

function computeSourceRewriteBudget(
  sourceScript: string,
  effectiveMaxWords: number,
): { maxWords: number; targetWords: number } {
  const effectiveCap = Math.min(SCRIPT_WORD_CAP, Math.max(1, Math.round(effectiveMaxWords)))
  const targetWords = Math.min(Math.max(1, countWords(sourceScript)), effectiveCap)
  return {
    targetWords,
    maxWords: Math.min(Math.round(targetWords * MAX_WORDS_OVERSHOOT_RATIO), effectiveCap),
  }
}

function shouldUseDurationBudgetForPastedRewrite(
  options: Pick<
    GenerateScriptOptions,
    'durationSeconds' | 'pastedScriptDurationSource' | 'pastedScriptFit'
  >,
  sourceScript: string,
): boolean {
  if (options.pastedScriptFit === 'rewrite_to_duration') {
    return true
  }
  if (
    options.pastedScriptDurationSource !== 'user_explicit' ||
    !options.durationSeconds ||
    options.durationSeconds <= 0
  ) {
    return false
  }
  const naturalDurationSeconds = estimatePastedScriptNaturalDurationSeconds(sourceScript)
  return options.durationSeconds >= naturalDurationSeconds
}

/**
 * Per-call timeout (ms) for the script-writing LLM, scaled by target word
 * count. Web-search + reasoning + structured output has a baseline cost
 * (~60s for round-trip + first-token) plus a per-output-word cost
 * (~0.1s/word on the observed slow tail across gpt-5.5 / seed-2 /
 * gemini-3.1-pro). Clamped to [60s, 300s] so even a default-target call
 * still gets enough room and an extreme overshoot can't run forever.
 *
 * Empirical observations:
 * - 200 target words ->  80s (default short-form)
 * - 1000 target words -> 160s (~6.5 min video)
 * - 1700 target words -> 230s (absolute SCRIPT_WORD_CAP; duration varies by rate)
 * - clamped to 300s above 2400 target words (defensive)
 *
 * Exported for unit tests that lock the formula's boundary behavior.
 */
export function computeScriptToolTimeoutMs(targetWords: number): number {
  const BASE_SECONDS = 60
  const SECONDS_PER_TARGET_WORD = 0.1
  const MIN_SECONDS = 60
  const MAX_SECONDS = 300
  const positive = Math.max(0, targetWords || 0)
  const raw = BASE_SECONDS + positive * SECONDS_PER_TARGET_WORD
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, raw))
  return Math.round(seconds) * 1000
}

function extractExistingShots(
  existingShotsJson: string,
): Array<{ audio_vo: string; shot_id: string }> {
  try {
    const parsed = JSON.parse(existingShotsJson) as Array<{
      audio_vo?: unknown
      shot_id?: unknown
    }>
    return parsed
      .map((item) => ({
        shot_id: typeof item.shot_id === 'string' ? item.shot_id.trim() : '',
        audio_vo: typeof item.audio_vo === 'string' ? item.audio_vo.trim() : '',
      }))
      .filter((item) => item.shot_id.length > 0)
  } catch {
    return []
  }
}

function isFullScopeOrCoverage(
  params: PlannerToolParams,
  existingShotIds: string[],
  targetShotIds: string[],
): boolean {
  if (params.scope === 'FULL') {
    return true
  }

  if (existingShotIds.length === 0) {
    return false
  }

  const existingSet = new Set(existingShotIds)
  const targetSet = new Set(targetShotIds)
  return targetSet.size === existingSet.size && [...existingSet].every((id) => targetSet.has(id))
}

/**
 * Pull `script_language` (a BCP-47 code like `zh` / `en`) out of the
 * structured brief (`global_constraints`) so the word budget can pick the
 * right narration rate. Returns undefined on missing/invalid input, which
 * keeps the English 150-wpm default.
 */
function parseScriptLanguage(structuredBriefJson: string): string | undefined {
  try {
    const brief = JSON.parse(structuredBriefJson) as { script_language?: unknown }
    return typeof brief.script_language === 'string' ? brief.script_language : undefined
  } catch {
    return undefined
  }
}

function pickRawInput(parsed: ReturnType<typeof parseConversationContext>): string {
  return (
    parsed.pinnedRawUserPrompt?.trim() ||
    parsed.latestUserMessage?.trim() ||
    parsed.recentConversationContext?.trim() ||
    ''
  )
}

/**
 * Pasted-script extractor trigger gate + outcome translation. Skips when the call
 * doesn't cover all shots (`!fullCoverage` -- PARTIAL scope, or
 * SHOT_IDS that doesn't actually cover every shot), on bootstrap
 * when `inputType` isn't a paste class, and on script_review /
 * refinement when the planner did not set `run_extractor` (i.e. the
 * message is an edit instruction, not a full-script paste).
 */
export async function maybeExtractPastedScript(
  input: MaybeExtractInput,
): Promise<ExtractorOutcome> {
  if (!input.fullCoverage) {
    return null
  }

  let candidate: string
  if (input.isBootstrap) {
    if (input.inputType !== 'script_only' && input.inputType !== 'prompt_and_script') {
      return null
    }
    candidate = input.rawUserPrompt.trim()
  } else {
    // script_review / refinement: the planner explicitly opts in when the
    // user's message is a full-script paste (replaces the old >=30-word
    // heuristic, which misfired on long edit instructions). Default off.
    if (!input.runExtractor) {
      return null
    }
    const latest = input.latestUserMessage?.trim() ?? ''
    if (!latest || latest === '(not available)') {
      return null
    }
    candidate = latest
  }

  if (!candidate) {
    return null
  }

  const extraction = await runSubstep(input.reportSubstep, 'extractor_llm', () =>
    extractPastedScript({
      rawText: candidate,
      previousScript: input.previousScript,
      isBootstrap: input.isBootstrap,
      effectiveMaxScriptWords: input.effectiveMaxScriptWords,
      projectId: input.projectId,
    }),
  )

  if (!extraction || extraction.outcome === 'no_paste_detected') {
    return null
  }

  // Trim only to gate emptiness -- the original `extraction.script`
  // is what flows downstream so the byte-for-byte contract holds
  // for any leading / trailing whitespace the user pasted.
  if (!extraction.script.trim()) {
    // Empty script with a non-null outcome means the model lied;
    // fall through to the legacy main-prompt path.
    return null
  }

  if (extraction.outcome === 'extract_and_preserve') {
    const scriptWordCount = countWords(extraction.script)
    const exceedsAbsoluteCap = scriptWordCount > input.effectiveMaxScriptWords
    const exceedsRequestedDuration =
      input.targetDurationSeconds != null &&
      input.targetDurationSeconds > 0 &&
      estimatePastedScriptNaturalDurationSeconds(extraction.script) > input.targetDurationSeconds
    const exceedsPermittedDurationCap =
      input.pastedScriptFit === 'rewrite_to_duration' &&
      (exceedsRequestedDuration ||
        (input.targetDurationSeconds == null &&
          scriptWordCount > (input.targetMaxWords ?? input.effectiveMaxScriptWords)))
    if (exceedsAbsoluteCap || exceedsPermittedDurationCap) {
      return { kind: 'rewrite', script: extraction.script }
    }
    // shot_id / audio_vo are token-like fields the schema already
    // requires non-empty; trim defensively so a stray newline from
    // the LLM does not produce a shot label with leading whitespace.
    const normalizedShotEdits: ScriptShotEdit[] = extraction.shot_edits.map((edit) => ({
      shot_id: edit.shot_id.trim(),
      audio_vo: edit.audio_vo.trim(),
    }))
    return { kind: 'preserve', script: extraction.script, shot_edits: normalizedShotEdits }
  }

  return { kind: 'rewrite', script: extraction.script }
}

function resolveTargetShotIds(params: PlannerToolParams, existingShotIds: string[]): string[] {
  if (params.scope === 'FULL') {
    return [...existingShotIds]
  }

  if (params.scope === 'SHOT_IDS') {
    return (params.shot_ids ?? []).filter((id) => existingShotIds.includes(id))
  }

  if (!params.from_shot_id || !params.to_shot_id) {
    return []
  }

  const fromIndex = existingShotIds.indexOf(params.from_shot_id)
  const toIndex = existingShotIds.indexOf(params.to_shot_id)
  if (fromIndex === -1 || toIndex === -1) {
    return []
  }
  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)
  return existingShotIds.slice(start, end + 1)
}

function serializeGlobalShotWordBudget(
  existingShots: Array<{ audio_vo: string; shot_id: string }>,
): string {
  if (existingShots.length === 0) {
    return '(no existing shots)'
  }
  const budget = computeWordCountBudget(existingShots.map((shot) => shot.audio_vo))
  return budget ? JSON.stringify(budget, null, 2) : '(not applicable)'
}

/**
 * Compute the PARTIAL rewrite's word-cap headroom against
 * SCRIPT_WORD_CAP. The merged script returned by the script tool
 * concatenates rewritten target shots with non-target shots verbatim;
 * the cap applies to the merged total. Non-target shots are immutable
 * from the LLM's POV, so the rewritten target shots have a fixed
 * headroom of `SCRIPT_WORD_CAP - sum(non-target words)`.
 *
 * If non-target shots already exceed the cap (legacy data, or a
 * previous edit that slipped through), `rewriteHeadroom` clamps to 0
 * -- the LLM should write the shortest possible target rewrite. The
 * post-script word-cap audit will still flag the over-cap state, but
 * we do not make it worse.
 *
 * Exported for unit tests.
 */
export function computePartialRewriteHeadroom(
  existingShots: Array<{ audio_vo: string; shot_id: string }>,
  targetShotIds: string[],
  effectiveCap: number = SCRIPT_WORD_CAP,
): { nonTargetWordCount: number; rewriteHeadroom: number; targetCurrentWordCount: number } {
  const targetSet = new Set(targetShotIds)
  let nonTargetWordCount = 0
  let targetCurrentWordCount = 0
  for (const shot of existingShots) {
    const words = countWords(shot.audio_vo)
    if (targetSet.has(shot.shot_id)) {
      targetCurrentWordCount += words
    } else {
      nonTargetWordCount += words
    }
  }
  const rewriteHeadroom = Math.max(0, effectiveCap - nonTargetWordCount)
  return { nonTargetWordCount, rewriteHeadroom, targetCurrentWordCount }
}

/** Aim of the post-overshoot rewrite: 85% of the hard cap, so even if
 * the rewrite itself overshoots its own target by another 10-15% it
 * still lands under the cap. */
const REWRITE_TARGET_RATIO = 0.85

/**
 * Cap-enforcement chain. Returns the original script unchanged when it
 * already fits; otherwise runs one rewrite-compress LLM call and falls
 * back to a sentence-boundary trim if that still overshoots.
 */
async function enforceScriptLengthCap(params: {
  enableTtsMarkup?: boolean
  maxWords: number
  reportSubstep?: SubstepReporter
  script: string
  targetWords: number
  temperature: number
}): Promise<string> {
  const wordCount = countWords(params.script)
  if (wordCount <= params.maxWords) {
    return params.script
  }
  logger.info(
    `[uip-script] cap exceeded after first generation; rewriting wordCount=${wordCount} maxWords=${params.maxWords}`,
  )
  const rewriteTarget = Math.max(1, Math.round(params.maxWords * REWRITE_TARGET_RATIO))
  let rewritten = params.script
  try {
    // This rewrite is mechanical length compression (target = 85% of cap),
    // not creative writing, and only fires when the first generation
    // overshot -- so it never passes `enableSearch`. It runs on
    // SCRIPT_TOOL_MODELS, the same chain as the main generation.
    //
    // It was briefly routed to the LIGHT chain on the
    // premise that light = faster, but measurements showed the opposite for this
    // ~1445-word STRUCTURED rewrite -- gemini-3.5-flash averaged ~38s
    // (max ~500s) vs this chain's ~10s, and because the rewrite fires on
    // the overshoot tail it pushed generate_explainer_script p95 from
    // ~27s to ~39s. Flash-class models are fast on short outputs but slow
    // on long generation (same lesson already recorded on
    // DESCRIBE_IMAGE_MODELS). Reverted. The deterministic
    // `evaluateAndTrimScript` fallback below still guarantees the cap if
    // this rewrite itself overshoots.
    const rewriteResult = await runSubstep(params.reportSubstep, 'length_rewrite_llm', () =>
      completion({
        models: SCRIPT_TOOL_MODELS,
        prompt: buildScriptRewritePrompt({
          enableTtsMarkup: params.enableTtsMarkup === true,
          originalScript: params.script,
          targetWords: rewriteTarget,
          maxWords: params.maxWords,
        }),
        responseFormat: ScriptRewriteSchema,
        reasoningEffort: 'low',
        task: 'user-intent-planner-rewrite-script-length',
        temperature: Math.min(params.temperature, 0.5),
        timeout: computeScriptToolTimeoutMs(rewriteTarget),
      }),
    )
    rewritten = rewriteResult.script.trim()
    logger.info(
      `[uip-script] rewrite done wordCount=${countWords(rewritten)} targetWords=${rewriteTarget}`,
    )
  } catch (err) {
    logger.warn(
      `[uip-script] rewrite failed, will rely on sentence-trim fallback err=${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    // The failure is swallowed (sentence-trim fallback below) and the tool
    // succeeds, so no tool_failed ever freezes the card -- terminate the
    // substep here or it would sit at 'running' under a succeeded card.
    params.reportSubstep?.('length_rewrite_llm', 'completed')
  }

  if (countWords(rewritten) <= params.maxWords) {
    return rewritten
  }
  const trimmed = evaluateAndTrimScript(rewritten, {
    maxWords: params.maxWords,
    maxChars: Number.POSITIVE_INFINITY,
  })
  if (trimmed.exceeded) {
    logger.warn(
      `[uip-script] sentence-trim applied as last resort wordCount=${trimmed.words} maxWords=${params.maxWords}`,
    )
    return trimmed.withinLimitText
  }
  return rewritten
}

const ScriptRewriteSchema = z.object({
  script: z.string().trim().min(1),
})

function buildScriptRewritePrompt(params: {
  enableTtsMarkup?: boolean
  maxWords: number
  originalScript: string
  targetWords: number
}): string {
  const ttsMarkupLine = params.enableTtsMarkup
    ? 'If the original contains supported inline TTS markup ([happy], [sad], [angry], [fearful], [disgusted], [surprised], [calm], or {word|pronunciation}), preserve it when it still applies; do not add new markup unless the original/user intent required it.'
    : ''
  return [
    'You are rewriting a voiceover script that came back longer than the user requested.',
    `Compress the script to ABOUT ${params.targetWords} words. The hard limit is ${params.maxWords} words; output above that is rejected.`,
    'Preserve all key facts, hooks, and user-stated intent. Do not invent new facts. Maintain the same tone and structure (opener, body, close).',
    'Tighten by removing filler clauses, merging adjacent ideas, and trimming examples down to the most essential one.',
    'Output a single block of spoken text -- no stage directions, no scene headers, no quotes.',
    ttsMarkupLine,
    '',
    'Before returning, count the words of your rewrite. If it is above the hard limit, compress further until it fits.',
    '',
    'ORIGINAL SCRIPT:',
    params.originalScript,
  ].join('\n')
}
