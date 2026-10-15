'use client'

import { Button, cn, Popover, Tooltip } from '@shared/ui'
import React, { useState } from 'react'

import { SettingsLine } from '@/components/icons/core'

import { entryRenderers } from './entries'
import type { SettingsEntry } from './types'

interface PopoverSettingsMenuProps {
  disabled: boolean
  entries: SettingsEntry[]
  onSourceFilterClick: () => void
}

export const PopoverSettingsMenu: React.FC<PopoverSettingsMenuProps> = ({
  disabled,
  entries,
  onSourceFilterClick,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeSubmenu, setActiveSubmenu] = useState<'caption' | 'ratio' | null>(null)

  const handleSourceFilterClick = () => {
    setIsOpen(false)
    onSourceFilterClick()
  }

  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
      content="Video settings"
      open={isOpen ? false : undefined}
      side="top"
      sideOffset={8}
    >
      <Popover
        align="center"
        className="bg-menu-background shadow-none backdrop-blur-2xl w-56 rounded-2xl border-0 p-1.5 text-primary"
        content={
          <div
            className="flex flex-col"
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
          >
            <div className="px-2.5 py-2 text-xs text-secondary font-normal">SETTING</div>
            {entries.map((entry, index) => {
              const renderer = entryRenderers[entry.type]
              if (!renderer.renderPopoverMenuItem) {
                return null
              }
              return (
                <React.Fragment key={`${entry.type}-${index}`}>
                  {renderer.renderPopoverMenuItem({
                    entry,
                    activeSubmenu,
                    onSubmenuChange: setActiveSubmenu,
                    onSourceFilterClick: handleSourceFilterClick,
                  })}
                </React.Fragment>
              )
            })}
            <div className="h-3 -mb-3 shrink-0" />
          </div>
        }
        onOpenChange={(open) => {
          setIsOpen(open)
          if (!open) {
            setActiveSubmenu(null)
          }
        }}
        open={isOpen}
        side="top"
      >
        <Button
          className={cn(
            'size-[38px] min-w-[38px] p-0 bg-transparent hover:bg-fill-hover hover:text-primary rounded-full flex items-center justify-center transition-colors text-primary',
            isOpen && 'bg-fill-hover text-primary',
          )}
          disabled={disabled}
          onMouseEnter={() => !disabled && setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <SettingsLine className="size-[18px]" />
        </Button>
      </Popover>
    </Tooltip>
  )
}
