/**
 * A code video's pace (Motion Reel, Claude Animation): the finished render played faster or
 * slower as a whole, voices, music, sounds and motion together, so everything stays in sync. The
 * voices keep their own pitch: the sound is stretched in time, never resampled, so a faster
 * speaker doesn't sound higher.
 */
export const VIDEO_SPEED = { max: 1.5, min: 0.8, step: 0.05 } as const

/** A speed the user can pick: within the range, on a step. */
export function isVideoSpeed(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < VIDEO_SPEED.min - 1e-9 || value > VIDEO_SPEED.max + 1e-9) return false
  const steps = value / VIDEO_SPEED.step
  return Math.abs(steps - Math.round(steps)) < 1e-6
}

/** `1.25x`, `1x`. */
export function videoSpeedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}×`
}
