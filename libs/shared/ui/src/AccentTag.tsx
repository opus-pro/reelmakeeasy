import type { ReactNode } from 'react'

import { cn } from './lib/utils'

export type AccentTagTone = 'blue' | 'green' | 'orange'

// Glass-pill status tag (canvas redesign). No 'outdated' tone yet --
// its color has not been confirmed by design.
//
// text-xs/font-medium, not the text-label-xs token: pairing it with a
// text-accent-* color class hits a tailwind-merge ambiguity (both are
// unrecognized "text-" suffixes) that silently drops one of the two.
const TONE_CLASS: Record<AccentTagTone, string> = {
  blue: 'bg-accent-blue/15 text-accent-blue',
  green: 'bg-accent-green/15 text-accent-green',
  orange: 'bg-accent-orange/15 text-accent-orange',
}

export function AccentTag({
  icon,
  label,
  tone,
}: {
  icon?: ReactNode
  label: string
  tone: AccentTagTone
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full text-xs font-medium backdrop-blur-2xl',
        icon ? 'pl-1.5 pr-2.5' : 'px-2.5',
        TONE_CLASS[tone],
      )}
    >
      {icon}
      {label}
    </span>
  )
}
