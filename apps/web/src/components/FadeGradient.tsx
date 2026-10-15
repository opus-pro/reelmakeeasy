// Lift the three stops nearest the clear edge off the curve's near-zero tail so the fade
// reads a touch sooner.
const EARLY_STOP_MIN = [0.8, 1.8, 3.8]

// Opacity follows an easeInOutCubic curve over 13 evenly-spaced stops, so the page
// background ramps in smoothly with no hard banding.
const FADE_GRADIENT_STOPS = Array.from({ length: 13 }, (_, i) => {
  const progress = i / 12
  const curve = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
  const opacityPct = Math.max(curve * 100, EARLY_STOP_MIN[i] ?? 0).toFixed(1)
  const positionPct = (progress * 100).toFixed(1)
  return `color-mix(in srgb, var(--bg-background) ${opacityPct}%, transparent) ${positionPct}%`
}).join(', ')

// Plain two-stop fade matching the Figma top-nav spec.
const LINEAR_GRADIENT_STOPS = 'transparent 0%, var(--bg-background) 100%'

interface FadeGradientProps {
  gradientCurve?: 'eased' | 'linear'
  strongEdge?: 'bottom' | 'top'
}

/** Background fade from transparent at the content edge to the page background at the bar edge. */
export function FadeGradient({
  strongEdge = 'bottom',
  gradientCurve = 'eased',
}: FadeGradientProps) {
  const direction = strongEdge === 'bottom' ? 'to bottom' : 'to top'
  const stops = gradientCurve === 'linear' ? LINEAR_GRADIENT_STOPS : FADE_GRADIENT_STOPS
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(${direction}, ${stops})` }}
    />
  )
}
