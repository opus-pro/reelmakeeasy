import { randomUUID } from 'node:crypto'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { completion } from '@reelmakeeasy/common/llm'
import { Logger } from '@reelmakeeasy/common/logger'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { findLlmNotSetUp } from '@reelmakeeasy/common/utils/llm-not-set-up'
import { countWords } from '@reelmakeeasy/common/utils/text'
import type { ImageDescriptionFilename } from '@reelmakeeasy/uip-planner-runtime/tools/describe-uploaded-images'
import type { LongTakeScriptGeneratorPath } from '@shared/types/api/long-take'
import { z } from 'zod'

import {
  enforceScriptLengthBounds as enforceScriptLengthBoundsHelper,
  normalizeToSingleLine,
  resolveEffectiveMaxWords as resolveEffectiveMaxWordsHelper,
  stripImageTags,
} from './long-take-script-helpers'

const logger = new Logger('LongTakeScript')

function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}

const LONG_TAKE_WORDS_PER_MINUTE = 150
const LONG_TAKE_DEFAULT_TARGET_WORDS = 2 * LONG_TAKE_WORDS_PER_MINUTE
/** Ceiling -- maximum effectiveMaxWords any caller can request. The
 * actual per-request cap is gated via `effectiveMaxScriptWords` on the
 * entry point so non-gated users still see legacy 450 / 3000. */
const LONG_TAKE_MAX_WORDS_CEILING = EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords
const LONG_TAKE_LENGTH_TOLERANCE = 0.2
// Rewrite aims for 85% of the hard cap so the LLM's natural overshoot stays under it.
const LONG_TAKE_REWRITE_TARGET_RATIO = 0.85

const ScriptGenerationSchema = z.object({
  isScript: z.boolean(),
  script: z.string(),
})

export type LongTakeScriptPreviewFallback = {
  code: 'generate_preview_failed' | 'generate_script_missing' | 'rewrite_empty_result'
  fallbackTo: 'normalized_previous_script' | 'normalized_raw_input' | 'raw_input'
  stage: 'generate' | 'preview' | 'rewrite'
}

type LengthGuidance = {
  source: 'minutes' | 'seconds' | 'words'
  targetWords: number
}

export function buildLongTakeScriptPrompt(params: {
  hasUserLengthRequest: boolean
  imageAnalyses?: ImageDescriptionFilename[]
  maxWords: number
  openingLine?: string
  rawInput: string
  targetWords: number
}): string {
  const { hasUserLengthRequest, imageAnalyses, maxWords, openingLine, rawInput, targetWords } =
    params
  const openingRule = openingLine
    ? `- **Opening line**: Begin the script with exactly this sentence, word for word:\n  ${openingLine}\n  Everything after it builds toward answering it.\n`
    : ''

  let referenceImagesSection = ''
  if (imageAnalyses?.length) {
    const descriptions = imageAnalyses
      .map((a, i) => {
        const label = a.filename?.trim() || `Image ${i + 1}`
        return `${label}: ${a.description}`
      })
      .join('\n')
    referenceImagesSection =
      '\n### REFERENCE IMAGES\n' +
      `The user provided the following reference images:\n${
        descriptions
      }\nUse these descriptions to inform visual details, subjects, and style of the generated script.`
  }

  const lengthGuidance = hasUserLengthRequest
    ? `User provided a length requirement. Follow it closely and target about ${targetWords} words.`
    : `No explicit length requirement. Target about ${targetWords} words (~2 minutes at 150 WPM).`

  return `Role:
You are an expert Story Mode Script Engine.

Task:
Process the USER INPUT using the logic steps below and output ONLY the final script text.

### PROCESSING LOGIC (Execute these steps internally, do not output them):

Step 1: ANALYZE INTENT
- Read the input to determine if it is ALREADY a script or a PROMPT for generation.
- **It is a SCRIPT if**: It uses first-person narration ("I", "We", "Today..."), has complete sentences, or seems like a finished text to be read.
- **It is a PROMPT if**: It contains instructions ("Write a story about..."), bullet points, rough notes, or just keywords.

Step 2: EXECUTE BASED ON INTENT

[PATH A: IF USER PROVIDED A SCRIPT]
- **Action**: Passthrough (Verbatim).
- **Content**: Return the input word-for-word.
- **Formatting**: PRESERVE all original line breaks and formatting.
- **CRITICAL LENGTH RULE**: If the user's script is very long, **DO NOT shorten, summarize, or cut it**. Return the full text exactly as is. (Length validation will be handled by the external system).

[PATH B: IF USER PROVIDED A PROMPT]
- **Action**: Generate a new script.
- **Content**: Write a compelling, conversational voiceover script based on the topic.
- **Style**: Direct, engaging, no fluff.
${openingRule}- **Formatting**: Output as a **single continuous block of text** (remove line breaks).
- **Content Constraints**: Spoken text only. No visual cues, no scene headers.
- **LENGTH GUIDANCE**:
  1. Target feel: ${lengthGuidance}
  2. HARD LIMIT: **Do NOT exceed ${maxWords} words**.

Step 3: FINAL OUTPUT
- Detect the language of the input and use the same language for the output.
- Output ONLY the final text string from Step 2.
- Do not output the logic steps. Do not output "Here is your script". Just the raw text.

USER INPUT:
${rawInput}
${referenceImagesSection}
`
}

