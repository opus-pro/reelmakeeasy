import type { StoryboardShot } from '@/components/story-mode-user-intent-planner/state-types'
import { formatSecondsToTime } from '@/util/time-utils'

export interface ShotSecondsBounds {
  endSeconds: number
  startSeconds: number
}

export function formatShotDurationLabel(bounds: ShotSecondsBounds | undefined): string | undefined {
  return bounds ? `${getShotDurationSeconds(bounds)}s` : undefined
}

export function formatShotLabel(shotNumber: number): string {
  return `Shot ${shotNumber}`
}

export function formatShotTimeRangeLabel(
  bounds: ShotSecondsBounds | undefined,
): string | undefined {
  return bounds
    ? `${formatSecondsToTime(bounds.startSeconds)}–${formatSecondsToTime(bounds.endSeconds)}`
    : undefined
}

export function getShotDescription(title: string): string {
  const [, ...tail] = title.split(' · ')
  const description = tail.join(' · ').trim()
  return description || title
}

export function getShotDurationSeconds(bounds: ShotSecondsBounds): number {
  return Math.max(0, Math.round(bounds.endSeconds - bounds.startSeconds))
}

export function getShotSecondsBounds(
  shot: Pick<StoryboardShot, 'endSeconds' | 'startSeconds'>,
): ShotSecondsBounds | undefined {
  const startSeconds = shot.startSeconds ?? Number.NaN
  const endSeconds = shot.endSeconds ?? Number.NaN
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return undefined
  }
  return { endSeconds, startSeconds }
}
