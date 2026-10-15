import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { validateShotPlanTranscriptCoverage } from '@reelmakeeasy/common/long-take/shot-plan-coverage'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'

import type {
  BuildLongTakeShotPlanActivityParams,
  BuildLongTakeShotPlanActivityResult,
  LongTakeShotPlanItem,
} from '../../workflows/long-take/types'
import type { LongTakeBeatSheetOutput } from '../long-take-experts-analysis'
import { buildLongTakeVideoPromptsPrompt } from '../prompts/long-take-video-prompts-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { normalizeShotPlanDurations, resolveShotPlanTargetSec } from './shot-plan-duration'
import { shouldApplyMusicLipSyncToShot } from './shot-plan-lipsync'
import {
  type LongTakeVideoPrompt,
  runLongTakeVideoPromptCompletion,
} from './shot-plan-video-prompts'
import { expandNumericPercentageToken } from './spoken-number-tokens'
import {
  buildKeyframePrompt,
  createLongTakeStorage,
  type LongTakeVisualScriptItem,
  readLongTakeBeatSheetOutput,
  readLongTakeKeyframePromptOverrides,
} from './storage'

const MATCH_SCORE_THRESHOLD = 0.6

type ShotPlanFallbackStats = {
  fallbackCount: number
  fallbackRatio: number
  fallbackScope: 'full' | 'none' | 'partial'
  fallbackStartIndex: number
  fallbackTotal: number
}

type VideoPromptPlan = {
  prompt: string
  requiresLipSync: boolean
}

