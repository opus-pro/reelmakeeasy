export type MetricTagValue = 'false' | 'true' | 'unknown'
export type RecoveryIssueType = 'both' | 'gibberish' | 'reframe' | 'text' | 'upside_down'
export type RecoveryOutcome = 'not_recovered' | 'recovered'
export type TextCheckOutcome = 'gave_up' | 'pass' | 'regenerated'

/** Quality flags + attempt number shared by the keyframe candidate metrics. */
interface KeyframeCandidateQualitySignals {
  attempt: number
  hasGibberish?: boolean | null
  reframe?: boolean | null
  textIssue?: boolean | null
  upsideDown?: boolean | null
}

/**
 * Counter hook for the selected keyframe: orientation / reframe /
 * gibberish outcomes, plus rerun-recovery accounting when the initial
 * candidate had a detected issue. No metrics backend is wired, so it emits nothing.
 */
export function emitFinalKeyframeMetrics(params: {
  finalCandidate: KeyframeCandidateQualitySignals
  initialCandidate: KeyframeCandidateQualitySignals
  styleText?: string
}): void {
  const { finalCandidate, initialCandidate } = params

  const recoveryOutcome = getRecoveryOutcome({
    finalCandidate,
    initialCandidate,
  })
  if (!recoveryOutcome) {
    return
  }
}

export function getMetricTagValue(value: boolean | null | undefined): MetricTagValue {
  if (value === null || value === undefined) {
    return 'unknown'
  }
  return value ? 'true' : 'false'
}

export function getRecoveryIssueType(result: {
  hasGibberish?: boolean | null
  reframe?: boolean | null
  textIssue?: boolean | null
  upsideDown?: boolean | null
}): RecoveryIssueType {
  if (result.reframe === true && result.upsideDown === true) {
    return 'both'
  }
  if (result.reframe === true) {
    return 'reframe'
  }
  if (result.upsideDown === true) {
    return 'upside_down'
  }
  if (result.hasGibberish !== true && result.textIssue === true) {
    return 'text'
  }
  return 'gibberish'
}

export function getRecoveryOutcome(params: {
  finalCandidate: {
    hasGibberish?: boolean | null
    reframe?: boolean | null
    textIssue?: boolean | null
    upsideDown?: boolean | null
  }
  initialCandidate: {
    hasGibberish?: boolean | null
    reframe?: boolean | null
    textIssue?: boolean | null
    upsideDown?: boolean | null
  }
}): null | RecoveryOutcome {
  const { finalCandidate, initialCandidate } = params
  if (!hasDetectedIssue(initialCandidate)) {
    return null
  }
  return isCleanCandidate(finalCandidate) ? 'recovered' : 'not_recovered'
}

export function getTextCheckOutcome(params: {
  finalCandidate: { textIssue?: boolean | null }
  initialCandidate: { textIssue?: boolean | null }
}): null | TextCheckOutcome {
  const { finalCandidate, initialCandidate } = params
  if (initialCandidate.textIssue === undefined || initialCandidate.textIssue === null) {
    return null
  }
  if (!initialCandidate.textIssue) {
    return 'pass'
  }
  return finalCandidate.textIssue === false ? 'regenerated' : 'gave_up'
}

export function hasDetectedIssue(result: {
  hasGibberish?: boolean | null
  reframe?: boolean | null
  textIssue?: boolean | null
  upsideDown?: boolean | null
}): boolean {
  return (
    result.reframe === true ||
    result.upsideDown === true ||
    result.hasGibberish === true ||
    result.textIssue === true
  )
}

export function isCleanCandidate(result: {
  hasGibberish?: boolean | null
  reframe?: boolean | null
  textIssue?: boolean | null
  upsideDown?: boolean | null
}): boolean {
  // textIssue is not required to be strictly false: undefined means the check
  // was not run (gate off / passthrough) and null means it could not run, and
  // neither may disqualify an otherwise clean candidate.
  return (
    result.reframe === false &&
    result.upsideDown === false &&
    result.hasGibberish === false &&
    result.textIssue !== true
  )
}