export async function generateLongTakeScriptPreview(params: {
  contextId?: string
  /**
   * Per-user effective word cap. When omitted, falls back to the codebase
   * ceiling so existing callers stay backwards-compatible. Long-take
   * service resolves this from `getStoryModeUserLimits(user)` so legacy
   * (non-gated) users see the 450-word cap and gated users see 1700.
   */
  effectiveMaxScriptWords?: number
  imageAnalyses?: ImageDescriptionFilename[]
  /** When set, a newly written script (not a pasted one) must begin with exactly this sentence:
   *  agent mode's chosen opening hook. */
  openingLine?: string
  rawInput: string
  targetDurationSeconds?: number
  userId: string
}): Promise<{
  contextId: string
  fallbackSignals: LongTakeScriptPreviewFallback[]
  finalScriptSource:
    | 'generated'
    | 'normalized_previous_script'
    | 'normalized_raw_input'
    | 'raw_input'
  hasError: boolean
  script: string
  scriptGeneratorPath: LongTakeScriptGeneratorPath
  v4Category?: string
  v4Track?: string
}> {
  const { rawInput } = params
  if (!rawInput.trim()) {
    throw new Error('Script is required')
  }

  const effectiveMaxWords = resolveEffectiveMaxWordsHelper(
    LONG_TAKE_MAX_WORDS_CEILING,
    params.effectiveMaxScriptWords,
  )

  const contextId = params.contextId || `long-take-preview-${randomUUID()}`
  try {
    const result = await generateLongTakeScriptOnly({
      effectiveMaxWords,
      imageAnalyses: params.imageAnalyses,
      openingLine: params.openingLine?.trim() || undefined,
      projectId: contextId,
      rawInput: params.rawInput,
      targetDurationSeconds: params.targetDurationSeconds,
      userId: params.userId,
    })
    const lastFallbackSignal = result.fallbackSignals[result.fallbackSignals.length - 1]
    const finalScriptSource = lastFallbackSignal?.fallbackTo ?? ('generated' as const)
    logger.info(
      `[long-take] Script preview completed ${formatLogFields({
        contextId,
        finalScriptSource,
        hasError: result.fallbackSignals.length > 0,
        fallbackCount: result.fallbackSignals.length,
        fallbackSignals: result.fallbackSignals,
        outputWordCount: countWords(result.script),
      })}`,
    )
    return {
      contextId,
      finalScriptSource,
      fallbackSignals: result.fallbackSignals,
      hasError: result.fallbackSignals.length > 0,
      script: result.script,
      scriptGeneratorPath: result.scriptGeneratorPath,
      v4Category: result.v4Category,
      v4Track: result.v4Track,
    }
  } catch (error) {
    // No AI to write with: answer that (LlmNotSetUpFilter, 409) instead of passing the brief off
    // as the script, which the composer would show as "Please retry".
    if (findLlmNotSetUp(error)) throw error
    logger.error(
      `[long-take] Script preview failed, falling back to normalized raw input ${formatLogFields({
        contextId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })}`,
    )
    const fallbackSignal: LongTakeScriptPreviewFallback = {
      code: 'generate_preview_failed',
      fallbackTo: 'normalized_raw_input',
      stage: 'preview',
    }
    return {
      contextId,
      finalScriptSource: fallbackSignal.fallbackTo,
      fallbackSignals: [fallbackSignal],
      hasError: true,
      script: normalizeToSingleLine(rawInput),
      // Preview crashed before the agent pipeline could engage; bucket with the legacy cohort.
      scriptGeneratorPath: 'legacy',
    }
  }
}

