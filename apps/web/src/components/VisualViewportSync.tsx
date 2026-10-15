'use client'

import { useEffect } from 'react'

/**
 * Syncs the Visual Viewport API to CSS custom properties and dispatches resize
 * so layout recalculates after pinch-zoom on mobile (fixes dashboard UI breakage).
 * Only runs in the browser; has no effect on SSR or desktop-only flows.
 */
export function VisualViewportSync() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return
    }

    const vv = window.visualViewport

    const sync = () => {
      const height = Math.round(vv.height)
      const width = Math.round(vv.width)
      // offsetTop = how far the visual viewport is shifted down within the layout
      // viewport (e.g. when iOS scrolls a focused input into view above the keyboard).
      // Consumers can top-anchor to this to stay pinned above the keyboard.
      const offsetTop = Math.round(vv.offsetTop)
      document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`)
      document.documentElement.style.setProperty('--visual-viewport-width', `${width}px`)
      document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offsetTop}px`)
      window.dispatchEvent(new Event('resize'))
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)

    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      document.documentElement.style.removeProperty('--visual-viewport-height')
      document.documentElement.style.removeProperty('--visual-viewport-width')
      document.documentElement.style.removeProperty('--visual-viewport-offset-top')
    }
  }, [])

  return null
}
