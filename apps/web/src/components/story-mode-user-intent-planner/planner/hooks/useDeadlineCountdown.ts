'use client'

import { useEffect, useRef, useState } from 'react'

function computeSecondsRemaining(deadlineAt: string): number {
  return Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000))
}

/**
 * Counts down to a deadline and fires onDeadlineReached exactly once when it hits zero.
 * Returns secondsRemaining (>= 0), or null when deadlineAt is null (no countdown active).
 * Resets when deadlineAt changes.
 */
export function useDeadlineCountdown(
  deadlineAt: null | string,
  onDeadlineReached?: () => void,
): null | number {
  const [secondsRemaining, setSecondsRemaining] = useState<null | number>(() =>
    deadlineAt ? computeSecondsRemaining(deadlineAt) : null,
  )
  const onDeadlineReachedRef = useRef(onDeadlineReached)
  onDeadlineReachedRef.current = onDeadlineReached
  const hasTriggered = useRef(false)

  useEffect(() => {
    hasTriggered.current = false

    if (!deadlineAt) {
      setSecondsRemaining(null)
      return
    }

    const refresh = () => {
      const remaining = computeSecondsRemaining(deadlineAt)
      setSecondsRemaining(remaining)
      return remaining
    }

    const interval = setInterval(() => {
      const remaining = refresh()
      if (remaining <= 0 && !hasTriggered.current) {
        hasTriggered.current = true
        clearInterval(interval)
        onDeadlineReachedRef.current?.()
      }
    }, 1000)

    refresh()

    return () => {
      clearInterval(interval)
    }
  }, [deadlineAt])

  return secondsRemaining
}