function extractLengthGuidance(rawInput: string, effectiveMaxWords: number): LengthGuidance | null {
  const input = rawInput || ''

  const wordMatch = input.match(/(\d{2,4})\s*(?:words?|word|w|字|词)\b/i)
  if (wordMatch) {
    const value = Number.parseInt(wordMatch[1], 10)
    if (Number.isFinite(value) && value > 0) {
      return { source: 'words', targetWords: Math.min(value, effectiveMaxWords) }
    }
  }

  const minuteMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|分钟)\b/i)
  if (minuteMatch) {
    const value = Number.parseFloat(minuteMatch[1])
    if (Number.isFinite(value) && value > 0) {
      const targetWords = Math.round(value * LONG_TAKE_WORDS_PER_MINUTE)
      return { source: 'minutes', targetWords: Math.min(targetWords, effectiveMaxWords) }
    }
  }

  const secondMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:sec|secs|second|seconds|秒)\b/i)
  if (secondMatch) {
    const value = Number.parseFloat(secondMatch[1])
    if (Number.isFinite(value) && value > 0) {
      const targetWords = Math.round((value / 60) * LONG_TAKE_WORDS_PER_MINUTE)
      return { source: 'seconds', targetWords: Math.min(targetWords, effectiveMaxWords) }
    }
  }

  return null
}

