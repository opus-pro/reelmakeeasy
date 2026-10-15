/**
 * Plain-text beat-sheet pipeline (TTS mode).
 *
 * Parallel to `beat-sheet-timestamped.ts` but for sessions that do NOT
 * have a user-uploaded audio source. There's no real transcript with
 * per-word timestamps, so we synthesize "pseudo-transcript" word
 * timestamps from the plain script at WORDS_PER_MINUTE (must stay in
 * sync with the prompt builder's WPM value). The synthesized word list
 * then feeds into the SAME `auditLongTakeBeatSheet` used by the
 * timestamped path -- text-coverage audit (every segment_text token
 * reconstructs back to the source) and model-specific duration bounds
 * both work unchanged because the audit operates on start/end seconds
 * regardless of whether they came from ASR or synthetic math.
 *
 * 3-attempt audit loop mirrors the timestamped flow. On failure, the
 * prompt builder's `auditFeedback` section gives the LLM specific beat
 * ids + failure reasons so the next attempt can repair targeted beats
 * instead of regenerating blind.
 */

import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { TranscriptWord } from '@shared/types/agent/transcript'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

import { PLANNER_TOOL_MODELS } from '../model-config'
import { formatLogFields } from '../runtime/planner-log'
import type { Pacing, UipPromptRoute } from '../types'

import {
  BEAT_SHEET_MIN_WORDS_PER_BEAT,
  BEAT_SHEET_WORDS_PER_MINUTE,
  resolveBeatSheetMaxDurationSeconds,
  resolvePlainTextHardMaxWordsPerBeat,
} from './beat-sheet-model-limits'
import { auditLongTakeBeatSheet } from './long-take-beat-sheet-audit'
import { buildLongTakeBeatSheetPlainTextPrompt } from './long-take-beat-sheet-plain-text-prompt'
import {
  type LongTakeBeatSheetModelOutput,
  LongTakeBeatSheetModelOutputSchema,
  type LongTakeBeatSheetOutput,
  normalizeLongTakeBeatSheetOutput,
} from './visual-script-beat-sheet-schema'

const logger = createSubLogger('uip-planner-runtime:beat-sheet')

// Must stay identical to the WPM used inside
// `buildLongTakeBeatSheetPlainTextPrompt`. If these diverge, the LLM's
// own estimates and the audit's synthesized "corrected" timestamps will
// disagree and audits will fail spuriously.
const WORDS_PER_MINUTE = BEAT_SHEET_WORDS_PER_MINUTE

const MAX_ATTEMPTS = 2
// Hard minimum for the deterministic splitter fallback. The maximum comes from
// resolvePlainTextHardMaxWordsPerBeat (the historical relaxed 5-27 word
// envelope, model-agnostic). The floor is 5 (~2.0s), kept above the 1.8s audit
// floor so a promoted split can never fall below it.
const HARD_MIN_WORDS_PER_BEAT = BEAT_SHEET_MIN_WORDS_PER_BEAT
// When the script is longer than this, we split it into chunks before
// the LLM call so each call only produces ~15-20 beats (its sweet spot).
// Above this, the LLM has been observed to skimp on beat count and
// produce far-over-cap beats that even 3 retries cannot recover.
const CHUNK_SCRIPT_WORD_THRESHOLD = 500
// Target word count per chunk. ~300 keeps each LLM call producing
// roughly 12-20 beats which is well within the model's reliable range.
const TARGET_CHUNK_WORDS = 300
// Above this script length we bump reasoningEffort because the model
// must plan many more beats and pay attention to global continuity.
const LONG_SCRIPT_REASONING_THRESHOLD = 600

type AuditLoopState = {
  auditPassed: boolean
  lastAuditCorrectedSegmentTexts: Array<null | string> | undefined
  lastAuditCorrectedTimeRanges: Array<null | { end: number; start: number }> | undefined
  lastModelOutput: LongTakeBeatSheetModelOutput | null
  textAudited: boolean
}

