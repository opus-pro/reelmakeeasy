import { cn } from '@shared/ui'
import type { CSSProperties } from 'react'

const DEFAULT_RING_BASE = 'rgba(255,255,255,0.1)'
const DEFAULT_RADIUS_PX = 24

const GLOW_BORDER_MASK_STYLE = {
  WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  WebkitMaskComposite: 'destination-out',
  mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  maskComposite: 'exclude',
} as const satisfies Record<string, string>

interface GlowBorderProps {
  className?: string
  /** Ring radius in px; must match the frame's content radius. Default 24 (rounded-3xl). */
  radiusPx?: number
  /** Static ring under the animated sweep; default faint white. Use `transparent` for sweep-only (no always-on stroke). */
  ringBase?: string
  /**
   * Which travelling highlight to run. `pill` is the original, tuned for a ~140px status pill;
   * `card` is the constant-speed perimeter arc that holds up at card width. Default `pill`, so
   * every existing caller keeps the sweep it shipped with.
   */
  sweep?: 'card' | 'pill'
}

// Renders a 1px glow border ring as an absolute overlay.
// Place inside a relative container that matches the content shape.
// The rounded class is passed via `className` so it merges over the default.
export function GlowBorder({
  className,
  radiusPx = DEFAULT_RADIUS_PX,
  ringBase = DEFAULT_RING_BASE,
  sweep = 'pill',
}: GlowBorderProps) {
  const style = {
    ...GLOW_BORDER_MASK_STYLE,
    borderRadius: `${radiusPx}px`,
    '--rc-border': ringBase,
  } as CSSProperties

  return (
    <div
      aria-hidden
      className={cn(
        sweep === 'card' ? 'rc-card-sheen' : 'rc-pill',
        'pointer-events-none absolute inset-0 rounded-3xl p-px',
        className,
      )}
      style={style}
    />
  )
}
