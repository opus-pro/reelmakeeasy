import { Button, cn, Tooltip } from '@shared/ui'
import React from 'react'

import { SettingsLine } from '@/components/icons/core'

interface SettingsTriggerButtonProps {
  active: boolean
  disabled: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export const SettingsTriggerButton: React.FC<SettingsTriggerButtonProps> = ({
  active,
  disabled,
  onClick,
  onMouseEnter,
  onMouseLeave,
}) => (
  <Tooltip
    className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
    content="Video settings"
    open={active ? false : undefined}
    side="top"
    sideOffset={8}
  >
    <Button
      className={cn(
        'size-[38px] min-w-[38px] p-0 bg-transparent hover:bg-fill-hover hover:text-primary rounded-full flex items-center justify-center transition-colors text-primary',
        active && 'bg-fill-hover text-primary',
      )}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <SettingsLine className="size-[18px]" />
    </Button>
  </Tooltip>
)
