import { type RefObject, useLayoutEffect } from 'react'

/** Fits a text box's height to its text (each line break adds a line), up to `maxPx`; past that it scrolls. */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx: number,
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [maxPx, ref, value])
}
