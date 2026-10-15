import { cn } from './lib/utils'

interface ProgressiveBlurProps {
  className?: string
  layers?: number
  maxBlur?: number
  strongEdge?: 'bottom' | 'left' | 'right' | 'top'
}

/**
 * Progressive (gradient) blur: the blur strength ramps across one axis instead of
 * being uniform, like iOS. Implemented by stacking masked `backdrop-filter` layers,
 * each blurring a band of the area, so the bands overlap into a smooth transition.
 *
 * Purely decorative and `pointer-events-none`, so it never blocks the content beneath.
 *
 * - `className`: extra classes for positioning/sizing the overlay (defaults to filling its parent).
 * - `layers`: number of stacked blur layers; more is a smoother gradient but heavier to composite.
 * - `maxBlur`: blur radius (px) of the strongest layer; layers ramp down from here exponentially.
 * - `strongEdge`: which edge carries the heaviest blur; the opposite edge is left clear.
 */
export function ProgressiveBlur({
  className,
  layers = 6,
  maxBlur = 24,
  strongEdge = 'top',
}: ProgressiveBlurProps) {
  const isHorizontal = strongEdge === 'left' || strongEdge === 'right'
  const maskDirection = isHorizontal ? 'to right' : 'to bottom'
  // Each band spans ~2 steps and overlaps its neighbours; +1 leaves room at the clear edge.
  const step = 100 / (layers + 1)
  const minBlur = maxBlur / 2 ** (layers - 1)

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {Array.from({ length: layers }, (_, i) => {
        // Band `i` sits nearer the strong edge's opposite end as i grows; key blur
        // intensity to the chosen strong edge so the heaviest blur lands there.
        const intensityIndex = strongEdge === 'top' || strongEdge === 'left' ? layers - 1 - i : i
        const blur = minBlur * 2 ** intensityIndex
        const mask = `linear-gradient(${maskDirection}, rgba(0,0,0,0) ${i * step}%, rgba(0,0,0,1) ${
          (i + 1) * step
        }%, rgba(0,0,0,1) ${(i + 2) * step}%, rgba(0,0,0,0) ${(i + 3) * step}%)`
        return (
          <div
            className="absolute inset-0"
            key={i}
            style={{
              WebkitBackdropFilter: `blur(${blur}px)`,
              WebkitMaskImage: mask,
              backdropFilter: `blur(${blur}px)`,
              maskImage: mask,
            }}
          />
        )
      })}
    </div>
  )
}
