/**
 * Timestamped beat-sheet pipeline (audio mode).
 *
 * Extracted out of `generate-visual-script-full-scope-story-runtime.ts` to
 * keep that file under the 800-line lint budget and to keep audio-mode
 * artifacts (transcript loading + timestamped beat-sheet + 3-attempt audit
 * loop) co-located.
 *
 * Two entry points:
 *
 * - `ensureTranscriptWords(session)` loads the ASR transcript from storage and
 *   returns its flattened word-level timestamps. Returned to `tool-runtime.ts`
 *   so the VS tool can align each shot's time to the real audio.
 *
 * - `generateTimestampedBeatSheet(session, { pacing })` runs the story-mode
 *   beat-sheet expert prompt against the transcript with a 3-attempt
 *   audit loop. Consumed by `ensureBeatSheetInternal` via the audio-mode
 *   branch.
 *
 * Both paths share the same transcript load (`loadTranscriptSafely`), which
 * is resilient to missing / malformed artifacts -- callers fall back to
 * DEFAULT_WPM-based timing in that case.
 */

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

import { PLANNER_TOOL_MODELS } from '../model-config'
import { formatLogFields } from '../runtime/planner-log'
import { type SessionState, type UipPromptRoute } from '../types'

import { resolveBeatSheetMaxDurationSeconds } from './beat-sheet-model-limits'
import {
  auditLongTakeBeatSheet,
  buildTimestampedTranscript,
  flattenTranscriptWordsForAudit,
} from './long-take-beat-sheet-audit'
import { buildLongTakeBeatSheetExpertPrompt } from './long-take-beat-sheet-expert-prompt'
import {
  type LongTakeBeatSheetModelOutput,
  LongTakeBeatSheetModelOutputSchema,
  type LongTakeBeatSheetOutput,
  normalizeLongTakeBeatSheetOutput,
} from './visual-script-beat-sheet-schema'

const logger = createSubLogger('uip-planner-runtime:beat-sheet')

type AuditLoopState = {
  auditPassed: boolean
  lastAuditCorrectedSegmentTexts: Array<null | string> | undefined
  lastAuditCorrectedTimeRanges: Array<null | { end: number; start: number }> | undefined
  lastModelOutput: LongTakeBeatSheetModelOutput | null
  textAudited: boolean
}

export async function ensureTranscriptWords(
  session: SessionState,
): Promise<null | TranscriptWord[]> {
  if (session.spec.meta.audio_source !== 'user_audio') {
    return null
  }
  const projectStorage = new ProjectStore(session.sessionId)
  const transcript = await loadTranscriptSafely(
    projectStorage,
    STORY_LOADER_PATHS.transformedTranscriptPath,
    session.sessionId,
  )
  if (!transcript) {
    return null
  }
  const words = flattenTranscriptWordsForAudit(transcript)
  if (words.length === 0) {
    logger.warn(
      `[uip] Transcript loaded but contains no word timestamps ${formatLogFields({
        projectId: session.sessionId,
      })}`,
    )
    return null
  }
  return words
}

