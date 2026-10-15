import { PatchOp, PlannerScopeSpec, Shot } from '../types'

export function buildVisualScriptAutoApplyOps(params: {
  currentShots: Shot[]
  nextShots: Shot[]
  scope: PlannerScopeSpec
}): PatchOp[] {
  const { currentShots, nextShots, scope } = params
  const currentShotIds = currentShots.map((shot) => shot.shot_id)
  const fullCoverage = isFullCoverageScope(scope, currentShotIds)

  if (scope.scope === 'FULL' || fullCoverage) {
    if (nextShots.length === 0 && currentShots.length > 0) {
      return []
    }
    const canonicalizedFullShots = canonicalizeFullShotIds(nextShots)
    if (jsonEqual(canonicalizedFullShots, currentShots)) {
      return []
    }
    return [{ op: 'replace_all_shots', shots: canonicalizedFullShots }]
  }

  if (scope.scope === 'SHOT_RANGE') {
    if (!scope.from_shot_id || !scope.to_shot_id) {
      return []
    }
    return buildRangeReplacementWithRetimeOps({
      currentShots,
      replacementShots: nextShots,
      fromShotId: scope.from_shot_id,
      toShotId: scope.to_shot_id,
    })
  }

  return buildShotIdsReplacementWithRetimeOps({
    currentShots,
    replacementShots: nextShots,
    scopeShotIds: scope.shot_ids ?? [],
  })
}

export function isFullCoverageScope(scope: PlannerScopeSpec, currentShotIds: string[]): boolean {
  if (scope.scope === 'FULL') {
    return true
  }
  if (currentShotIds.length === 0) {
    return false
  }

  if (scope.scope === 'SHOT_RANGE') {
    if (!scope.from_shot_id || !scope.to_shot_id) {
      return false
    }
    const fromIndex = currentShotIds.indexOf(scope.from_shot_id)
    const toIndex = currentShotIds.indexOf(scope.to_shot_id)
    if (fromIndex === -1 || toIndex === -1) {
      return false
    }
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    return start === 0 && end === currentShotIds.length - 1
  }

  const target = new Set(scope.shot_ids ?? [])
  return (
    target.size === currentShotIds.length && currentShotIds.every((shotId) => target.has(shotId))
  )
}

function buildRangeReplacementWithRetimeOps(params: {
  currentShots: Shot[]
  fromShotId: string
  replacementShots: Shot[]
  toShotId: string
}): PatchOp[] {
  const { currentShots, replacementShots, fromShotId, toShotId } = params
  const fromIndex = currentShots.findIndex((shot) => shot.shot_id === fromShotId)
  const toIndex = currentShots.findIndex((shot) => shot.shot_id === toShotId)
  if (fromIndex === -1 || toIndex === -1) {
    return []
  }

  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)
  const rangeShotIds = currentShots.slice(start, end + 1).map((shot) => shot.shot_id)
  const currentById = new Map(currentShots.map((shot) => [shot.shot_id, shot]))
  const replacementById = new Map(replacementShots.map((shot) => [shot.shot_id, shot]))
  const rangeStartTime = currentShots[start].time.start_s
  const oldRangeEndTime = currentShots[end].time.end_s

  let cursor = rangeStartTime
  const adjustedRangeShots: Shot[] = []
  for (const shotId of rangeShotIds) {
    const replacement = replacementById.get(shotId)
    if (!replacement) {
      continue
    }
    const current = currentById.get(shotId)
    const duration = shouldUseExistingDuration(current, replacement)
      ? getShotDuration(current as Shot)
      : getShotDuration(replacement)
    adjustedRangeShots.push({
      ...replacement,
      time: {
        start_s: Number(cursor.toFixed(2)),
        end_s: Number((cursor + duration).toFixed(2)),
      },
    })
    cursor += duration
  }

  if (adjustedRangeShots.length === 0) {
    return []
  }

  const newRangeEndTime = adjustedRangeShots[adjustedRangeShots.length - 1].time.end_s
  const delta = newRangeEndTime - oldRangeEndTime
  const retimeOps: PatchOp[] =
    Math.abs(delta) < 0.0001
      ? []
      : currentShots.slice(end + 1).map((shot) => ({
          op: 'retime_shot' as const,
          shot_id: shot.shot_id,
          start_s: Number((shot.time.start_s + delta).toFixed(2)),
          end_s: Number((shot.time.end_s + delta).toFixed(2)),
        }))

  return [
    {
      op: 'replace_shots_range',
      from_shot_id: adjustedRangeShots[0].shot_id,
      to_shot_id: adjustedRangeShots[adjustedRangeShots.length - 1].shot_id,
      shots: adjustedRangeShots,
    },
    ...retimeOps,
  ]
}