async function generateLongTakeScriptOnly(params: {
  effectiveMaxWords: number
  imageAnalyses?: ImageDescriptionFilename[]
  openingLine?: string
  projectId: string
  rawInput: string
  targetDurationSeconds?: number
  userId: string
}): Promise<{
  fallbackSignals: LongTakeScriptPreviewFallback[]
  isScript: boolean
  script: string
  scriptGeneratorPath: LongTakeScriptGeneratorPath
  v4Category?: string
  v4Track?: string
}> {
  const {
    effectiveMaxWords,
    imageAnalyses,
    openingLine,
    projectId,
    targetDurationSeconds,
    userId,
  } = params
  // Strip @img[label](reference) anchor-asset markers up front. Otherwise the passthrough
  // branch (LLM returns rawInput verbatim when it detects the input is already a script)
  // persists the markers to script.txt and TTS reads the filenames aloud.
  const rawInput = stripImageTags(params.rawInput)
  const fallbackSignals: LongTakeScriptPreviewFallback[] = []
  const explicitGuidance = resolveExplicitLengthGuidance(targetDurationSeconds, effectiveMaxWords)
  const lengthGuidance = explicitGuidance ?? extractLengthGuidance(rawInput, effectiveMaxWords)
  const targetWords = Math.min(
    Math.max(lengthGuidance?.targetWords ?? LONG_TAKE_DEFAULT_TARGET_WORDS, 1),
    effectiveMaxWords,
  )
  const hasUserLengthRequest = Boolean(lengthGuidance)

  logger.info(
    `[long-take] Generating script ${formatLogFields({
      projectId,
      lengthGuidance,
      targetWords,
      hasUserLengthRequest,
      maxWords: effectiveMaxWords,
    })}`,
  )

  // Combined detection + generation in one LLM call
  const prompt = buildLongTakeScriptPrompt({
    hasUserLengthRequest,
    imageAnalyses,
    maxWords: effectiveMaxWords,
    openingLine,
    rawInput,
    targetWords,
  })

  logger.info(
    `[long-take] Calling LLM for legacy script generation ${formatLogFields({ projectId })}`,
  )
  const response = await JobContext.run({ projectId, userId }, async () =>
    completion({
      models: ['gpt-5.5', 'gemini-3.8-flash'],
      enableSearch: { type: 'web_search', search_context_size: 'medium' },
      prompt,
      reasoningEffort: 'low',
      responseFormat: ScriptGenerationSchema,
      task: 'long-take-generate-script',
      temperature: 0.2,
    }),
  )
  logger.info(
    `[long-take] Script generation response ${formatLogFields({ isScript: response?.isScript, scriptLength: response?.script?.length })}`,
  )

  const isScript = Boolean(response?.isScript)
  let responseScript = (response?.script || '').trim()

  if (!responseScript) {
    const fallbackTo = isScript ? ('raw_input' as const) : ('normalized_raw_input' as const)
    logger.warn(
      `[long-take] Empty script from LLM, falling back ${formatLogFields({ projectId, fallbackTo, isScript })}`,
    )
    fallbackSignals.push({
      code: 'generate_script_missing',
      fallbackTo,
      stage: 'generate',
    })
    responseScript = rawInput
  }

  let script = isScript ? responseScript : normalizeToSingleLine(responseScript)

  if (!isScript) {
    script = await enforceScriptLengthBoundsHelper({
      effectiveMaxWords,
      fallbackSignals,
      hasUserLengthRequest,
      lengthTolerance: LONG_TAKE_LENGTH_TOLERANCE,
      projectId,
      rewriteScript: (rewrite) => rewriteScriptToTargetWords({ ...rewrite, openingLine }),
      rewriteTargetRatio: LONG_TAKE_REWRITE_TARGET_RATIO,
      script,
      targetWords,
      userId,
    })
    if (openingLine) {
      const fixed = ensureOpeningLine(script, openingLine)
      if (fixed.changed)
        logger.warn(
          `[long-take] Restored the chosen opening line ${formatLogFields({ projectId })}`,
        )
      script = fixed.script
    }
  }

  // Final belt against the LLM echoing @img[...](...) markers back in the passthrough branch.
  const finalScript = stripImageTags(script)
  const matchesInput = scriptMatchesInput(finalScript, rawInput)
  logger.info(
    `[long-take] Script generation complete ${formatLogFields({
      projectId,
      isScript,
      scriptMatchesInput: matchesInput,
      finalWordCount: countWords(finalScript.trim()),
      fallbackCount: fallbackSignals.length,
    })}`,
  )
  return {
    fallbackSignals,
    isScript,
    script: finalScript,
    scriptGeneratorPath: isScript && matchesInput ? 'passthrough' : 'legacy',
  }
}

const comparable = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Words that end in a period without ending the sentence. */
const ABBREVIATIONS = new Set([
  'dr',
  'e.g',
  'etc',
  'i.e',
  'jr',
  'mr',
  'mrs',
  'ms',
  'mt',
  'prof',
  'sr',
  'st',
  'u.s',
  'vs',
])

/**
 * Splits spoken text into sentences. A sentence ends at `.`, `!`, `?` or an ellipsis (and any closing
 * quotes or brackets) followed by a space and a capital letter, a digit or an opening quote, so
 * decimals ("3.8"), an ellipsis running on in lowercase and abbreviations ("Dr. Jones") don't split.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const match of text.matchAll(/([.!?…]+["'”’)\]]*)\s+(?=["'“‘(]?[\p{Lu}\p{N}])/gu)) {
    const end = match.index + match[1].length
    const sentence = text.slice(start, end).trim()
    const lastWord = (sentence.split(/\s+/).at(-1) ?? '')
      .replace(/^["'“‘(]+/, '')
      .replace(/[.!?…"'”’)\]]+$/, '')
      .toLowerCase()
    if (match[1].startsWith('.') && ABBREVIATIONS.has(lastWord)) continue
    sentences.push(sentence)
    start = match.index + match[0].length
  }
  const rest = text.slice(start).trim()
  if (rest) sentences.push(rest)
  return sentences
}

/**
 * Makes `script` start with `openingLine` (agent mode's chosen opening hook), in case a model
 * changed it: an opening already in place (ignoring case and punctuation) is kept; otherwise as
 * many leading sentences as the opening has are replaced by it, or it is put in front of a script
 * too short for that.
 */
