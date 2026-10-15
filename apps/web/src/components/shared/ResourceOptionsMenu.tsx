import { cn } from '@shared/ui'
import DropdownMenu, { type MenuProps } from '@shared/ui/dropdown-menu'
import React, { useMemo } from 'react'

import { More } from '@/components/icons/core'

export interface ResourceMenuAction {
  disabled?: boolean
  icon: React.ReactNode
  id: string
  label: string
  onClick: () => void
  variant?: 'danger' | 'default'
}

interface ResourceOptionsMenuProps {
  /** List of actions available for this resource */
  actions: ResourceMenuAction[]
  /** Custom class name for the menu button */
  buttonClassName?: string
  /** Custom class name for the dropdown container */
  menuClassName?: string
  /** Callback when menu opens/closes */
  onOpenChange?: (open: boolean) => void
  /** Controlled open state - if provided, the menu becomes controlled */
  open?: boolean
}

export const ResourceOptionsMenu: React.FC<ResourceOptionsMenuProps> = ({
  actions,
  buttonClassName,
  menuClassName,
  onOpenChange,
  open,
}) => {
  const menuItems: MenuProps[] = useMemo(
    () =>
      actions.map((action) => ({
        key: action.id,
        icon: <div className="size-4.5 shrink-0">{action.icon}</div>,
        label: <span className="flex-1 text-left text-sm font-medium">{action.label}</span>,
        disabled: action.disabled,
        className: cn(
          'h-[38px] cursor-pointer items-center justify-start gap-1.5 rounded-lg px-2.5 text-white transition-all focus:bg-white/10 focus:text-white hover:bg-white/10 hover:text-white active:bg-white/15',
          action.variant === 'danger' && 'text-red-400 focus:text-red-400',
        ),
        onClick: () => action.onClick(),
      })),
    [actions],
  )

  return (
    <DropdownMenu
      align="start"
      classNames={{
        content: cn(
          'w-[164px] rounded-2xl border-0 bg-[rgba(68,68,68,0.50)] p-1.5 shadow-none backdrop-blur-2xl',
          menuClassName,
        ),
      }}
      items={menuItems}
      onOpenChange={onOpenChange}
      open={open}
    >
      <button
        aria-label="Options"
        className={
          buttonClassName ||
          'absolute right-0.5 top-0.5 z-50 inline-flex h-8 min-w-[32px] cursor-pointer items-center justify-center gap-1 rounded-lg px-2 transition-all bg-transparent hover:bg-black/50 hover:backdrop-blur-[10px] data-[state=open]:bg-black/50 data-[state=open]:backdrop-blur-[10px]'
        }
        type="button"
      >
        <More className="size-4 text-white" />
      </button>
    </DropdownMenu>
  )
}