function buildShotIdsReplacementWithRetimeOps(params: {
  currentShots: Shot[]
  replacementShots: Shot[]
  scopeShotIds: string[]
}): PatchOp[] {
  const { currentShots, replacementShots, scopeShotIds } = params
  const scopedSet = new Set(scopeShotIds)
  const replacementById = new Map(replacementShots.map((shot) => [shot.shot_id, shot]))
  const oldDurationById = new Map(
    currentShots.map((shot) => [shot.shot_id, shot.time.end_s - shot.time.start_s]),
  )
  const newDurationById = new Map<string, number>()

  for (const shot of currentShots) {
    if (!scopedSet.has(shot.shot_id)) {
      newDurationById.set(shot.shot_id, oldDurationById.get(shot.shot_id) ?? 0)
      continue
    }
    const replacement = replacementById.get(shot.shot_id)
    if (!replacement) {
      newDurationById.set(shot.shot_id, oldDurationById.get(shot.shot_id) ?? 0)
      continue
    }
    const nextDuration = shouldUseExistingDuration(shot, replacement)
      ? (oldDurationById.get(shot.shot_id) ?? 0)
      : getShotDuration(replacement)
    newDurationById.set(shot.shot_id, nextDuration)
  }

  let cursor = 0
  const rebuiltTimeById = new Map<string, { end_s: number; start_s: number }>()
  for (const shot of currentShots) {
    const duration = newDurationById.get(shot.shot_id) ?? oldDurationById.get(shot.shot_id) ?? 0
    rebuiltTimeById.set(shot.shot_id, {
      start_s: Number(cursor.toFixed(2)),
      end_s: Number((cursor + duration).toFixed(2)),
    })
    cursor += duration
  }

  const ops: PatchOp[] = []

  for (const shot of currentShots) {
    const rebuiltTime = rebuiltTimeById.get(shot.shot_id)
    if (!rebuiltTime) {
      continue
    }

    if (scopedSet.has(shot.shot_id)) {
      const replacement = replacementById.get(shot.shot_id)
      if (!replacement) {
        continue
      }
      ops.push({
        op: 'replace_shots_range',
        from_shot_id: shot.shot_id,
        to_shot_id: shot.shot_id,
        shots: [
          {
            ...replacement,
            time: rebuiltTime,
          },
        ],
      })
      continue
    }

    const currentTime = shot.time
    if (
      Math.abs(currentTime.start_s - rebuiltTime.start_s) > 0.0001 ||
      Math.abs(currentTime.end_s - rebuiltTime.end_s) > 0.0001
    ) {
      ops.push({
        op: 'retime_shot',
        shot_id: shot.shot_id,
        start_s: rebuiltTime.start_s,
        end_s: rebuiltTime.end_s,
      })
    }
  }

  return ops
}

function canonicalizeFullShotIds(shots: Shot[]): Shot[] {
  return shots.map((shot, index) => ({
    ...shot,
    shot_id: `shot_${index + 1}`,
    order: index + 1,
  }))
}

function getShotDuration(shot: Shot): number {
  return Math.max(0.01, shot.time.end_s - shot.time.start_s)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeAudio(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function shouldUseExistingDuration(current: Shot | undefined, replacement: Shot): boolean {
  if (!current) {
    return false
  }
  return normalizeAudio(current.audio_vo) === normalizeAudio(replacement.audio_vo)
}