export async function buildLongTakeShotPlan(
  params: BuildLongTakeShotPlanActivityParams,
): Promise<BuildLongTakeShotPlanActivityResult> {
  const { pipelineContext, projectId, promptRoute, userEmail, userId, visualScriptPath } = params
  return withLongTakeContext({ pipelineContext, projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      logger.info(
        `[long-take] Build shot plan started ${formatLogFields({
          projectId,
          userId,
          visualScriptPath,
        })}`,
      )

      try {
        await storage.ensureDir('long_take')
        const visualScript =
          await storage.readJsonFile<LongTakeVisualScriptItem[]>(visualScriptPath)
        const keyframePromptOverrides = await readLongTakeKeyframePromptOverrides(storage)
        const fallbackPrompt = 'Placeholder keyframe'
        const videoPrompts = await generateLongTakeVideoPrompts({
          fallbackPrompt,
          promptRoute,
          projectId,
          userId,
          visualScript,
        })

        // Load beat sheet for timing-aware path selection
        let beatSheet: LongTakeBeatSheetOutput | null = null
        try {
          beatSheet = await readLongTakeBeatSheetOutput(storage)
        } catch {
          // Beat sheet unavailable - will fall back to LCS
        }
        beatSheet = resolveBeatSheetForRoute(beatSheet, promptRoute)

        const transcript = await storage.readJsonFile<TranscriptData>(
          STORY_LOADER_PATHS.transformedTranscriptPath,
        )
        const {
          tokens: transcriptTokens,
          words: transcriptWords,
          totalDurationSec,
        } = buildTranscriptIndex(transcript)

        let shotPlan: LongTakeShotPlanItem[]
        let timingSource: string
        let fallbackStats: null | ShotPlanFallbackStats = null

        if (beatSheet && isBeatSheetReady(beatSheet, visualScript.length)) {
          shotPlan = await buildShotsFromBeatTimeRanges({
            beatSheet,
            fallbackPrompt,
            videoPrompts,
            visualScript,
          })
          timingSource = 'beat_sheet_time_range'
        } else {
          const { matches, fallbackIndex } = computeMatchSpans(visualScript, transcriptTokens)
          const cutoffIndex = fallbackIndex === -1 ? visualScript.length : fallbackIndex

          shotPlan = await buildMatchedShots({
            visualScript,
            matches,
            transcriptWords,
            fallbackPrompt,
            videoPrompts,
            startIndex: 0,
            endIndex: cutoffIndex,
          })

          if (fallbackIndex !== -1) {
            fallbackStats = recordShotPlanFallback({
              fallbackIndex,
              projectId,
              visualScriptLength: visualScript.length,
            })
            const fallbackStart =
              shotPlan.length > 0 ? shotPlan[shotPlan.length - 1].time_range.end : 0
            shotPlan.push(
              ...(await buildFallbackShots({
                visualScript,
                fallbackStartIndex: fallbackIndex,
                fallbackStartTime: fallbackStart,
                totalDurationSec,
                fallbackPrompt,
                videoPrompts,
              })),
            )
          }
          timingSource = fallbackStats ? 'lcs_transcript_with_fallback' : 'lcs_transcript'
        }

        const keyframePromptOverrideCount = applyShotPlanKeyframePromptOverrides(
          shotPlan,
          keyframePromptOverrides,
        )

        const repairedShotCount = repairNonMonotonicShotTimeRanges(shotPlan, totalDurationSec)
        if (repairedShotCount > 0) {
          logger.warn(
            `[long-take] Repaired non-monotonic shot time ranges ${formatLogFields({
              projectId,
              repairedShotCount,
              totalShots: shotPlan.length,
              timingSource,
            })}`,
          )
        }

        // Normalization owns the whole timeline, not just overlong shots: the plan must be
        // contiguous and reach totalDurationSec. Leaving the tail to transition planning was
        // the bug -- deriveTransitionSlots stretches the FINAL bridge to the
        // voiceover length, so an uncovered tail becomes one oversize slot and the run dies
        // non-retryably on the model cap. MP3 padding is still harmless: a sub-second stretch
        // cannot push a shot past the 10s cap, so it adds no shot (see closeShotPlanGaps).
        // That bridge is stretched to the ffprobed audio length, not the transcript end, so the
        // silence or music past the last spoken word is tail the plan must cover too.
        const planEndSec = resolveShotPlanTargetSec(totalDurationSec, params.audioDurationSeconds)
        const normalization = normalizeShotPlanDurations(shotPlan, {
          promptRoute,
          totalDurationSec: planEndSec,
        })
        shotPlan = normalization.shotPlan
        if (
          normalization.longShotSplitCount > 0 ||
          normalization.tailFillShotCount > 0 ||
          normalization.gapClosedShotCount > 0 ||
          normalization.tailExtendedSeconds > 0
        ) {
          logger.warn(
            `[long-take] Normalized overlong shot plan timings ${formatLogFields({
              projectId,
              timingSource,
              transcriptDurationSec: totalDurationSec,
              longShotSplitCount: normalization.longShotSplitCount,
              gapClosedShotCount: normalization.gapClosedShotCount,
              tailExtendedSeconds: normalization.tailExtendedSeconds,
              tailFillShotCount: normalization.tailFillShotCount,
              shotCount: shotPlan.length,
            })}`,
          )
        }

        const coverageValidation = validateShotPlanTranscriptCoverage(shotPlan, planEndSec)
        if (!coverageValidation.ok) {
          logger.error(
            `[long-take] Shot plan coverage validation failed ${formatLogFields({
              projectId,
              timingSource,
              ...coverageValidation.metrics,
              reasons: coverageValidation.reasons,
            })}`,
          )
          throw ApplicationFailure.nonRetryable(
            `Shot plan coverage insufficient: ${coverageValidation.reasons.join('; ')}`,
            'SHOT_PLAN_COVERAGE_INSUFFICIENT',
          )
        }

        const shotPlanPath = 'long_take/shot_plan.json'
        await storage.writeJsonFile(shotPlanPath, shotPlan)

        logger.info(
          `[long-take] Build shot plan completed ${formatLogFields({
            projectId,
            shotCount: shotPlan.length,
            timingSource,
            fallbackCount: fallbackStats?.fallbackCount ?? 0,
            fallbackRatio: fallbackStats?.fallbackRatio ?? 0,
            keyframePromptOverrideCount,
            longShotSplitCount: normalization.longShotSplitCount,
            gapClosedShotCount: normalization.gapClosedShotCount,
            repairedShotCount,
            tailExtendedSeconds: normalization.tailExtendedSeconds,
            tailFillShotCount: normalization.tailFillShotCount,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          ...(fallbackStats
            ? {
                fallbackCount: fallbackStats.fallbackCount,
                fallbackRatio: fallbackStats.fallbackRatio,
                fallbackStartIndex: fallbackStats.fallbackStartIndex,
                fallbackTotal: fallbackStats.fallbackTotal,
                timingSource,
              }
            : { timingSource }),
          shotCount: shotPlan.length,
          shotPlan,
          shotPlanPath,
        }
      } catch (error) {
        logger.error(
          `[long-take] Build shot plan failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

export function buildTranscriptIndex(transcript: TranscriptData): {
  tokens: string[]
  totalDurationSec: number
  words: TranscriptWord[]
} {
  const transcriptItems = flattenTranscriptWords(transcript)
  const tokens = transcriptItems.map((item) => item.token)
  const words = transcriptItems.map((item) => item.word)
  const totalDurationSec = words.length > 0 ? words[words.length - 1].end : 0
  return { tokens, totalDurationSec, words }
}

export function computeMatchSpans(
  visualScript: LongTakeVisualScriptItem[],
  transcriptTokens: string[],
): {
  fallbackIndex: number
  matches: Array<{ endIndex: number; score: number; startIndex: number }>
} {
  const matches: Array<{ endIndex: number; score: number; startIndex: number }> = []
  let cursor = 0
  let fallbackIndex = -1

  for (let index = 0; index < visualScript.length; index += 1) {
    const item = visualScript[index]
    const targetTokens = tokenizeText(item?.audio || '')
    const maxSearchSpan = Math.max(60, targetTokens.length * 12)
    const match = findBestMatchSpan({
      cursor,
      maxSearchSpan,
      targetTokens,
      transcriptTokens,
    })

    if (!match || match.score < MATCH_SCORE_THRESHOLD) {
      fallbackIndex = index
      break
    }

    matches.push(match)
    cursor = Math.max(cursor, match.endIndex + 1)
  }

  return { fallbackIndex, matches }
}

function applyShotPlanKeyframePromptOverrides(
  shotPlan: LongTakeShotPlanItem[],
  overridesByShotId: Map<string, string>,
): number {
  let updatedCount = 0
  for (const shot of shotPlan) {
    const shotId = shot.shot_id?.trim()
    if (!shotId) {
      continue
    }
    const override = overridesByShotId.get(shotId)?.trim()
    if (!override || override === shot.keyframe_prompt) {
      continue
    }
    shot.keyframe_prompt = override
    updatedCount += 1
  }
  return updatedCount
}

async function buildFallbackShots(params: {
  fallbackPrompt: string
  fallbackStartIndex: number
  fallbackStartTime: number
  totalDurationSec: number
  videoPrompts: VideoPromptPlan[]
  visualScript: LongTakeVisualScriptItem[]
}): Promise<LongTakeShotPlanItem[]> {
  const { visualScript, fallbackStartIndex, fallbackStartTime, totalDurationSec, fallbackPrompt } =
    params
  const { videoPrompts } = params
  const remainingCount = visualScript.length - fallbackStartIndex
  if (remainingCount <= 0) {
    return []
  }

  const remainingDuration = Math.max(0, totalDurationSec - fallbackStartTime)
  const perShotDuration = remainingDuration / remainingCount
  const shotPlan: LongTakeShotPlanItem[] = []

  for (let offset = 0; offset < remainingCount; offset += 1) {
    const index = fallbackStartIndex + offset
    const item = visualScript[index]
    const start = fallbackStartTime + perShotDuration * offset
    const end = offset === remainingCount - 1 ? totalDurationSec : start + perShotDuration
    shotPlan.push(await buildShotItem(item, index, fallbackPrompt, start, end, videoPrompts[index]))
  }

  return shotPlan
}

function buildFallbackVideoPrompt(
  item: LongTakeVisualScriptItem | undefined,
  fallback: string,
): VideoPromptPlan {
  const visual = item?.visual
  if (visual) {
    const description = visual.core_description?.trim() || visual.description?.trim()
    if (description) {
      return { prompt: description, requiresLipSync: false }
    }
  }
  return { prompt: item?.audio?.trim() || fallback, requiresLipSync: false }
}

async function buildMatchedShots(params: {
  endIndex: number
  fallbackPrompt: string
  matches: Array<{ endIndex: number; startIndex: number }>
  startIndex: number
  transcriptWords: TranscriptWord[]
  videoPrompts: VideoPromptPlan[]
  visualScript: LongTakeVisualScriptItem[]
}): Promise<LongTakeShotPlanItem[]> {
  const { visualScript, matches, transcriptWords, fallbackPrompt, startIndex, endIndex } = params
  const { videoPrompts } = params
  const shotPlan: LongTakeShotPlanItem[] = []

  for (let index = startIndex; index < endIndex; index += 1) {
    const item = visualScript[index]
    const match = matches[index]
    const nextMatch = matches[index + 1]
    const startTime = transcriptWords[match.startIndex]?.start ?? 0
    const endTime = nextMatch
      ? (transcriptWords[nextMatch.startIndex]?.start ?? startTime)
      : (transcriptWords[match.endIndex]?.end ?? startTime)

    shotPlan.push(
      await buildShotItem(item, index, fallbackPrompt, startTime, endTime, videoPrompts[index]),
    )
  }

  return shotPlan
}

function buildShotItem(
  item: LongTakeVisualScriptItem | undefined,
  index: number,
  fallbackPrompt: string,
  start: number,
  end: number,
  videoPrompt?: VideoPromptPlan,
): LongTakeShotPlanItem {
  const keyframePrompt = buildKeyframePrompt(item, fallbackPrompt)
  const resolvedVideoPrompt = videoPrompt?.prompt?.trim() || keyframePrompt
  const shotId = item?.shot_id?.trim() || `LT_S${index + 1}`

  const visual = item?.visual

  const coreDesc = visual?.core_description || visual?.description || keyframePrompt
  const entryPrompt = visual?.entry_action ?? coreDesc
  const exitPrompt = visual?.exit_action ?? coreDesc

  const audio = item?.audio || ''
  return {
    audio,
    entry_prompt: entryPrompt,
    exit_prompt: exitPrompt,
    human_presence: item?.human_presence ?? 'unknown',
    keyframe_prompt: keyframePrompt,
    requires_lip_sync: shouldApplyMusicLipSyncToShot({
      audio,
      entryPrompt,
      exitPrompt,
      humanPresence: item?.human_presence,
      keyframePrompt,
      requiredByPrompt: videoPrompt?.requiresLipSync,
      usedAssetIds: item?.used_asset_id,
      videoPrompt: resolvedVideoPrompt,
    }),
    shot_id: shotId,
    time_range: {
      start,
      end: Math.max(start, end),
    },
    used_asset_id: item?.used_asset_id || [],
    video_prompt: resolvedVideoPrompt,
  }
}

function computeLcsMatch(
  target: string[],
  window: string[],
): { matchedCount: number; matchedIndices: number[] } {
  const rows = target.length + 1
  const cols = window.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (target[i - 1] === window[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const matchedIndices: number[] = []
  let i = rows - 1
  let j = cols - 1
  while (i > 0 && j > 0) {
    if (target[i - 1] === window[j - 1]) {
      matchedIndices.push(j - 1)
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1
    } else {
      j -= 1
    }
  }

  matchedIndices.reverse()
  return { matchedCount: dp[rows - 1][cols - 1], matchedIndices }
}

function findBestMatchSpan(params: {
  cursor: number
  maxSearchSpan: number
  targetTokens: string[]
  transcriptTokens: string[]
}): null | { endIndex: number; score: number; startIndex: number } {
  const { cursor, maxSearchSpan, targetTokens, transcriptTokens } = params
  if (targetTokens.length === 0 || cursor >= transcriptTokens.length) {
    return null
  }

  const exactMatch = findExactMatchSpan({
    cursor,
    maxSearchSpan,
    targetTokens,
    transcriptTokens,
  })
  if (exactMatch) {
    return exactMatch
  }

  const maxStart = Math.min(transcriptTokens.length - 1, cursor + maxSearchSpan)
  const extraTokens = Math.max(3, Math.floor(targetTokens.length * 0.5))
  const windowSize = Math.max(targetTokens.length + extraTokens, targetTokens.length)

  let bestStart = -1
  let bestEnd = -1
  let bestScore = -1
  let bestSpan = Number.POSITIVE_INFINITY

  for (let start = cursor; start <= maxStart; start += 1) {
    const remaining = transcriptTokens.length - start
    const windowLen = Math.min(remaining, windowSize)
    if (windowLen <= 0) {
      break
    }

    const window = transcriptTokens.slice(start, start + windowLen)
    const { matchedCount, matchedIndices } = computeLcsMatch(targetTokens, window)
    const score = matchedCount / targetTokens.length

    if (matchedIndices.length === 0) {
      continue
    }

    const candidateStart = start + matchedIndices[0]
    const candidateEnd = start + matchedIndices[matchedIndices.length - 1]
    const candidateSpan = candidateEnd - candidateStart + 1
    const isBetter =
      score > bestScore ||
      (score === bestScore &&
        (candidateSpan < bestSpan ||
          (candidateSpan === bestSpan &&
            (candidateEnd < bestEnd ||
              (candidateEnd === bestEnd && (bestStart === -1 || candidateStart < bestStart))))))

    if (isBetter) {
      bestScore = score
      bestStart = candidateStart
      bestEnd = candidateEnd
      bestSpan = candidateSpan
    }
  }

  if (bestStart < 0 || bestEnd < 0) {
    return null
  }
  return { startIndex: bestStart, endIndex: bestEnd, score: bestScore }
}

function findExactMatchSpan(params: {
  cursor: number
  maxSearchSpan: number
  targetTokens: string[]
  transcriptTokens: string[]
}): null | { endIndex: number; score: number; startIndex: number } {
  const { cursor, maxSearchSpan, targetTokens, transcriptTokens } = params
  const maxStart = Math.min(transcriptTokens.length - targetTokens.length, cursor + maxSearchSpan)
  if (maxStart < cursor) {
    return null
  }

  for (let start = cursor; start <= maxStart; start += 1) {
    const matches = targetTokens.every(
      (token, offset) => transcriptTokens[start + offset] === token,
    )
    if (matches) {
      return {
        endIndex: start + targetTokens.length - 1,
        score: 1,
        startIndex: start,
      }
    }
  }

  return null
}

function flattenTranscriptWords(
  transcript: TranscriptData,
): Array<{ token: string; word: TranscriptWord }> {
  const items: Array<{ token: string; word: TranscriptWord }> = []
  for (const segment of transcript.segments || []) {
    for (const word of segment.words || []) {
      for (const token of tokenizeText(word.word)) {
        items.push({ token, word })
      }
    }
  }
  return items
}

async function generateLongTakeVideoPrompts(params: {
  fallbackPrompt: string
  projectId: string
  promptRoute?: BuildLongTakeShotPlanActivityParams['promptRoute']
  userId: string
  visualScript: LongTakeVisualScriptItem[]
}): Promise<VideoPromptPlan[]> {
  const { projectId, promptRoute, userId, visualScript, fallbackPrompt } = params
  const fallback = visualScript.map((item) => buildFallbackVideoPrompt(item, fallbackPrompt))
  if (!visualScript.length) {
    return fallback
  }

  try {
    logger.info(
      `[long-take] Generating video prompts ${formatLogFields({
        projectId,
        count: visualScript.length,
      })}`,
    )
    const prompt = buildLongTakeVideoPromptsPrompt({
      promptRoute,
      visualScript,
    })
    const response = await runLongTakeVideoPromptCompletion({
      projectId,
      prompt,
      userId,
    })

    if (response.length !== visualScript.length) {
      logger.warn(
        `[long-take] Video prompt count mismatch, falling back where needed ${formatLogFields({
          expected: visualScript.length,
          received: response.length,
        })}`,
      )
    }

    logger.info(
      `[long-take] Video prompts generated ${formatLogFields({
        projectId,
        requested: visualScript.length,
        received: response.length,
      })}`,
    )
    return normalizeVideoPrompts(response, fallback, { allowLipSync: promptRoute === 'music' })
  } catch (error) {
    logger.warn(
      `[long-take] Failed to build video prompts ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
    return fallback
  }
}

/**
 * Snap any shot whose `time_range` is not strictly monotonic with its
 * neighbors back into the local window between the previous and next shot.
 *
 * The LCS aligner builds shots in array order, so the array order is the
 * source of truth for "shot N comes before shot N+1". Sometimes a single
 * shot ends up with a start time that falls outside [prev.end, next.start]
 * -- typically when the shot's audio text fuzzy-matches an earlier or later
 * stretch of transcript than its neighbors. Left unrepaired, downstream
 * `buildTransitionPlan` re-sorts by `time_range.start`, which moves the
 * misplaced shot into a different slot and produces a transition video
 * whose duration spans the gap (observed once: shot_51 with
 * start=29.54 sorted between shot_5 and shot_6, making transition_4 a
 * 155s video).
 *
 * Implementation note: the pass is a forward-only envelope. Every shot's
 * clamped start is `max(original_start, runningPrevEnd)`, and the running
 * prevEnd is propagated from the repaired end so adjacent corrupt shots
 * cannot pull a later shot's anchor backward. A non-monotonic next.start
 * is therefore ignored as a clamping anchor -- it would only push the
 * current shot's end below prevEnd, breaking the invariant the pass exists
 * to enforce. (Earlier two-sided clamping pulled shot_50 in that
 * case down to (29.54, 29.54) because shot_51's corrupt
 * start poisoned the upper bound.)
 *
 * Returns the number of shots whose `time_range` was repaired so callers
 * can log the rate.
 */
export function repairNonMonotonicShotTimeRanges(
  shotPlan: LongTakeShotPlanItem[],
  totalDurationSec: number,
): number {
  if (shotPlan.length === 0) {
    return 0
  }
  let repairedCount = 0
  let prevEnd = 0
  for (const shot of shotPlan) {
    const { start, end } = shot.time_range
    // Allow a tiny epsilon so floating-point ties between consecutive shots
    // (a typical end === next.start boundary) are not flagged as corrupt.
    const startOutOfRange = start + 0.001 < prevEnd
    const endOutOfRange = end < prevEnd || end < start
    if (!startOutOfRange && !endOutOfRange) {
      prevEnd = end
      continue
    }
    const clampedStart = Math.max(start, prevEnd)
    // Floor end at clampedStart (zero-duration shots stay zero-duration but
    // sit at the right offset); cap at totalDurationSec so the last shot's
    // garbage end can't overflow the timeline.
    const clampedEnd = Math.max(Math.min(end, totalDurationSec), clampedStart)
    shot.time_range = { start: clampedStart, end: clampedEnd }
    prevEnd = clampedEnd
    repairedCount += 1
  }
  return repairedCount
}

// Beat sheet is ready to use directly when text is audited (time ranges are derived from
// transcript and accurate), regardless of whether all durations satisfy [2, 10s].
export function buildShotPlanFallbackStats(params: {
  fallbackIndex: number
  visualScriptLength: number
}): ShotPlanFallbackStats {
  const { fallbackIndex, visualScriptLength } = params
  const fallbackCount = fallbackIndex < 0 ? 0 : Math.max(0, visualScriptLength - fallbackIndex)
  const fallbackRatio = visualScriptLength > 0 ? fallbackCount / visualScriptLength : 0
  return {
    fallbackCount,
    fallbackRatio,
    fallbackScope: fallbackCount === 0 ? 'none' : fallbackIndex === 0 ? 'full' : 'partial',
    fallbackStartIndex: fallbackIndex,
    fallbackTotal: visualScriptLength,
  }
}

async function buildShotsFromBeatTimeRanges(params: {
  beatSheet: LongTakeBeatSheetOutput
  fallbackPrompt: string
  videoPrompts: VideoPromptPlan[]
  visualScript: LongTakeVisualScriptItem[]
}): Promise<LongTakeShotPlanItem[]> {
  const { beatSheet, fallbackPrompt, videoPrompts, visualScript } = params
  const count = Math.min(visualScript.length, beatSheet.beat_sheet.length)
  const shots: LongTakeShotPlanItem[] = []
  for (let i = 0; i < count; i++) {
    const beat = beatSheet.beat_sheet[i]
    const timeRange = beat.time_range
    if (!timeRange) {
      continue
    } // guarded by isBeatSheetReady
    shots.push(
      await buildShotItem(
        visualScript[i],
        i,
        fallbackPrompt,
        timeRange.start,
        timeRange.end,
        videoPrompts[i],
      ),
    )
  }
  return shots
}

function expandAlignmentToken(token: string): string[] {
  const raw = token
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
  const percentageTokens = expandNumericPercentageToken(raw)
  if (percentageTokens) {
    return percentageTokens
  }

  const normalized = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

  // Keep this map focused on common ASR/script tokenization disagreements.
  // Unmapped forms fall back conservatively instead of borrowing distant words.
  const expansions: Record<string, string[]> = {
    "there's": ['there', 'is'],
    "that's": ['that', 'is'],
    "what's": ['what', 'is'],
    "who's": ['who', 'is'],
    "he's": ['he', 'is'],
    "she's": ['she', 'is'],
    "it's": ['it', 'is'],
    "here's": ['here', 'is'],
    "where's": ['where', 'is'],
    "when's": ['when', 'is'],
    "why's": ['why', 'is'],
    "how's": ['how', 'is'],
    "let's": ['let', 'us'],
    "i'm": ['i', 'am'],
    "you're": ['you', 'are'],
    "we're": ['we', 'are'],
    "they're": ['they', 'are'],
    "i've": ['i', 'have'],
    "you've": ['you', 'have'],
    "we've": ['we', 'have'],
    "they've": ['they', 'have'],
    "i'd": ['i', 'would'],
    "you'd": ['you', 'would'],
    "he'd": ['he', 'would'],
    "she'd": ['she', 'would'],
    "we'd": ['we', 'would'],
    "they'd": ['they', 'would'],
    "i'll": ['i', 'will'],
    "you'll": ['you', 'will'],
    "he'll": ['he', 'will'],
    "she'll": ['she', 'will'],
    "we'll": ['we', 'will'],
    "they'll": ['they', 'will'],
    "can't": ['can', 'not'],
    "won't": ['will', 'not'],
    "don't": ['do', 'not'],
    "doesn't": ['does', 'not'],
    "didn't": ['did', 'not'],
    "isn't": ['is', 'not'],
    "aren't": ['are', 'not'],
    "wasn't": ['was', 'not'],
    "weren't": ['were', 'not'],
    "hasn't": ['has', 'not'],
    "haven't": ['have', 'not'],
    "hadn't": ['had', 'not'],
    "shouldn't": ['should', 'not'],
    "couldn't": ['could', 'not'],
    "wouldn't": ['would', 'not'],
    "mustn't": ['must', 'not'],
    "needn't": ['need', 'not'],
    voiceover: ['voice', 'over'],
  }

  return expansions[normalized] ?? [token]
}

function isBeatSheetReady(
  beatSheet: LongTakeBeatSheetOutput | null,
  visualScriptLength: number,
): boolean {
  if (!beatSheet) {
    return false
  }
  return (
    (beatSheet.text_audited === true || beatSheet.time_range_audited === true) &&
    beatSheet.beat_sheet.length === visualScriptLength &&
    beatSheet.beat_sheet.every((b) => b.time_range != null)
  )
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeVideoPrompts(
  prompts: LongTakeVideoPrompt[],
  fallback: VideoPromptPlan[],
  options: { allowLipSync: boolean },
): VideoPromptPlan[] {
  const normalized = [...fallback]
  for (let index = 0; index < fallback.length; index += 1) {
    const candidate = prompts[index]?.prompt?.trim()
    if (candidate) {
      normalized[index] = {
        prompt: candidate,
        requiresLipSync: options.allowLipSync && prompts[index]?.requires_lip_sync === true,
      }
    }
  }
  return normalized
}

function recordShotPlanFallback(params: {
  fallbackIndex: number
  projectId: string
  visualScriptLength: number
}): ShotPlanFallbackStats {
  const { projectId } = params
  const stats = buildShotPlanFallbackStats(params)

  logger.warn(
    `[long-take] Shot-plan transcript alignment used fallback timing ${formatLogFields({
      projectId,
      fallbackCount: stats.fallbackCount,
      fallbackRatio: stats.fallbackRatio,
      fallbackStartIndex: stats.fallbackStartIndex,
      fallbackTotal: stats.fallbackTotal,
    })}`,
  )

  return stats
}

// A music beat sheet (time_range_audited without text_audited) only drives timing while the
// downstream route remains music. If the route was demoted after the sheet landed, drop it so
// timing falls back to LCS even when the visual script length happens to collide with the beat
// count. isBeatSheetReady separately requires a 1:1 beat/visual-script count match.
export function resolveBeatSheetForRoute(
  beatSheet: LongTakeBeatSheetOutput | null,
  promptRoute: BuildLongTakeShotPlanActivityParams['promptRoute'],
): LongTakeBeatSheetOutput | null {
  const isMusicBeatSheet = beatSheet?.time_range_audited === true && beatSheet.text_audited !== true
  return isMusicBeatSheet && promptRoute !== 'music' ? null : beatSheet
}

function tokenizeText(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap((token) => token.split(/\p{Pd}+/u))
    .flatMap(expandAlignmentToken)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0)
}
