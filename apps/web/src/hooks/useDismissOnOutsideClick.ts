import { type RefObject, useEffect, useRef } from 'react'

export interface UseDismissOnOutsideClickOptions {
  enabled: boolean
  ignoreRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  ignoreSelectors?: readonly string[]
  onDismiss: () => void
}

export function useDismissOnOutsideClick({
  enabled,
  ignoreRefs,
  ignoreSelectors,
  onDismiss,
}: UseDismissOnOutsideClickOptions) {
  const optionsRef = useRef({ ignoreRefs, ignoreSelectors, onDismiss })
  optionsRef.current = { ignoreRefs, ignoreSelectors, onDismiss }

  useEffect(() => {
    if (!enabled) {
      return
    }
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) {
        return
      }
      const opts = optionsRef.current
      if (opts.ignoreRefs?.some((ref) => ref.current?.contains(target))) {
        return
      }
      if (opts.ignoreSelectors?.some((sel) => target.closest?.(sel))) {
        return
      }
      opts.onDismiss()
    }
    // Defer registration past the current event loop tick so the pointerdown
    // that opened the dismissable surface isn't caught as an outside click.
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown)
    })
    return () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [enabled])
}
