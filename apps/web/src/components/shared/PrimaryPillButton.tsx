import { cn } from '@shared/ui'
import type { ButtonHTMLAttributes } from 'react'

export interface PrimaryPillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  text: string
  textClassName?: string
}

/** The primary action pill: a white rounded button with a single text label. */
export function PrimaryPillButton({
  className,
  disabled,
  loading = false,
  text,
  textClassName,
  type = 'button',
  ...props
}: PrimaryPillButtonProps) {
  return (
    <button
      className={cn(
        'h-9 min-w-9 shrink-0 rounded-full inline-flex items-center justify-center gap-1.5 px-2.5',
        'disabled:cursor-not-allowed disabled:!bg-[var(--UI-button-tonal,rgba(255,255,255,0.10))]',
        'bg-UI-button-active !bg-white transition-colors hover:!bg-white/80',
        className,
      )}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      <span
        className={cn(
          'px-0.5 whitespace-nowrap text-sm font-medium leading-4 !text-black',
          disabled && '!text-[rgba(255,255,255,0.25)]',
          textClassName,
        )}
      >
        {text}
      </span>
    </button>
  )
}
