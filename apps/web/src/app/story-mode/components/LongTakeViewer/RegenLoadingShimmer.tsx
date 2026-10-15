'use client'

import { cn } from '@shared/ui'
import { useEffect, useState } from 'react'

export const REGEN_SHIMMER_GRADIENT_STYLE = {
  background:
    'linear-gradient(180deg, rgba(255, 255, 255, 0.00) 0%, #FFF 48%, #FFF 52%, rgba(255, 255, 255, 0.00) 100%)',
} as const

interface RegenLoadingShimmerProps {
  className?: string
  durationSeconds?: number
  // Opt-in fix for a compositing bug: in a static (non-repainting) container some browsers
  // rasterize this blurred, transform-animated layer BLANK on first paint, so the animation
  // plays on the compositor over an empty raster and never shows. When set, the first frame
  // renders with the animation disabled + hidden, then enables it next frame -- forcing a
  // fresh rasterization (the programmatic version of toggling `animation: none` in devtools).
  // Off by default so existing usages (over repainting video) are unchanged.
  forceRepaintOnMount?: boolean
  /** Match the clipped region of the parent (e.g. keyframe cards use rounded-md). */
  roundedClassName?: string
}

export function RegenLoadingShimmer({
  className,
  durationSeconds = 3,
  forceRepaintOnMount = false,
  roundedClassName = 'rounded-md',
}: RegenLoadingShimmerProps) {
  // When not forcing, `ready` starts true -> identical to the original (animate immediately).
  // When forcing, it starts false and flips on the next frame.
  const [ready, setReady] = useState(!forceRepaintOnMount)
  useEffect(() => {
    // Mount-only. If `ready` is already true (not forcing), setting it again is a no-op.
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-[1] overflow-hidden',
        roundedClassName,
        className,
      )}
    >
      <div
        className="absolute left-1/2 top-1/2 h-2/3 w-[300%] -translate-x-1/2 -translate-y-1/2 opacity-40 blur-sm animate-[shimmer-diagonal_3s_ease-in-out_infinite]"
        style={
          ready
            ? { ...REGEN_SHIMMER_GRADIENT_STYLE, animationDuration: `${durationSeconds}s` }
            : { ...REGEN_SHIMMER_GRADIENT_STYLE, animation: 'none', visibility: 'hidden' }
        }
      />
    </div>
  )
}
