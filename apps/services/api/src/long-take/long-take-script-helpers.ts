import { Logger } from '@reelmakeeasy/common/logger'
import { evaluateAndTrimScript } from '@reelmakeeasy/common/utils/script-limits-core'
import { countWords } from '@reelmakeeasy/common/utils/text'

const logger = new Logger('LongTakeScriptHelpers')

/**
 * Validate a user-supplied `targetDurationSeconds` against per-account
 * limits and basic shape. Returns the message-only error string for the
 * caller to wrap into a framework-specific exception, or `null` when the
 * input is acceptable (including the `undefined` case for "use default").
 */
export function validateTargetDurationSeconds(
  targetDurationSeconds: number | undefined,
  maxNonAudioDurationSeconds: number,
): null | string {
  if (typeof targetDurationSeconds !== 'number') {
    return null
  }
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    return `Requested duration must be a positive number of seconds; got ${targetDurationSeconds}.`
  }
  if (targetDurationSeconds > maxNonAudioDurationSeconds) {
    return `Requested duration ${targetDurationSeconds}s exceeds the ${maxNonAudioDurationSeconds}s limit for this account.`
  }
  return null
}

function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}

/** Hard-trim a script down to `effectiveMaxWords`, preferring sentence boundaries. */
export function clampScriptToHardCap(
  script: string,
  projectId: string,
  effectiveMaxWords: number,
): string {
  const trimResult = evaluateAndTrimScript(script, {
    maxWords: effectiveMaxWords,
    maxChars: Number.POSITIVE_INFINITY,
  })
  if (!trimResult.exceeded) {
    return script
  }
  logger.warn(
    `[long-take] Script still exceeded cap after rewrite; hard-trimming ${formatLogFields({
      projectId,
      wordCountBefore: trimResult.words,
      wordCountAfter: countWords(trimResult.withinLimitText),
      maxWords: effectiveMaxWords,
    })}`,
  )
  return trimResult.withinLimitText
}

/** Clamp a caller-supplied effective cap to the codebase ceiling. */
interface RewriteFn<F> {
  (params: {
    maxWords: number
    projectId: string
    script: string
    targetWords: number
    userId: string
  }): Promise<{ fallbackSignals: F[]; script: string }>
}

export function normalizeToSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function resolveEffectiveMaxWords(ceiling: number, requested?: number): number {
  if (!requested || !Number.isFinite(requested)) {
    return ceiling
  }
  return Math.min(ceiling, Math.max(1, Math.round(requested)))
}

export function stripImageTags(text: string): string {
  return text.replace(/@img\[[^\]]*\]\([^)]*\)/g, '').trim()
}

/**
 * Run the over-cap / out-of-tolerance rewrite pipeline and hard-clamp the
 * result. Returns the original script unchanged when within bounds.
 *
 * Passed-in `rewriteScript` lets callers reuse their existing rewrite-LLM
 * wiring (prompts, model preferences) without us re-importing it.
 */
export async function enforceScriptLengthBounds<F>(params: {
  effectiveMaxWords: number
  fallbackSignals: F[]
  hasUserLengthRequest: boolean
  lengthTolerance: number
  projectId: string
  rewriteScript: RewriteFn<F>
  rewriteTargetRatio: number
  script: string
  targetWords: number
  userId: string
}): Promise<string> {
  const {
    effectiveMaxWords,
    fallbackSignals,
    hasUserLengthRequest,
    lengthTolerance,
    projectId,
    rewriteScript,
    rewriteTargetRatio,
    targetWords,
    userId,
  } = params
  let { script } = params
  const wordCount = countWords(script)
  const ratioTarget = Math.round(effectiveMaxWords * rewriteTargetRatio)
  const minWords = Math.floor(targetWords * (1 - lengthTolerance))
  const maxAllowed = Math.min(Math.ceil(targetWords * (1 + lengthTolerance)), effectiveMaxWords)
  const overCap = wordCount > effectiveMaxWords
  const outOfTolerance =
    !overCap && hasUserLengthRequest && (wordCount < minWords || wordCount > maxAllowed)
  if (overCap || outOfTolerance) {
    const rewriteTarget = pickRewriteTarget({
      hasUserLengthRequest,
      overCap,
      ratioTarget,
      targetWords,
    })
    const result = await rewriteScript({
      maxWords: effectiveMaxWords,
      projectId,
      script,
      targetWords: rewriteTarget,
      userId,
    })
    script = result.script
    fallbackSignals.push(...result.fallbackSignals)
  }
  return clampScriptToHardCap(script, projectId, effectiveMaxWords)
}

function pickRewriteTarget(params: {
  hasUserLengthRequest: boolean
  overCap: boolean
  ratioTarget: number
  targetWords: number
}): number {
  const { hasUserLengthRequest, overCap, ratioTarget, targetWords } = params
  if (!overCap) {
    return targetWords
  }
  return hasUserLengthRequest ? Math.min(targetWords, ratioTarget) : ratioTarget
}
