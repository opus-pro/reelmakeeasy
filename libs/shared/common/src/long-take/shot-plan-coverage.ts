const MAX_REASONABLE_SHOT_DURATION_SECONDS = 15
const MIN_COVERAGE_GUARD_DURATION_SECONDS = 120
const MIN_SHOT_PLAN_END_COVERAGE_RATIO = 0.9

export interface ShotPlanCoverageInput {
  time_range?: null | { end?: null | number }
}

export type ShotPlanCoverageValidationMetrics = {
  endCoverageRatio: number
  maxShotEndSec: number
  minExpectedShotCount: number
  shotCount: number
  totalDurationSec: number
}

export type ShotPlanCoverageValidationResult =
  | {
      metrics: ShotPlanCoverageValidationMetrics
      ok: false
      reasons: string[]
    }
  | {
      metrics: ShotPlanCoverageValidationMetrics
      ok: true
      reasons: []
    }

export function validateShotPlanTranscriptCoverage(
  shotPlan: ShotPlanCoverageInput[],
  totalDurationSec: number,
): ShotPlanCoverageValidationResult {
  const safeTotalDurationSec = Number.isFinite(totalDurationSec) ? Math.max(0, totalDurationSec) : 0
  const shotCount = shotPlan.length
  const maxShotEndSec = shotPlan.reduce(
    (max, shot) => Math.max(max, Number(shot.time_range?.end ?? 0)),
    0,
  )
  const minExpectedShotCount =
    safeTotalDurationSec > 0
      ? Math.max(1, Math.ceil(safeTotalDurationSec / MAX_REASONABLE_SHOT_DURATION_SECONDS))
      : 0
  const endCoverageRatio =
    safeTotalDurationSec > 0 ? Math.min(1, maxShotEndSec / safeTotalDurationSec) : 1

  const metrics = {
    endCoverageRatio,
    maxShotEndSec,
    minExpectedShotCount,
    shotCount,
    totalDurationSec: safeTotalDurationSec,
  } satisfies ShotPlanCoverageValidationMetrics

  if (safeTotalDurationSec < MIN_COVERAGE_GUARD_DURATION_SECONDS) {
    return { metrics, ok: true, reasons: [] }
  }

  const reasons: string[] = []
  if (shotCount < minExpectedShotCount) {
    reasons.push(
      `shotCount ${shotCount} is below minimum ${minExpectedShotCount} for ${safeTotalDurationSec.toFixed(
        2,
      )}s transcript`,
    )
  }
  if (endCoverageRatio < MIN_SHOT_PLAN_END_COVERAGE_RATIO) {
    reasons.push(
      `max shot end ${maxShotEndSec.toFixed(2)}s covers only ${(endCoverageRatio * 100).toFixed(
        1,
      )}% of ${safeTotalDurationSec.toFixed(2)}s transcript`,
    )
  }

  return reasons.length > 0 ? { metrics, ok: false, reasons } : { metrics, ok: true, reasons: [] }
}
