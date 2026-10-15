import {
  SCRIPT_CJK_CHARS_PER_MINUTE,
  SCRIPT_WORDS_PER_MINUTE,
} from '@reelmakeeasy/common/story-mode/long-video-attribution'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'

import { countWords } from '../word-budget'

const NON_SPACE_SEPARATED_SCRIPT_CHAR_PATTERN =
  /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F]/g

export type DurationSource = 'other' | 'script_estimate' | 'user_explicit'
export type PastedScriptDurationResolution =
  | {
      naturalDurationSeconds: null
      pastedScriptFit: null
      resolvedDurationSeconds: null | number
      status: 'no_script'
      wordCount: null
    }
  | {
      naturalDurationSeconds: number
      pastedScriptFit: null
      resolvedDurationSeconds: null
      status: 'exceeds_duration_limit'
      wordCount: number
    }
  | {
      naturalDurationSeconds: number
      pastedScriptFit: null
      resolvedDurationSeconds: null
      status: 'exceeds_script_limit'
      wordCount: number
    }
  | {
      naturalDurationSeconds: number
      pastedScriptFit: null
      resolvedDurationSeconds: null
      status: 'needs_fit_confirmation'
      wordCount: number
    }
  | {
      naturalDurationSeconds: number
      pastedScriptFit: PastedScriptFit
      resolvedDurationSeconds: number
      status: 'confirmed'
      wordCount: number
    }

export type PastedScriptFit = 'preserve' | 'rewrite_to_duration'

export interface ResolvePastedScriptDurationInput {
  allowOverLimitFitConfirmation?: boolean
  durationSource?: DurationSource | null
  pastedScriptFit?: null | PastedScriptFit
  plannerDurationSeconds: null | number
  script: null | string
  scriptLanguage?: null | string
}

/** Measures mixed-language narration units at their own deterministic rates. */
export function estimatePastedScriptNaturalDurationSeconds(script: string): number {
  const wordCount = countWords(script)
  const nonSpaceSeparatedUnitCount =
    script.match(NON_SPACE_SEPARATED_SCRIPT_CHAR_PATTERN)?.length ?? 0
  const spaceSeparatedWordCount = Math.max(0, wordCount - nonSpaceSeparatedUnitCount)
  return Math.ceil(
    (nonSpaceSeparatedUnitCount * 60) / SCRIPT_CJK_CHARS_PER_MINUTE +
      (spaceSeparatedWordCount * 60) / SCRIPT_WORDS_PER_MINUTE,
  )
}

/**
 * Resolves the runtime-owned duration and rewrite permission for a pasted script.
 *
 * A planner may classify the user's duration intent, but it must not calculate
 * the script length. Only an explicit shorter user duration can authorize a
 * rewrite, and only after the user selects the rewrite option.
 */
export function resolvePastedScriptDuration(
  input: ResolvePastedScriptDurationInput,
): PastedScriptDurationResolution {
  if (!input.script?.trim()) {
    return {
      status: 'no_script',
      wordCount: null,
      naturalDurationSeconds: null,
      resolvedDurationSeconds: input.plannerDurationSeconds,
      pastedScriptFit: null,
    }
  }

  const wordCount = countWords(input.script)
  const naturalDurationSeconds = estimatePastedScriptNaturalDurationSeconds(input.script)
  const requestedDurationSeconds = isPositiveFiniteNumber(input.plannerDurationSeconds)
    ? input.plannerDurationSeconds
    : null
  const maxDurationSeconds = EXPANDED_STORY_MODE_LIMITS.maxNonAudioDurationSeconds
  const exceedsDurationLimit = naturalDurationSeconds > maxDurationSeconds
  const exceedsScriptLimit = wordCount > EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords

  if (exceedsDurationLimit || exceedsScriptLimit) {
    const canRequestBoundedRewrite =
      input.durationSource === 'user_explicit' &&
      requestedDurationSeconds !== null &&
      requestedDurationSeconds <= maxDurationSeconds

    if (canRequestBoundedRewrite && input.pastedScriptFit === 'rewrite_to_duration') {
      return confirmed(
        requestedDurationSeconds,
        naturalDurationSeconds,
        wordCount,
        'rewrite_to_duration',
      )
    }

    if (input.allowOverLimitFitConfirmation === true && input.pastedScriptFit !== 'preserve') {
      const rewriteDurationSeconds =
        requestedDurationSeconds !== null && requestedDurationSeconds <= maxDurationSeconds
          ? requestedDurationSeconds
          : Math.min(naturalDurationSeconds, maxDurationSeconds)
      return confirmed(
        rewriteDurationSeconds,
        naturalDurationSeconds,
        wordCount,
        'rewrite_to_duration',
      )
    }

    return {
      status: exceedsDurationLimit ? 'exceeds_duration_limit' : 'exceeds_script_limit',
      wordCount,
      naturalDurationSeconds,
      resolvedDurationSeconds: null,
      pastedScriptFit: null,
    }
  }

  if (input.durationSource !== 'user_explicit' || requestedDurationSeconds === null) {
    return confirmed(naturalDurationSeconds, naturalDurationSeconds, wordCount, 'preserve')
  }

  if (requestedDurationSeconds >= naturalDurationSeconds) {
    return confirmed(requestedDurationSeconds, naturalDurationSeconds, wordCount, 'preserve')
  }

  if (input.pastedScriptFit === 'preserve') {
    return confirmed(naturalDurationSeconds, naturalDurationSeconds, wordCount, 'preserve')
  }

  if (input.pastedScriptFit === 'rewrite_to_duration') {
    return confirmed(
      requestedDurationSeconds,
      naturalDurationSeconds,
      wordCount,
      'rewrite_to_duration',
    )
  }

  return {
    status: 'needs_fit_confirmation',
    wordCount,
    naturalDurationSeconds,
    resolvedDurationSeconds: null,
    pastedScriptFit: null,
  }
}

function confirmed(
  resolvedDurationSeconds: number,
  naturalDurationSeconds: number,
  wordCount: number,
  pastedScriptFit: PastedScriptFit,
): PastedScriptDurationResolution {
  return {
    status: 'confirmed',
    wordCount,
    naturalDurationSeconds,
    resolvedDurationSeconds,
    pastedScriptFit,
  }
}

function isPositiveFiniteNumber(value: null | number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
