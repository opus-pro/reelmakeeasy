import { cn } from '@shared/ui'
import type { ComponentPropsWithRef, ReactNode } from 'react'

import { GlowBorder } from './GlowBorder'

// Props include `ref`, which lands on the outer element via the spread below so
// callers can measure the frame's own width.
interface GlowBorderFrameProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  children: ReactNode
  contentClassName?: string
  /** Passed to GlowBorder: static ring color under the sweep (`transparent` = no always-on stroke). */
  glowRingBase?: string
  hideGlowBorder?: boolean
  /**
   * Corner radius (px) below `sm`. The ring writes its radius as an inline style, so the mobile
   * value has to arrive as an `!important` class -- a plain one cannot beat it.
   */
  mobileRadius?: 24 | 30
  /** Corner radius (px) for the content layer and the glow ring. Default 24. */
  radius?: 20 | 24 | 32 | 34
  /** Passed to GlowBorder: which travelling highlight the ring runs. Default `pill`. */
  sweep?: 'card' | 'pill'
}

// The ring's radius is an inline style, hence the `!` on its half of the pair.
const MOBILE_RADIUS_CLASS: Record<
  NonNullable<GlowBorderFrameProps['mobileRadius']>,
  { content: string; ring: string }
> = {
  24: { content: 'max-sm:rounded-3xl', ring: 'max-sm:!rounded-3xl' },
  30: { content: 'max-sm:rounded-[30px]', ring: 'max-sm:!rounded-[30px]' },
}

const RADIUS_CLASS: Record<NonNullable<GlowBorderFrameProps['radius']>, string> = {
  20: 'rounded-2xl',
  24: 'rounded-3xl',
  32: 'rounded-[32px]',
  34: 'rounded-4xl',
}

export function GlowBorderFrame({
  children,
  className,
  contentClassName,
  glowRingBase,
  hideGlowBorder = false,
  mobileRadius,
  radius = 24,
  sweep,
  ...props
}: GlowBorderFrameProps) {
  // Keyed off the preset's own radius scale (20 / 24 / 34), so adding a stop here is a one-line
  // change rather than another ternary.
  const radiusClass = RADIUS_CLASS[radius]
  const mobileRadiusClass = mobileRadius ? MOBILE_RADIUS_CLASS[mobileRadius] : undefined
  return (
    <div className={cn('relative', className)} {...props}>
      {/* content layer - same structure as MessageBox, no wrapper interference */}
      <div
        className={cn(
          radiusClass,
          mobileRadiusClass?.content,
          'bg-menu/50 p-2 backdrop-blur-2xl',
          contentClassName,
        )}
      >
        {children}
      </div>
      <GlowBorder
        className={cn(radiusClass, mobileRadiusClass?.ring, hideGlowBorder && 'opacity-0')}
        radiusPx={radius}
        ringBase={glowRingBase}
        sweep={sweep}
      />
    </div>
  )
}
