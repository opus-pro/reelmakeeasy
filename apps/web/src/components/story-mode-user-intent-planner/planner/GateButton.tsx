'use client'

import { cn } from '@shared/ui'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Shared confirm-gate button primitive (Confirm Panel design).
// Variants map to the Figma button tokens: primary (white), tonal (white/10),
// ghost (transparent, cancel affordance).
export type GateButtonVariant = 'ghost' | 'primary' | 'tonal'

interface GateButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  variant?: GateButtonVariant
}

const BASE_CLASS =
  'inline-flex h-9.5 min-w-9.5 items-center justify-center gap-1.5 rounded-sm px-2.5 text-sm font-medium leading-[17px] transition disabled:cursor-default'

// Dark-locked surface: the planner uses literal white/black throughout, so the
// gate buttons match their siblings rather than the themed text-primary tokens.
const VARIANT_CLASS: Record<GateButtonVariant, string> = {
  ghost: 'text-white/50 hover:bg-white/5 disabled:text-white/25 disabled:hover:bg-transparent',
  primary:
    'bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/25 disabled:hover:bg-white/10',
  tonal:
    'bg-white/10 text-white hover:bg-white/15 disabled:bg-white/10 disabled:text-white/25 disabled:hover:bg-white/10',
}

export function GateButton({
  children,
  className,
  icon,
  style,
  type = 'button',
  variant = 'primary',
  ...props
}: GateButtonProps) {
  return (
    <button
      className={cn(BASE_CLASS, VARIANT_CLASS[variant], className)}
      style={style}
      type={type}
      {...props}
    >
      {icon ? (
        <span className="flex size-4.5 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      {children}
    </button>
  )
}
