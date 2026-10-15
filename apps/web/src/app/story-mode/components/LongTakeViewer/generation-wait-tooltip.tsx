import { Tooltip } from '@shared/ui'
import type { ReactNode } from 'react'

// Shown on an action held while inpaint generations are still running.
const GENERATION_WAIT_TOOLTIP = 'Please wait for generation to finish'

// A disabled trigger fires no pointer events, so the tooltip needs a focusable
// wrapper element of its own.
export function GenerationWaitTooltip({
  blocked,
  children,
  className = 'block flex-1',
}: {
  blocked: boolean
  children: ReactNode
  className?: string
}): ReactNode {
  if (!blocked) {
    return children
  }
  return (
    <Tooltip
      className="rounded-xs bg-menu-background text-label-sm text-primary"
      content={GENERATION_WAIT_TOOLTIP}
      side="top"
    >
      <span aria-label={GENERATION_WAIT_TOOLTIP} className={className} tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  )
}