export async function generatePlainTextBeatSheet(params: {
  // Optional. Latest user message expressing segmentation intent (e.g.,
  // "more shots", "tighter cuts"). Only relevant in refinement phase;
  // bootstrap_visual passes undefined. Caller decides whether to inject.
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: null | Pacing
  projectId: string
  promptRoute?: UipPromptRoute
  script: string
  /**
   * Real UIP session id, used ONLY as the model-routing randomization unit.
   * Deliberately separate from `projectId`: the chunked path rewrites that to
   * `${projectId}#chunk{N}` for log disambiguation, and routing on it would put
   * every chunk of one script in a different routing bucket.
   */
  sessionId?: string
  transitionVideoModel?: string
}): Promise<LongTakeBeatSheetOutput> {
  const script = params.script.trim()
  if (!script) {
    logger.warn(
      `[uip] Plain-text beat-sheet skipped: empty script ${formatLogFields({
        projectId: params.projectId,
      })}`,
    )
    return { beat_sheet: [] }
  }

  const scriptWordCount = countScriptWords(script)
  if (scriptWordCount > CHUNK_SCRIPT_WORD_THRESHOLD) {
    return generatePlainTextBeatSheetChunked({
      ...params,
      script,
      scriptWordCount,
    })
  }
  return generatePlainTextBeatSheetSingle({ ...params, script, scriptWordCount })
}

async function generatePlainTextBeatSheetSingle(params: {
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: null | Pacing
  projectId: string
  promptRoute?: UipPromptRoute
  script: string
  scriptWordCount: number
  /**
   * Real UIP session id, used ONLY as the model-routing randomization unit.
   * Deliberately separate from `projectId`: the chunked path rewrites that to
   * `${projectId}#chunk{N}` for log disambiguation, and routing on it would put
   * every chunk of one script in a different routing bucket.
   */
  sessionId?: string
  transitionVideoModel?: string
}): Promise<LongTakeBeatSheetOutput> {
  const { script, scriptWordCount } = params
  const syntheticWords = synthesizeWordsFromScript(script, WORDS_PER_MINUTE)
  const maxWordsPerBeat = resolvePlainTextHardMaxWordsPerBeat()
  const loop = await runBeatSheetAuditLoop({
    latestUserMessage: params.latestUserMessage,
    modelSelectorTier: params.modelSelectorTier,
    sessionId: params.sessionId,
    pacing: params.pacing,
    promptRoute: params.promptRoute ?? 'general',
    projectId: params.projectId,
    script,
    scriptWordCount,
    syntheticWords,
    transitionVideoModel: params.transitionVideoModel,
  })

  if (!loop.lastModelOutput) {
    return { beat_sheet: [] }
  }

  // When the LLM produced text-correct beats but exceeded the duration cap
  // (textOk=true, timeOk=false), run the deterministic splitter. The
  // splitter regroups the LLM's words into <=26-word pieces with
  // recomputed time_ranges at WPM, so downstream consumers never see
  // over-cap shots even when the model fails 3 retries.
  //
  // When textOk=false we skip splitting -- the beats' segment_text didn't
  // line up with the source script in the first place, so a split would
  // be operating on stale tokens. Fall back to the prior behavior
  // (pass-through with auditPassed=false) and let upstream surface the
  // failure.
  if (loop.auditPassed) {
    return normalizeLongTakeBeatSheetOutput({
      modelOutput: loop.lastModelOutput,
      auditPassed: true,
      correctedTimeRanges: loop.lastAuditCorrectedTimeRanges,
      correctedSegmentTexts: loop.lastAuditCorrectedSegmentTexts,
      textAudited: false,
    })
  }
  if (loop.textAudited) {
    const splitBeats = splitOverCapBeats(loop.lastModelOutput.beat_sheet, maxWordsPerBeat)
    const inEnvelope = splitterOutputInEnvelope(splitBeats, maxWordsPerBeat)
    logger.info(
      `[uip-beat-sheet-plain] deterministic splitter applied ${formatLogFields({
        projectId: params.projectId,
        originalBeats: loop.lastModelOutput.beat_sheet.length,
        splitBeats: splitBeats.length,
        envelopeOk: inEnvelope,
        maxWordsPerBeat,
      })}`,
    )
    return normalizeLongTakeBeatSheetOutput({
      modelOutput: { beat_sheet: splitBeats },
      // Promote to audited only when every split beat is in the active word envelope.
      // Sub-min remainders or LLM-emitted under-cap beats that slipped past the
      // splitter would otherwise ship as "audited" and trip the audit downstream.
      auditPassed: inEnvelope,
      correctedTimeRanges: undefined,
      textAudited: false,
    })
  }
  return normalizeLongTakeBeatSheetOutput({
    modelOutput: loop.lastModelOutput,
    auditPassed: false,
    correctedTimeRanges: undefined,
    // Even on the severe-drift fallback path, propagate per-beat
    // source-aligned texts -- beats that happened to align cleanly still
    // get rewritten to the canonical source slice; only the truly
    // unalignable beats fall back to the LLM's text.
    correctedSegmentTexts: loop.lastAuditCorrectedSegmentTexts,
    textAudited: false,
  })
}

