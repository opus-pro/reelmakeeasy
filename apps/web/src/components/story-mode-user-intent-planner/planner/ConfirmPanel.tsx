'use client'

import { cn } from '@shared/ui'
import type { ReactNode } from 'react'

import { useGateNarrowLayout } from './hooks/useGateNarrowLayout'
import { GlowBorderFrame } from './GlowBorderFrame'

// Redesigned confirm gate shell for canvas mode (the Confirm Panel
// design). Same props as ConfirmBannerCard so the stateful gate cards can
// swap containers by variant.
//
// Narrow: no decorative icon, copy stacked above the actions. Keyed on the
// panel's measured width, not the viewport -- the gate's box is ~780px narrower
// than the window next to the 476px chat pane.
interface ConfirmPanelProps {
  dataTestId?: string
  description?: ReactNode
  hideGlowBorder?: boolean
  icon?: ReactNode
  right: ReactNode
  title: ReactNode
}

export function ConfirmPanel({
  dataTestId,
  description,
  hideGlowBorder = false,
  icon,
  right,
  title,
}: ConfirmPanelProps) {
  const { isNarrow, ref } = useGateNarrowLayout('canvas')

  return (
    <GlowBorderFrame
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      data-testid={dataTestId ?? 'uip-confirm-panel'}
      glowRingBase="transparent"
      hideGlowBorder={hideGlowBorder}
      radius={20}
      ref={ref}
    >
      <div
        className={cn(
          'flex min-h-9.5',
          isNarrow ? 'flex-col gap-2 p-2' : 'items-center gap-3 py-3 pl-2 pr-3',
        )}
      >
        {icon && !isNarrow ? <div className="shrink-0">{icon}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-base font-medium leading-[20px] text-white">{title}</p>
          {description ? (
            <div className="text-sm font-normal leading-[22px] text-white/50">{description}</div>
          ) : null}
        </div>
        {/* Narrow: flex-auto so buttons share the row in proportion to their
            labels, and wrap -- the brand gate's cap states put three of them
            here, with labels as long as "Continue without saving". */}
        <div
          className={cn('flex items-center gap-2', isNarrow ? 'flex-wrap *:flex-auto' : 'shrink-0')}
        >
          {right}
        </div>
      </div>
    </GlowBorderFrame>
  )
}