export async function generateTimestampedBeatSheet(
  session: SessionState,
  options: {
    // Optional. Latest user message expressing segmentation intent (only
    // populated by caller in refinement phase). Bootstrap_visual passes
    // undefined.
    latestUserMessage?: string
    pacing: SessionState['spec']['global_constraints']['pacing']
    promptRoute?: UipPromptRoute
  },
): Promise<LongTakeBeatSheetOutput> {
  const projectId = session.sessionId
  // pacing drives the "Shot Length Distribution Guideline" block in the
  // expert prompt via `renderTimestampedDistributionGuideline`. The selected
  // video model controls the hard upper duration bound.
  const pacing = options.pacing
  const transitionVideoModel = session.transitionVideoModel
  // Transcript lives at the project root: projects/${projectId}/story_loader/...
  // not under the user-intent-planner subfolder.
  const projectStorage = new ProjectStore(projectId)
  const transcriptPath = STORY_LOADER_PATHS.transformedTranscriptPath

  const transcript = await loadTranscriptSafely(projectStorage, transcriptPath, projectId)
  if (!transcript) {
    logger.warn(
      `[uip] Timestamped beat-sheet skipped: no transcript ${formatLogFields({ projectId })}`,
    )
    return { beat_sheet: [] }
  }

  const transcriptWords = flattenTranscriptWordsForAudit(transcript)
  const timestampedTranscript = buildTimestampedTranscript(transcript)
  if (!timestampedTranscript) {
    logger.warn(
      `[uip] Timestamped beat-sheet skipped: empty transcript ${formatLogFields({
        projectId,
        segmentCount: transcript.segments?.length ?? 0,
      })}`,
    )
    return { beat_sheet: [] }
  }

  const loop = await runBeatSheetAuditLoop({
    latestUserMessage: options.latestUserMessage,
    modelSelectorTier: session.modelSelectorTier,
    pacing,
    projectId,
    promptRoute: options.promptRoute ?? 'general',
    timestampedTranscript,
    transitionVideoModel,
    transcriptWords,
  })

  if (!loop.lastModelOutput) {
    return { beat_sheet: [] }
  }

  return normalizeLongTakeBeatSheetOutput({
    modelOutput: loop.lastModelOutput,
    auditPassed: loop.auditPassed,
    correctedTimeRanges: loop.textAudited ? loop.lastAuditCorrectedTimeRanges : undefined,
    // Always pass per-beat source-aligned texts. Audio mode's
    // `transcriptWords[].word` is the verbatim ASR token, so any beat
    // that aligned cleanly gets rewritten to the real transcript words
    // (drift-resistant) -- even when the overall audit failed because
    // OTHER beats drifted.
    correctedSegmentTexts: loop.lastAuditCorrectedSegmentTexts,
    textAudited: !loop.auditPassed && loop.textAudited,
  })
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

async function callBeatSheetLlm(params: {
  attempt: number
  auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetExpertPrompt>[0]['auditFeedback']
  >
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: SessionState['spec']['global_constraints']['pacing']
  projectId: string
  promptRoute: UipPromptRoute
  timestampedTranscript: string
  transcriptWords: ReturnType<typeof flattenTranscriptWordsForAudit>
  transitionVideoModel?: string
}): Promise<LongTakeBeatSheetModelOutput | null> {
  const prompt = buildLongTakeBeatSheetExpertPrompt({
    timestampedTranscript: params.timestampedTranscript,
    latestUserMessage: params.latestUserMessage,
    pacing: params.pacing,
    promptRoute: params.promptRoute,
    auditFeedback: params.auditFeedbackHistory.length > 0 ? params.auditFeedbackHistory : undefined,
    transitionVideoModel: params.transitionVideoModel,
  })
  const estimatedBeats = estimateBeatCountFromTranscript(params.transcriptWords)
  const timeoutMs = computeBeatSheetTimeoutMs(estimatedBeats)
  logger.info(
    `[uip-beat-sheet-timestamped] start attempt=${params.attempt + 1} promptChars=${prompt.length} transcriptWords=${params.transcriptWords.length} estimatedBeats=${estimatedBeats} timeoutMs=${timeoutMs}`,
  )
  const startedAt = Date.now()
  try {
    // Timestamped path threads the ASR word-level transcript through the LLM
    // and asks it to align each beat to start/end seconds. The reasoning is
    // heavier than the plain-text variant (which works on synthesized WPM
    // math), and longer transcripts require correspondingly more time --
    // see `computeBeatSheetTimeoutMs` for the scaling curve.
    const result = await completion({
      models: PLANNER_TOOL_MODELS,
      prompt,
      reasoningEffort: 'low',
      responseFormat: LongTakeBeatSheetModelOutputSchema,
      task: 'user-intent-planner-beat-sheet-timestamped',
      temperature: 0,
      timeout: timeoutMs,
    })
    logger.info(
      `[uip-beat-sheet-timestamped] done durationMs=${Date.now() - startedAt} attempt=${params.attempt + 1} beats=${result.beat_sheet.length}`,
    )
    return result
  } catch (err) {
    logger.warn(
      `[uip-beat-sheet-timestamped] LLM call failed durationMs=${Date.now() - startedAt} ${formatLogFields(
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

async function loadTranscriptSafely(
  storage: ProjectStore,
  relativePath: string,
  projectId: string,
): Promise<null | TranscriptData> {
  try {
    const exists = await storage.exists(relativePath)
    if (!exists) {
      return null
    }
    return await storage.readJsonFile<TranscriptData>(relativePath)
  } catch (err) {
    logger.warn(
      `[uip] Failed to read transformed transcript ${formatLogFields({
        projectId,
        path: relativePath,
        err: err instanceof Error ? err.message : String(err),
      })}`,
    )
    return null
  }
}

function recordBeatSheetAuditFailure(params: {
  attempt: number
  audit: ReturnType<typeof auditLongTakeBeatSheet>
  auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetExpertPrompt>[0]['auditFeedback']
  >
  maxAttempts: number
  modelOutput: LongTakeBeatSheetModelOutput
  projectId: string
}): void {
  const { attempt, audit, auditFeedbackHistory, maxAttempts, modelOutput, projectId } = params
  const beats = summarizeBeatsForLog(modelOutput)
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
      `[uip] Timestamped beat-sheet audit failed, retrying ${formatLogFields({
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
      `[uip] Timestamped beat-sheet audit failed after all attempts ${formatLogFields({
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

/**
 * Per-beat snapshot logged on audit failure so the offending beat is visible
 * in the log without re-running the LLM. duration is taken from the LLM's
 * own time_range when available, else falls back to the LLM-reported
 * duration field, else null. Audio-mode beats use ASR-aligned timestamps,
 * so this is the LLM's claimed time, not a synthesized estimate.
 */
async function runBeatSheetAuditLoop(params: {
  latestUserMessage?: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  pacing: SessionState['spec']['global_constraints']['pacing']
  projectId: string
  promptRoute: UipPromptRoute
  timestampedTranscript: string
  transcriptWords: ReturnType<typeof flattenTranscriptWordsForAudit>
  transitionVideoModel?: string
}): Promise<AuditLoopState> {
  const MAX_ATTEMPTS = 2
  const auditFeedbackHistory: NonNullable<
    Parameters<typeof buildLongTakeBeatSheetExpertPrompt>[0]['auditFeedback']
  > = []
  const state: AuditLoopState = {
    auditPassed: false,
    lastAuditCorrectedSegmentTexts: undefined,
    lastAuditCorrectedTimeRanges: undefined,
    lastModelOutput: null,
    textAudited: false,
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const modelOutput = await callBeatSheetLlm({
      attempt,
      auditFeedbackHistory,
      latestUserMessage: params.latestUserMessage,
      modelSelectorTier: params.modelSelectorTier,
      pacing: params.pacing,
      promptRoute: params.promptRoute,
      projectId: params.projectId,
      timestampedTranscript: params.timestampedTranscript,
      transitionVideoModel: params.transitionVideoModel,
      transcriptWords: params.transcriptWords,
    })
    if (!modelOutput) {
      break
    }
    state.lastModelOutput = modelOutput

    const forAudit = buildBeatSheetForAudit(modelOutput)
    const audit = auditLongTakeBeatSheet(forAudit, params.transcriptWords, {
      maxDurationSeconds: resolveBeatSheetMaxDurationSeconds(),
    })
    state.textAudited = audit.textOk
    state.auditPassed = audit.textOk && audit.timeOk
    if (audit.textOk) {
      state.lastAuditCorrectedTimeRanges = audit.correctedTimeRanges
    }
    // Capture per-beat source-aligned text from the latest attempt
    // (cleanly-aligned beats only -- null entries mean alignment failed
    // for that beat and the LLM's text stays as the fallback).
    state.lastAuditCorrectedSegmentTexts = audit.correctedSegmentTexts

    if (state.auditPassed) {
      logger.info(
        `[uip] Timestamped beat-sheet audit passed ${formatLogFields({
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

function summarizeBeatsForLog(
  modelOutput: LongTakeBeatSheetModelOutput,
): Array<{ beat_id: number; duration_s: null | number; preview: string; words: number }> {
  return modelOutput.beat_sheet.map((b, idx) => {
    const text = (b.segment_text ?? '').trim()
    const words = text.length === 0 ? 0 : text.split(/\s+/).length
    const duration_s =
      b.time_range == null
        ? (b.duration ?? null)
        : Number((b.time_range.end - b.time_range.start).toFixed(2))
    return {
      beat_id: b.beat_id ?? idx + 1,
      words,
      duration_s,
      preview: text.length > 80 ? `${text.slice(0, 80)}...` : text,
    }
  })
}

/**
 * Rough beat-count estimate from ASR transcript words. Used only to scale
 * the per-call LLM timeout; the actual beat count comes from the LLM
 * output. The estimate uses the 6s midpoint (~15 words at 150 WPM) as a
 * conservative timeout heuristic. Mirrors the heuristic in
 * `estimateShotCountFromScript` in `tools/generate-visual-script.ts`.
 *
 * Exported for unit tests.
 */
export function estimateBeatCountFromTranscript(
  transcriptWords: ReturnType<typeof flattenTranscriptWordsForAudit>,
): number {
  if (transcriptWords.length === 0) {
    return 0
  }
  const WORDS_PER_BEAT_ESTIMATE = 15
  return Math.max(1, Math.ceil(transcriptWords.length / WORDS_PER_BEAT_ESTIMATE))
}

/**
 * Per-call LLM timeout (ms) for the timestamped beat-sheet tool. Scales with
 * the estimated beat count -- the LLM reads the full word-timestamped
 * transcript and emits one JSON object per beat with segment_text +
 * time_range. Clamped to [60s, 180s] so a tiny video still gets the old
 * flat baseline and an extreme overshoot can't run forever.
 *
 * Smaller per-beat overhead than `computeVisualScriptTimeoutMs` because
 * the output schema is structurally simpler (no visual_primary / audio_vo
 * / asset bindings -- just segment_text + time_range).
 *
 * Empirical observation: a ~10-min audio session (~2500 transcript
 * words ~= 167 estimated beats) timed out at the old
 * flat 60s ceiling on attempt=1 and never converged across the model
 * cascade, leaving the UIP session stuck in bootstrap_visual until the
 * 3h workflow idle-timeout closed it. Under the new curve that session
 * gets the 180s ceiling -- 3x the old budget.
 *
 * Exported for unit tests.
 */
export function computeBeatSheetTimeoutMs(estimatedBeatCount: number): number {
  const BASE_SECONDS = 45
  const SECONDS_PER_BEAT = 1
  const MIN_SECONDS = 60
  const MAX_SECONDS = 180
  const positive = Math.max(0, estimatedBeatCount || 0)
  const raw = BASE_SECONDS + positive * SECONDS_PER_BEAT
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, raw))
  return Math.round(seconds) * 1000
}