/**
 * Long-script path: split the script into <=TARGET_CHUNK_WORDS chunks at
 * sentence boundaries, run the single-chunk path in parallel for each, and
 * merge results with cumulative time_range offsets.
 *
 * Each chunk runs its own audit + retry + splitter, so the cap is enforced
 * per-chunk and the merge step is purely arithmetic.
 */
async function generatePlainTextBeatSheetChunked(params: {
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: null | Pacing
  projectId: string
  promptRoute?: UipPromptRoute
  script: string
  scriptWordCount: number
  /**
   * Real UIP session id, used ONLY as the model-routing randomization unit.
   * Deliberately separate from `projectId`: the chunked path rewrites that to
   * `${projectId}#chunk{N}` for log disambiguation, and routing on it would put
   * every chunk of one script in a different routing bucket.
   */
  sessionId?: string
  transitionVideoModel?: string
}): Promise<LongTakeBeatSheetOutput> {
  const chunks = splitScriptIntoChunks(params.script, TARGET_CHUNK_WORDS)
  logger.info(
    `[uip-beat-sheet-plain] chunked path ${formatLogFields({
      projectId: params.projectId,
      scriptWords: params.scriptWordCount,
      chunkCount: chunks.length,
      chunkWords: chunks.map((c) => countScriptWords(c)),
    })}`,
  )
  const chunkOutputs = await Promise.all(
    chunks.map((chunk, idx) =>
      generatePlainTextBeatSheetSingle({
        // Only forward the segmentation-intent user message on the first
        // chunk; otherwise the same hint gets repeated to every chunk.
        latestUserMessage: idx === 0 ? params.latestUserMessage : undefined,
        modelSelectorTier: params.modelSelectorTier,
        sessionId: params.sessionId,
        pacing: params.pacing,
        promptRoute: params.promptRoute ?? 'general',
        projectId: `${params.projectId}#chunk${idx + 1}`,
        script: chunk,
        scriptWordCount: countScriptWords(chunk),
        transitionVideoModel: params.transitionVideoModel,
      }).catch((err) => {
        logger.warn(
          `[uip-beat-sheet-plain] chunk ${idx + 1} failed; using empty beat sheet ${formatLogFields(
            {
              projectId: params.projectId,
              chunkIndex: idx + 1,
              error: err instanceof Error ? err.message : String(err),
            },
          )}`,
        )
        return { beat_sheet: [] } satisfies LongTakeBeatSheetOutput
      }),
    ),
  )
  return mergeChunkedBeatSheets(chunkOutputs, chunks)
}

/**
 * Tokenize the script by whitespace and assign each token a synthetic
 * {start, end} range based on cumulative position at the given WPM.
 *
 * The audit's `auditNormalizeToken` strips punctuation on both sides of
 * the comparison, so keeping raw tokens here (including any attached
 * punctuation) is safe and preserves exact positional ordering.
 */
export function synthesizeWordsFromScript(
  script: string,
  wordsPerMinute: number,
): TranscriptWord[] {
  const tokens = script
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  const secondsPerWord = 60 / wordsPerMinute
  return tokens.map((word, index) => ({
    word,
    start: index * secondsPerWord,
    end: (index + 1) * secondsPerWord,
  }))
}

function buildBeatSheetForAudit(modelOutput: LongTakeBeatSheetModelOutput): {
  beat_sheet: Array<{
    beat_id: number
    segment_text: string
    time_range?: { end: number; start: number }
  }>
} {
  return {
    beat_sheet: modelOutput.beat_sheet
      .filter((item) => item.segment_text?.trim())
      .map((item, i) => ({
        beat_id: i + 1,
        segment_text: item.segment_text.trim(),
        time_range: item.time_range
          ? { start: item.time_range.start, end: item.time_range.end }
          : undefined,
      })),
  }
}

