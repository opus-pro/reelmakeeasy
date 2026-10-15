import { useEffect, useState } from 'react'

/**
 * Seconds elapsed since `startedAtMicros`, resolved against a single reference clock: a live
 * wall-clock that re-reads every second, unless `asOfMicros` pins it to a fixed moment (time travel
 * scrubbed into the past). There is no "time-travel mode" - just one clock that is either moving or frozen.
 * Pass `startedAtMicros: null` when there is nothing to time (returns 0, runs no timer). Both inputs
 * are integer microseconds (the envelope's processed_at); the lone `Date.now()` is the live tick.
 */
export function useElapsedSec(startedAtMicros: null | number, asOfMicros?: null | number): number {
  const live = asOfMicros == null
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    // Tick only when timing something live; a frozen reference or nothing to time needs no timer.
    if (startedAtMicros === null || !live) {
      return
    }
    const tick = () => setNowMs(Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAtMicros, live])

  if (startedAtMicros === null) {
    return 0
  }
  const referenceMicros = asOfMicros ?? nowMs * 1000
  return Math.max(0, Math.floor((referenceMicros - startedAtMicros) / 1_000_000))
}
