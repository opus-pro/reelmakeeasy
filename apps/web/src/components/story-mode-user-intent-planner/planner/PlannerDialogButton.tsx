'use client'

import { cn } from '@shared/ui'
import type { ReactNode } from 'react'

import { ArrowLeft, CrossSmall } from '@/components/icons/core'

import { FONT_FEATURE_SETTINGS } from '../defaults'

export interface PlannerDialogButtonProps {
  appearance?: 'solid' | 'translucent'
  'aria-label'?: string
  className?: string
  icon?: IconPreset | ReactNode
  label?: ReactNode
  onClick?: () => void
  variant?: 'icon' | 'label'
}

type IconPreset = 'back' | 'close'

export function PlannerDialogButton({
  'aria-label': ariaLabel,
  appearance = 'translucent',
  className,
  icon = 'close',
  label,
  onClick,
  variant = 'icon',
}: PlannerDialogButtonProps) {
  const isIcon = variant === 'icon'
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center text-white transition',
        appearance === 'solid'
          ? 'bg-[#373737] hover:bg-[#444444]'
          : 'bg-white/10 hover:bg-white/20',
        isIcon
          ? 'size-[38px] justify-center rounded-full text-white/90'
          : 'h-[38px] gap-1.5 rounded-xl px-2.5',
        className,
      )}
      onClick={onClick}
      style={isIcon ? undefined : FONT_FEATURE_SETTINGS}
      type="button"
    >
      {icon == null ? null : resolveIcon(icon)}
      {!isIcon && <span className="text-sm font-medium leading-[17px]">{label}</span>}
    </button>
  )
}

function resolveIcon(icon: IconPreset | ReactNode): ReactNode {
  if (icon === 'close') {
    return <CrossSmall className="size-6" />
  }
  if (icon === 'back') {
    return <ArrowLeft className="size-[18px]" />
  }
  return icon as ReactNode
}