async function callPlainTextBeatSheetLlm(params: {
  attempt: number
  auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetPlainTextPrompt>[0]['auditFeedback']
  >
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: null | Pacing
  projectId: string
  promptRoute: UipPromptRoute
  script: string
  scriptWordCount: number
  /**
   * Real UIP session id, used ONLY as the model-routing randomization unit.
   * Deliberately separate from `projectId`: the chunked path rewrites that to
   * `${projectId}#chunk{N}` for log disambiguation, and routing on it would put
   * every chunk of one script in a different routing bucket.
   */
  sessionId?: string
  transitionVideoModel?: string
}): Promise<LongTakeBeatSheetModelOutput | null> {
  const prompt = buildLongTakeBeatSheetPlainTextPrompt({
    script: params.script,
    latestUserMessage: params.latestUserMessage,
    pacing: params.pacing,
    promptRoute: params.promptRoute,
    auditFeedback: params.auditFeedbackHistory.length > 0 ? params.auditFeedbackHistory : undefined,
    transitionVideoModel: params.transitionVideoModel,
  })
  // Long scripts force the model to plan many beats with global continuity;
  // 'low' reasoning has been observed to skimp on beat count and overshoot
  // the per-beat envelope. Bump to 'medium' above the threshold so the
  // model spends more tokens before responding.
  const reasoningEffort =
    params.scriptWordCount > LONG_SCRIPT_REASONING_THRESHOLD ? 'medium' : 'low'
  logger.info(
    `[uip-beat-sheet-plain] start attempt=${params.attempt + 1}/${MAX_ATTEMPTS} promptChars=${prompt.length} scriptWords=${params.scriptWordCount} reasoningEffort=${reasoningEffort}`,
  )
  const startedAt = Date.now()
  try {
    const result = await completion({
      models: PLANNER_TOOL_MODELS,
      prompt,
      reasoningEffort,
      responseFormat: LongTakeBeatSheetModelOutputSchema,
      task: 'user-intent-planner-beat-sheet',
      temperature: 0,
      timeout: 60_000,
    })
    logger.info(
      `[uip-beat-sheet-plain] done durationMs=${Date.now() - startedAt} attempt=${params.attempt + 1} beats=${result.beat_sheet.length}`,
    )
    return result
  } catch (err) {
    logger.warn(
      `[uip-beat-sheet-plain] LLM call failed durationMs=${Date.now() - startedAt} ${formatLogFields(
        {
          projectId: params.projectId,
          attempt: params.attempt + 1,
          err: err instanceof Error ? err.message : String(err),
        },
      )}`,
    )
    return null
  }
}

function countScriptWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function recordBeatSheetAuditFailure(params: {
  attempt: number
  audit: ReturnType<typeof auditLongTakeBeatSheet>
  auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetPlainTextPrompt>[0]['auditFeedback']
  >
  maxAttempts: number
  modelOutput: LongTakeBeatSheetModelOutput
  projectId: string
}): void {
  const { attempt, audit, auditFeedbackHistory, maxAttempts, modelOutput, projectId } = params
  const beats = summarizeBeatsForLog(modelOutput, WORDS_PER_MINUTE)
  if (attempt < maxAttempts - 1) {
    auditFeedbackHistory.push({
      attempt: attempt + 1,
      reasons: audit.reasons,
      previousOutput: modelOutput.beat_sheet.map((b) => ({
        beat_id: b.beat_id ?? undefined,
        segment_text: b.segment_text,
        duration: b.duration ?? undefined,
      })),
    })
    logger.warn(
      `[uip] Plain-text beat-sheet audit failed, retrying ${formatLogFields({
        projectId,
        attempt: attempt + 1,
        textOk: audit.textOk,
        timeOk: audit.timeOk,
        reasons: audit.reasons,
        beats,
      })}`,
    )
  } else {
    logger.warn(
      `[uip] Plain-text beat-sheet audit failed after all attempts ${formatLogFields({
        projectId,
        attempts: maxAttempts,
        textAudited: audit.textOk,
        timeAudited: audit.timeOk,
        reasons: audit.reasons,
        beats,
      })}`,
    )
  }
}

