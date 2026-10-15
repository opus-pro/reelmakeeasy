import { useEffect, useRef, useState } from 'react'

// Default duration of the simulated progress window (no-upscale export, ~1.5min).
const DEFAULT_ESTIMATED_DURATION_MS = 90000

interface UseExportProgressOptions {
  // Simulated duration of the progress window in ms. Defaults to ~1.5min; the
  // caller passes a longer value (~5.5min) for an upscale export so the fake
  // progress does not slam into 90% and freeze there for minutes (Topaz adds
  // ~5min). Purely cosmetic pacing -- no backend progress is read.
  estimatedDurationMs?: number
  isActive: boolean
  isCompleted: boolean
  onComplete?: () => void
}

/**
 * Custom hook for simulating export progress with exponential ease-out curve.
 * The curve fills `estimatedDurationMs` (default ~1.5min) and caps at 90% until
 * completion, then jumps to 100%. It reads NO backend progress -- an upscale
 * export just passes a longer estimatedDurationMs so the pace matches reality.
 */
export function useExportProgress({
  estimatedDurationMs = DEFAULT_ESTIMATED_DURATION_MS,
  isActive,
  isCompleted,
  onComplete,
}: UseExportProgressOptions) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Keep progress at 100% when completed; do not reset on isActive -> false
    if (isCompleted) {
      return
    }

    if (!isActive) {
      setProgress(0)
      return
    }

    const startTime = Date.now()
    const windowMs = estimatedDurationMs > 0 ? estimatedDurationMs : DEFAULT_ESTIMATED_DURATION_MS
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const ratio = Math.min(elapsed / windowMs, 1)
      // Exponential ease-out: fast at start, slow near end
      const easedProgress = 1 - Math.pow(1 - ratio, 2)
      setProgress(Math.floor(Math.min(90, easedProgress * 100)))
    }, 1000)

    return () => clearInterval(interval)
  }, [estimatedDurationMs, isActive, isCompleted])

  // Keep the latest onComplete in a ref so the completion effect below can depend
  // only on isCompleted -- an unstable callback identity would otherwise re-run it
  // and reset the 500ms timer every render (could keep firing / never settle).
  // A ref write during render is fine here: it is idempotent, with no external side
  // effect, and never reads a stale value because the timer fires later.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  // Jump to 100% when completed
  useEffect(() => {
    if (!isCompleted) {
      return
    }
    setProgress(100)
    // Track + clear the timer so an unmount before it fires does not leak an
    // active timer. Depend only on isCompleted (onComplete is read via the ref),
    // so a changing callback identity cannot re-trigger or reset this.
    const timer = setTimeout(() => onCompleteRef.current?.(), 500)
    return () => clearTimeout(timer)
  }, [isCompleted])

  return { progress }
}
