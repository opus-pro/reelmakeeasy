'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Commits a value once changes pause: a slider's arrow-key presses each "commit", and
 * saving every step would rebake the video per press. A pending value is committed when
 * the control goes away, so a quick change is never lost.
 */
export function useDebouncedCommit(onCommit: (value: number) => void, ms: number) {
  const timer = useRef<null | ReturnType<typeof setTimeout>>(null)
  const pending = useRef<null | number>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current !== null) commitRef.current(pending.current)
    },
    [],
  )

  return useCallback(
    (value: number) => {
      pending.current = value
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const v = pending.current
        pending.current = null
        if (v !== null) commitRef.current(v)
      }, ms)
    },
    [ms],
  )
}
