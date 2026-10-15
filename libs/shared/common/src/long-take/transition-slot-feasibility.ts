import { RETIME_MIN_SPEED_MULTIPLIER } from '../utils/retime-constants'

// A clip generated at the cap and slowed to the retime floor covers
// cap / RETIME_MIN_SPEED_MULTIPLIER seconds; the rest of the slot is frozen
// padding, and past this fraction of it the render is defective. So the
// recoverable slot is cap / (retime floor * (1 - pad fraction)).
export const MAX_TRANSITION_PAD_FRACTION = 0.4

// Largest duration grid any video model supports (seedance 2.5's 30s cap);
// used as the slot-guard ceiling when the concrete model is not known yet.
export const MAX_ANY_MODEL_SLOT_SECONDS = 30

const LOOP_START_RATIO = 1 / 3
const MIN_LOOP_SEGMENT_SECONDS = 0.1

export type TransitionSlot<T extends TransitionSlotShot = TransitionSlotShot> = {
  durationSeconds: number
  endSec: number
  fromShot: T
  fromShotId: string
  startSec: number
  toShot: T
  toShotId: string
  transitionId: string
}

export type TransitionSlotShot = {
  shot_id: string
  time_range: { end: number; start: number }
}

export function deriveTransitionSlots<T extends TransitionSlotShot>(
  shots: T[],
  totalDurationSeconds?: number,
  options?: { perfectLoop?: boolean },
): TransitionSlot<T>[] {
  if (shots.length === 0) {
    return []
  }

  const ordered = [...shots].sort((a, b) => a.time_range.start - b.time_range.start)
  const maxShotEnd = ordered.reduce((max, shot) => Math.max(max, shot.time_range.end), 0)
  const finalEndSec = Math.max(maxShotEnd, totalDurationSeconds ?? 0)

  if (ordered.length === 1) {
    const onlyShot = ordered[0]
    const startSec = 0
    const endSec = Math.max(onlyShot.time_range.end, finalEndSec)
    return [
      {
        durationSeconds: Math.max(1, endSec - startSec),
        endSec,
        fromShot: onlyShot,
        fromShotId: onlyShot.shot_id,
        startSec,
        toShot: onlyShot,
        toShotId: onlyShot.shot_id,
        transitionId: 'transition_0',
      },
    ]
  }

  const slots: TransitionSlot<T>[] = []
  const centers = ordered.map((shot) => (shot.time_range.start + shot.time_range.end) / 2)
  const loopStartSec = options?.perfectLoop
    ? computeLoopStartSec({ centers, finalEndSec, shots: ordered })
    : null
  const hasLoopSegment = loopStartSec !== null

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const fromShot = ordered[index]
    const toShot = ordered[index + 1]
    const startSec = index === 0 ? 0 : centers[index]
    const endSec =
      index === ordered.length - 2 && hasLoopSegment
        ? (loopStartSec as number)
        : index === ordered.length - 2
          ? Math.max(toShot.time_range.end, finalEndSec)
          : centers[index + 1]

    slots.push({
      durationSeconds: Math.max(1, endSec - startSec),
      endSec,
      fromShot,
      fromShotId: fromShot.shot_id,
      startSec,
      toShot,
      toShotId: toShot.shot_id,
      transitionId: `transition_${index}`,
    })
  }

  if (loopStartSec !== null) {
    const lastShot = ordered[ordered.length - 1]
    const firstShot = ordered[0]
    const endSec = Math.max(lastShot.time_range.end, finalEndSec)

    slots.push({
      durationSeconds: Math.max(1, endSec - loopStartSec),
      endSec,
      fromShot: lastShot,
      fromShotId: lastShot.shot_id,
      startSec: loopStartSec,
      toShot: firstShot,
      toShotId: firstShot.shot_id,
      transitionId: `transition_${ordered.length - 1}`,
    })
  }

  return slots
}

export function findOversizeTransitionSlots<T extends TransitionSlotShot>(
  slots: TransitionSlot<T>[],
  maxSlotSeconds: number,
): TransitionSlot<T>[] {
  const maxRecoverableSeconds = getMaxRecoverableSlotSeconds(maxSlotSeconds)
  return slots.filter((slot) => slot.durationSeconds > maxRecoverableSeconds)
}

export function getMaxRecoverableSlotSeconds(maxSlotSeconds: number): number {
  return maxSlotSeconds / (RETIME_MIN_SPEED_MULTIPLIER * (1 - MAX_TRANSITION_PAD_FRACTION))
}

function computeLoopStartSec(params: {
  centers: number[]
  finalEndSec: number
  shots: TransitionSlotShot[]
}): null | number {
  const { centers, finalEndSec, shots } = params
  if (shots.length < 2) {
    return null
  }

  const lastShot = shots[shots.length - 1]
  const lastStart = lastShot.time_range.start
  const lastEnd = Math.max(lastShot.time_range.end, finalEndSec)
  const lastDuration = Math.max(0, lastEnd - lastStart)
  if (lastDuration <= 0) {
    return null
  }

  const previousSegmentStart = shots.length - 2 === 0 ? 0 : centers[shots.length - 2]
  const candidate = lastStart + lastDuration * LOOP_START_RATIO
  const minLoopStart = Math.max(
    lastStart + MIN_LOOP_SEGMENT_SECONDS,
    previousSegmentStart + MIN_LOOP_SEGMENT_SECONDS,
  )
  const maxLoopStart = lastEnd - MIN_LOOP_SEGMENT_SECONDS
  if (minLoopStart >= maxLoopStart) {
    return null
  }

  return Math.min(maxLoopStart, Math.max(candidate, minLoopStart))
}