export function ensureOpeningLine(
  script: string,
  openingLine: string,
): { changed: boolean; script: string } {
  if (comparable(script).startsWith(comparable(openingLine))) return { changed: false, script }
  const opening = openingLine.trim()
  const sentences = splitSentences(script.trim())
  const openingSentences = splitSentences(opening).length
  if (sentences.length <= openingSentences)
    return { changed: true, script: `${opening} ${script.trim()}` }
  return {
    changed: true,
    script: `${opening} ${sentences.slice(openingSentences).join(' ')}`,
  }
}

function resolveExplicitLengthGuidance(
  targetDurationSeconds: number | undefined,
  effectiveMaxWords: number,
): LengthGuidance | null {
  if (
    !targetDurationSeconds ||
    !Number.isFinite(targetDurationSeconds) ||
    targetDurationSeconds <= 0
  ) {
    return null
  }
  const targetWords = Math.min(
    Math.max(Math.round((targetDurationSeconds / 60) * LONG_TAKE_WORDS_PER_MINUTE), 1),
    effectiveMaxWords,
  )
  return { source: 'seconds', targetWords }
}

async function rewriteScriptToTargetWords(params: {
  maxWords: number
  /** Agent mode's chosen opening: the rewrite keeps it as the first sentence. */
  openingLine?: string
  projectId: string
  script: string
  targetWords: number
  userId: string
}): Promise<{ fallbackSignals: LongTakeScriptPreviewFallback[]; script: string }> {
  const { maxWords, openingLine, projectId, script, targetWords, userId } = params
  const fallbackSignals: LongTakeScriptPreviewFallback[] = []
  const inputWordCount = countWords(script)

  logger.info(
    `[long-take] Rewriting script to target word count ${formatLogFields({ projectId, inputWordCount, targetWords, maxWords })}`,
  )

  const prompt = [
    'Rewrite the following voiceover script to satisfy the length requirements.',
    `Target length: ${targetWords} words. Hit this number; do not aim higher.`,
    `Absolute hard limit: ${maxWords} words. Going over by even one word is a failure -- the output is rejected.`,
    'Before returning, count the words of your rewrite. If it exceeds the hard limit, compress further until it fits.',
    'Preserve all key facts and user intent. Do not add new facts.',
    ...(openingLine ? [`Keep the first sentence exactly as it is: ${openingLine}`] : []),
    'Output only the rewritten script as a single block of text.',
    '',
    'SCRIPT:',
    script,
  ].join('\n')

  const rewritten = await JobContext.run({ projectId, userId }, async () =>
    completion({
      models: ['gemini-3.8-flash', 'gpt-5'],
      prompt,
      reasoningEffort: 'low',
      responseFormat: z.string(),
      task: 'long-take-rewrite-script-length',
      temperature: 0.2,
    }),
  )

  if (!rewritten?.trim()) {
    logger.warn(
      `[long-take] Rewrite returned empty result, falling back to normalized previous script ${formatLogFields({ projectId })}`,
    )
    fallbackSignals.push({
      code: 'rewrite_empty_result',
      fallbackTo: 'normalized_previous_script',
      stage: 'rewrite',
    })
    return { fallbackSignals, script: normalizeToSingleLine(script) }
  }

  const rewrittenWordCount = countWords(rewritten)
  logger.info(
    `[long-take] Rewrite completed ${formatLogFields({ projectId, inputWordCount, rewrittenWordCount, targetWords })}`,
  )

  return { fallbackSignals, script: normalizeToSingleLine(rewritten) }
}

/**
 * Tells `scriptGeneratorPath` whether the LLM actually returned the user's input
 * verbatim.
 * Suffix tolerance: the LLM may strip wrapping labels like `script:` or
 * `voiceover:`. That's still passthrough -- no content authored,
 * just a label peeled. Genuine generation produces text that is not a suffix of
 * the user's input, so accepting suffix matches doesn't admit real rewrites.
 */
function scriptMatchesInput(script: string, rawInput: string): boolean {
  const normalize = (s: string) => stripImageTags(s).replace(/\s+/g, ' ').trim().toLowerCase()
  const ns = normalize(script)
  const nr = normalize(rawInput)
  if (ns === nr) {
    return true
  }
  return ns.length > 0 && nr.endsWith(ns)
}
