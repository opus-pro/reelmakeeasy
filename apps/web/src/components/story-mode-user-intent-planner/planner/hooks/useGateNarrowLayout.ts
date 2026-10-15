'use client'

import { useLayoutEffect, useState } from 'react'

import { useIsMobile } from '@/util/browserUtils'

import type { GateVariant } from '../../defaults'

/**
 * Frame width at or below which a confirm gate stacks. The wide row needs the
 * 72px decorative card, a readable title, and two buttons -- about 560px once
 * the frame's own p-2 counts. Verified at 420px (stacks) and 920px (row).
 */
const NARROW_MAX_WIDTH_PX = 560

/**
 * Whether a confirm gate should stack, measured from the gate's own box: canvas
 * gates sit beside a 476px chat pane, so a 1200px viewport leaves them 420px and
 * the viewport is not a usable proxy. Legacy spans the viewport and
 * keeps its sm breakpoint. Returns a ref callback for the gate's outer element.
 */
export function useGateNarrowLayout(variant: GateVariant) {
  // State, not a ref, so the effect re-runs when the node changes: a remount
  // swaps it, and a ref's `.current` moving is invisible to effects -- the observer would keep watching a detached node.
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [isContainerNarrow, setIsContainerNarrow] = useState(false)
  const isMobile = useIsMobile()
  const isCanvas = variant === 'canvas'

  // Layout effect, not effect: the first measurement lands before paint, so the
  // wide row never flashes inside a narrow container on mount.
  useLayoutEffect(() => {
    if (!element || !isCanvas) {
      return
    }

    const update = () => setIsContainerNarrow(element.clientWidth <= NARROW_MAX_WIDTH_PX)
    update()

    // jsdom does not implement ResizeObserver
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [element, isCanvas])

  return { isNarrow: isCanvas ? isContainerNarrow : isMobile, ref: setElement }
}
