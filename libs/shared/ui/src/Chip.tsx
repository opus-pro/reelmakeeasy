import { FONT_FEATURE_SETTINGS } from './constants'

export type ChipProps =
  | { backgroundColor: string; label: string; variant: 'solid' }
  | { backgroundColor?: never; label: string; variant?: 'glass' }

export type ChipVariant = 'glass' | 'solid'

const VARIANT_CLASS: Record<ChipVariant, string> = {
  glass: 'bg-white/10 backdrop-blur-2xl',
  solid: '',
}

export function Chip({ backgroundColor, label, variant = 'glass' }: ChipProps) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center justify-center rounded-xxs px-1.5 text-xs font-medium leading-[15px] text-white ${VARIANT_CLASS[variant]}`}
      style={{ ...FONT_FEATURE_SETTINGS, ...(variant === 'solid' ? { backgroundColor } : {}) }}
    >
      {label}
    </span>
  )
}