async function runBeatSheetAuditLoop(params: {
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: null | Pacing
  projectId: string
  promptRoute: UipPromptRoute
  script: string
  scriptWordCount: number
  /**
   * Real UIP session id, used ONLY as the model-routing randomization unit.
   * Deliberately separate from `projectId`: the chunked path rewrites that to
   * `${projectId}#chunk{N}` for log disambiguation, and routing on it would put
   * every chunk of one script in a different routing bucket.
   */
  sessionId?: string
  syntheticWords: TranscriptWord[]
  transitionVideoModel?: string
}): Promise<AuditLoopState> {
  const auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetPlainTextPrompt>[0]['auditFeedback']
  > = []
  const state: AuditLoopState = {
    auditPassed: false,
    lastAuditCorrectedSegmentTexts: undefined,
    lastAuditCorrectedTimeRanges: undefined,
    lastModelOutput: null,
    textAudited: false,
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const modelOutput = await callPlainTextBeatSheetLlm({
      attempt,
      auditFeedbackHistory,
      latestUserMessage: params.latestUserMessage,
      modelSelectorTier: params.modelSelectorTier,
      sessionId: params.sessionId,
      pacing: params.pacing,
      promptRoute: params.promptRoute,
      projectId: params.projectId,
      script: params.script,
      scriptWordCount: params.scriptWordCount,
      transitionVideoModel: params.transitionVideoModel,
    })
    if (!modelOutput) {
      break
    }
    state.lastModelOutput = modelOutput

    const forAudit = buildBeatSheetForAudit(modelOutput)
    const audit = auditLongTakeBeatSheet(forAudit, params.syntheticWords, {
      maxDurationSeconds: resolveBeatSheetMaxDurationSeconds(),
    })
    state.textAudited = audit.textOk
    state.auditPassed = audit.textOk && audit.timeOk
    if (audit.textOk) {
      state.lastAuditCorrectedTimeRanges = audit.correctedTimeRanges
    }
    // Always capture the per-beat source-aligned text from the latest
    // attempt -- individual beats can be cleanly aligned even when the
    // overall audit's textOk fails (e.g. one beat drifted, four were
    // verbatim). The normalize step uses these per-beat to rewrite
    // segment_text to the canonical source slice wherever alignment held.
    state.lastAuditCorrectedSegmentTexts = audit.correctedSegmentTexts

    if (state.auditPassed) {
      logger.info(
        `[uip] Plain-text beat-sheet audit passed ${formatLogFields({
          projectId: params.projectId,
          attempt: attempt + 1,
          beatCount: forAudit.beat_sheet.length,
        })}`,
      )
      break
    }

    recordBeatSheetAuditFailure({
      attempt,
      audit,
      auditFeedbackHistory,
      maxAttempts: MAX_ATTEMPTS,
      modelOutput,
      projectId: params.projectId,
    })
  }

  return state
}

/**
 * Per-beat snapshot logged on audit failure so the offending beat is visible
 * in the log without re-running the LLM. word/duration are computed at the
 * plain-text WPM (matches what the audit's fallback estimate uses, so they
 * line up with the audit reason strings).
 */
function summarizeBeatsForLog(
  modelOutput: LongTakeBeatSheetModelOutput,
  wpm: number,
): Array<{ beat_id: number; duration_s: number; preview: string; words: number }> {
  const secsPerWord = 60 / wpm
  return modelOutput.beat_sheet.map((b, idx) => {
    const text = (b.segment_text ?? '').trim()
    const words = text.length === 0 ? 0 : text.split(/\s+/).length
    return {
      beat_id: b.beat_id ?? idx + 1,
      words,
      duration_s: Number((words * secsPerWord).toFixed(2)),
      preview: text.length > 80 ? `${text.slice(0, 80)}...` : text,
    }
  })
}

