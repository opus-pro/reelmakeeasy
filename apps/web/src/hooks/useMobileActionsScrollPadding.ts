import { useLayoutEffect, useState } from 'react'

const MOBILE_ACTIONS_SCROLL_GAP_PX = 8 // spacing-2

export function useMobileActionsScrollPadding(element: HTMLElement | null) {
  const [padding, setPadding] = useState(0)

  useLayoutEffect(() => {
    if (!element) {
      setPadding(0)
      return
    }

    const updatePadding = () => {
      const measured = Math.ceil(element.getBoundingClientRect().height)
      // When the element is hidden or not laid out yet, skip the gap to avoid
      // unexplained empty space at the bottom of the scroll container.
      setPadding(measured > 0 ? measured + MOBILE_ACTIONS_SCROLL_GAP_PX : 0)
    }

    updatePadding()

    const resizeObserver = (globalThis.ResizeObserver && new ResizeObserver(updatePadding)) ?? null

    if (resizeObserver) {
      resizeObserver.observe(element)
    } else {
      window.addEventListener('resize', updatePadding)
    }

    return () => {
      resizeObserver?.disconnect()
      if (!resizeObserver) {
        window.removeEventListener('resize', updatePadding)
      }
    }
  }, [element])

  return padding
}
