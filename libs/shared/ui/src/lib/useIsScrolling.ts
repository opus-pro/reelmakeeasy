import { type RefObject, useEffect, useRef, useState } from 'react'

const SCROLL_IDLE_DELAY_MS = 600

/**
 * True while `ref`'s element is actively scrolling, flipping back to false
 * `SCROLL_IDLE_DELAY_MS` after the last scroll event. Used to reveal an
 * overlay scrollbar only during scroll rather than on hover
 * (misses touch/keyboard/programmatic scroll) or always-on.
 *
 * `enabled` (default true) skips attaching the listener entirely -- callers
 * that conditionally need this (e.g. an opt-in prop on a shared layout
 * primitive) should pass `false` rather than always paying for a listener
 * and re-renders no consumer reads.
 */
export function useIsScrolling(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [isScrolling, setIsScrolling] = useState(false)
  const idleTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) {
      setIsScrolling(false)
      return
    }

    const handleScroll = () => {
      setIsScrolling(true)
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }
      idleTimeoutRef.current = setTimeout(() => setIsScrolling(false), SCROLL_IDLE_DELAY_MS)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }
      setIsScrolling(false)
    }
  }, [ref, enabled])

  return isScrolling
}
