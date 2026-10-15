import React from 'react'

import { CheckMark } from '@/components/icons/core'

interface SelectableOptionProps {
  disabled?: boolean
  disabledLabel?: string
  icon?: React.ReactNode
  label: string
  onClick?: () => void
  selected: boolean
}

export const SelectableOption: React.FC<SelectableOptionProps> = ({
  icon,
  label,
  selected,
  disabled,
  disabledLabel,
  onClick,
}) => {
  if (disabled) {
    return (
      <div className="flex items-center justify-between h-11 px-4 opacity-50">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-primary text-base font-medium">{label}</span>
        </div>
        {disabledLabel && (
          <span className="text-sm text-secondary font-medium">{disabledLabel}</span>
        )}
      </div>
    )
  }

  return (
    <button
      className="flex items-center justify-between h-11 px-4 active:bg-fill-hover w-full"
      onClick={onClick}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-primary text-base font-medium">{label}</span>
      </div>
      {selected && <CheckMark className="size-4.5 text-primary" />}
    </button>
  )
}