// A word closes a sentence/clause when its LAST character (ignoring trailing
// closing quotes and brackets) is a terminator. Anchoring at the END is the
// point: a dot INSIDE a word -- 3.4, example.com, $3.50 -- is not a
// boundary, so no word is ever cut in half. A word that genuinely ends in a
// dot (U.S., K.G.) does close a sentence here; that costs a slightly short
// sentence and never costs a token. The previous character-level regex cut
// `3.4` into `3.` + `4`, which made the chunk union token-different from the
// script and deterministically broke FULL coverage downstream.
const SENTENCE_BOUNDARY = /[.!?。！？]["')\]]*$/
const CLAUSE_BOUNDARY = /[,;，；]["')\]]*$/

/**
 * Split a long script into chunks of at most `maxWords` words, preferring
 * sentence boundaries, then clause boundaries, then a hard word count.
 *
 * Every chunk is a contiguous run of whole whitespace-separated words and the
 * chunks partition the input in order, so `chunks.join(' ')` is
 * token-identical to the whitespace-normalized script by construction. That
 * matters because each chunk is beat-sheeted and audited against its OWN
 * tokens, while the merged sheet is compared against the ORIGINAL script --
 * so a token the chunker invents or loses is a fatal coverage mismatch.
 *
 * Used by the chunked beat-sheet pipeline so each chunk is small enough
 * for the LLM to plan reliable model-appropriate beats without skimping on count.
 */
export function splitScriptIntoChunks(script: string, maxWords: number): string[] {
  const words = script.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return []
  }
  if (words.length <= maxWords) {
    return [words.join(' ')]
  }

  const chunks: string[] = []
  let current: string[] = []
  for (const piece of splitWordsIntoPieces(words, maxWords)) {
    if (current.length > 0 && current.length + piece.length > maxWords) {
      chunks.push(current.join(' '))
      current = []
    }
    current.push(...piece)
  }
  if (current.length > 0) {
    chunks.push(current.join(' '))
  }
  return chunks
}

/**
 * Last-resort split of a run of words that has no usable boundary left:
 * fixed-size groups of at most `maxWords`, in order.
 */
function chunkByCount(words: string[], maxWords: number): string[][] {
  // Guard the step: splitOverCapBeats takes the cap from a caller, and a
  // non-positive step would loop forever. The replaced hardSplitByWord had
  // the same hazard, unguarded.
  const step = Math.max(1, Math.floor(maxWords))
  const out: string[][] = []
  for (let index = 0; index < words.length; index += step) {
    out.push(words.slice(index, index + step))
  }
  return out
}

/**
 * Group consecutive words into runs, closing a run after any word that
 * matches `boundary`. Groups are contiguous slices of `words` in order, so
 * concatenating them reproduces the input exactly.
 */
function groupByBoundary(words: string[], boundary: RegExp): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  for (const word of words) {
    current.push(word)
    if (boundary.test(word)) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}

/**
 * Sentence-sized pieces, each already <= maxWords. An oversized sentence falls
 * back to clause boundaries, and an oversized clause to a plain word count.
 * Every returned piece is a contiguous slice of `words`.
 */
function splitWordsIntoPieces(words: string[], maxWords: number): string[][] {
  return groupByBoundary(words, SENTENCE_BOUNDARY).flatMap((sentence) =>
    sentence.length <= maxWords
      ? [sentence]
      : groupByBoundary(sentence, CLAUSE_BOUNDARY).flatMap((clause) =>
          clause.length <= maxWords ? [clause] : chunkByCount(clause, maxWords),
        ),
  )
}

/**
 * Final defensive split applied when the LLM fails to produce in-spec
 * beats after MAX_ATTEMPTS. For any beat whose segment_text exceeds the
 * hard word cap, split at sentence/comma/word boundaries into pieces
 * <= cap, dropping the LLM's time_range (the merged caller recomputes
 * times at WPM after splitting).
 *
 * Pure function; safe to call on every audit failure.
 */
export function splitOverCapBeats(
  beats: LongTakeBeatSheetModelOutput['beat_sheet'],
  maxWords = resolvePlainTextHardMaxWordsPerBeat(),
): LongTakeBeatSheetModelOutput['beat_sheet'] {
  const result: LongTakeBeatSheetModelOutput['beat_sheet'] = []
  const wpm = WORDS_PER_MINUTE
  const secondsPerWord = 60 / wpm
  let cursorWords = 0
  for (const beat of beats) {
    const segmentText = (beat.segment_text ?? '').trim()
    if (!segmentText) {
      continue
    }
    const pieces =
      countScriptWords(segmentText) <= maxWords
        ? [segmentText]
        : splitScriptIntoChunks(segmentText, maxWords)
    // Merge sub-min trailing remainder into the previous piece so we don't
    // ship a 1-4 word (< 2s) tail. Splitting "27 words" at maxWords=25
    // yields [25, 2] -- the 2-word tail is below the audit's lower bound.
    const mergedPieces: string[] = []
    for (const piece of pieces) {
      const last = mergedPieces[mergedPieces.length - 1]
      if (
        last !== undefined &&
        countScriptWords(piece) < HARD_MIN_WORDS_PER_BEAT &&
        countScriptWords(`${last} ${piece}`) <= maxWords
      ) {
        mergedPieces[mergedPieces.length - 1] = `${last} ${piece}`
      } else {
        mergedPieces.push(piece)
      }
    }
    for (const piece of mergedPieces) {
      const pieceWords = countScriptWords(piece)
      const start = cursorWords * secondsPerWord
      const end = (cursorWords + pieceWords) * secondsPerWord
      cursorWords += pieceWords
      result.push({
        beat_id: result.length + 1,
        segment_text: piece,
        time_range: { start, end },
        duration: end - start,
        visual_mode_hint: beat.visual_mode_hint ?? null,
      })
    }
  }
  return result
}

/**
 * Word-only envelope check on splitter output. Returns true if every beat's
 * segment_text falls within [HARD_MIN_WORDS_PER_BEAT, maxWords]. Used to
 * decide whether the splitter result can be promoted to `auditPassed: true`
 * (we can't re-run the full audit here -- it needs the source transcript
 * tokens that the splitter does not retain).
 */
function splitterOutputInEnvelope(
  beats: LongTakeBeatSheetModelOutput['beat_sheet'],
  maxWords = resolvePlainTextHardMaxWordsPerBeat(),
): boolean {
  for (const beat of beats) {
    const words = countScriptWords(beat.segment_text ?? '')
    if (words < HARD_MIN_WORDS_PER_BEAT || words > maxWords) {
      return false
    }
  }
  return true
}

/**
 * Concatenate chunk beat-sheets into a single sheet, shifting each
 * chunk's time_range by the cumulative duration of prior chunks and
 * renumbering beat_ids globally.
 *
 * If any chunk's beats lack time_range (the audit/text path didn't
 * produce one), the merger falls back to a WPM estimate so downstream
 * consumers always see contiguous timing.
 */
function appendChunkBeats(
  chunk: LongTakeBeatSheetOutput,
  merged: LongTakeBeatSheetOutput['beat_sheet'],
  cursorSec: number,
  secondsPerWord: number,
): number {
  let chunkSpan = 0
  for (const beat of chunk.beat_sheet) {
    const range = beat.time_range ?? null
    const span = range
      ? range.end - range.start
      : countScriptWords(beat.segment_text) * secondsPerWord
    const start = cursorSec + (range ? range.start : chunkSpan)
    const end = start + span
    merged.push({
      beat_id: merged.length + 1,
      segment_text: beat.segment_text,
      time_range: { start, end },
      duration: end - start,
      visual_mode_hint: beat.visual_mode_hint ?? null,
    })
    chunkSpan = range ? range.end : chunkSpan + span
  }
  return chunkSpan
}

function mergeChunkedBeatSheets(
  chunks: LongTakeBeatSheetOutput[],
  scriptChunks?: string[],
): LongTakeBeatSheetOutput {
  const merged: LongTakeBeatSheetOutput['beat_sheet'] = []
  const secondsPerWord = 60 / WORDS_PER_MINUTE
  let cursorSec = 0
  let textAudited = true
  let timeAudited = true
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    if (chunk.text_audited !== true) {
      textAudited = false
    }
    if (chunk.time_range_audited !== true) {
      timeAudited = false
    }
    if (chunk.beat_sheet.length === 0) {
      // LLM dropped this chunk's beats entirely. Advance the cursor by
      // the chunk's WPM-estimated duration so subsequent chunks land at
      // the correct timeline position -- otherwise their start times
      // collapse and the visual track becomes shorter than the audio
      // track for the rest of the video.
      const sourceWords = scriptChunks ? countScriptWords(scriptChunks[i] ?? '') : 0
      cursorSec += sourceWords * secondsPerWord
      textAudited = false
      timeAudited = false
      continue
    }
    cursorSec += appendChunkBeats(chunk, merged, cursorSec, secondsPerWord)
  }
  const output: LongTakeBeatSheetOutput = { beat_sheet: merged }
  if (textAudited) {
    output.text_audited = true
  }
  if (timeAudited) {
    output.time_range_audited = true
  }
  return output
}
