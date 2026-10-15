type ShotPlanFallbackStatusSource = {
  fallbackCount?: number
  fallbackRatio?: number
  fallbackStartIndex?: number
  fallbackTotal?: number
  shotCount: number
  timingSource?: string
}

type ShotPlanFallbackStatusSourceWithFallback = ShotPlanFallbackStatusSource & {
  fallbackCount: number
  fallbackRatio: number
  fallbackTotal: number
}

export function appendShotPlanFallbackStatusDetail(
  detail: string | undefined,
  result: ShotPlanFallbackStatusSource,
): string | undefined {
  const fallbackDetail = getShotPlanFallbackStatusDetail(result)
  if (!fallbackDetail) {
    return detail
  }
  if (!detail) {
    return fallbackDetail
  }
  return `${detail}; ${fallbackDetail}`
}

export function getShotPlanFallbackStatusDetail(
  result: ShotPlanFallbackStatusSource,
): string | undefined {
  if (!hasShotPlanFallback(result)) {
    return undefined
  }
  return `Shot-plan used fallback timing for ${result.fallbackCount}/${result.fallbackTotal} shots (${formatPercent(result.fallbackRatio)}).`
}

export function getShotPlanFallbackStatusMeta(
  result: ShotPlanFallbackStatusSource,
): Record<string, number | string> {
  if (!hasShotPlanFallback(result)) {
    return {}
  }
  return {
    shotPlanFallbackCount: result.fallbackCount,
    shotPlanFallbackRatio: result.fallbackRatio,
    shotPlanFallbackStartIndex: result.fallbackStartIndex ?? 0,
    shotPlanFallbackTotal: result.fallbackTotal ?? result.shotCount,
    ...(result.timingSource ? { shotPlanTimingSource: result.timingSource } : {}),
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function hasShotPlanFallback(
  result: ShotPlanFallbackStatusSource,
): result is ShotPlanFallbackStatusSourceWithFallback {
  return (
    (result.fallbackCount ?? 0) > 0 &&
    result.fallbackRatio !== undefined &&
    result.fallbackTotal !== undefined
  )
}
