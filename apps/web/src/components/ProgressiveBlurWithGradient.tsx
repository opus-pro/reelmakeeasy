import { ProgressiveBlur } from '@shared/ui'

import { FadeGradient } from '@/components/FadeGradient'

interface ProgressiveBlurWithGradientProps {
  gradientCurve?: 'eased' | 'linear'
  strongEdge?: 'bottom' | 'top'
}

/**
 * Frosted bar backdrop: a `ProgressiveBlur` layered over a `FadeGradient`, both keyed to
 * `strongEdge`. Render inside a positioned container; the layers fill it via `inset-0`.
 */
export function ProgressiveBlurWithGradient({
  strongEdge = 'bottom',
  gradientCurve = 'eased',
}: ProgressiveBlurWithGradientProps) {
  return (
    <>
      <ProgressiveBlur strongEdge={strongEdge} />
      <FadeGradient gradientCurve={gradientCurve} strongEdge={strongEdge} />
    </>
  )
}
