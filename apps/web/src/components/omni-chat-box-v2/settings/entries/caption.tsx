import { cn, Popover } from '@shared/ui'
import React from 'react'

import { Caption, CheckMark, SemiArrowRight } from '@/components/icons/core'

import { AnimatedCaptionPreview } from '../AnimatedCaptionPreview'
import { DrawerSubPageHeader } from '../shared/DrawerSubPageHeader'
import { SelectableOption } from '../shared/SelectableOption'
import type { CaptionEntry } from '../types'

import type { EntryRenderer } from './types'

export const captionRenderer: EntryRenderer<CaptionEntry> = {
  type: 'caption',

  renderDrawerMenuItem: ({ entry, onNavigate }) => (
    <button
      className={cn(
        'flex items-center gap-1.5 h-11 w-full px-4 transition-colors',
        entry.disabled ? 'opacity-50 cursor-not-allowed' : 'active:bg-fill-hover',
      )}
      disabled={entry.disabled}
      onClick={() => {
        if (entry.disabled) {
          return
        }
        onNavigate('caption')
      }}
    >
      <span className="text-primary shrink-0">
        <Caption className="size-4.5" />
      </span>
      <span className="flex-1 text-primary text-base font-medium text-left">Caption</span>
      <span className="text-secondary text-base font-medium">{entry.enabled ? 'On' : 'Off'}</span>
      <SemiArrowRight className="size-4 text-secondary shrink-0" />
    </button>
  ),

  renderDrawerSubPage: ({ entry, onBack }) => (
    <div className="flex flex-col">
      <DrawerSubPageHeader onBack={onBack} title="Captions" />
      <div className="px-4 mb-2">
        <AnimatedCaptionPreview />
      </div>
      <SelectableOption
        label="Caption on"
        onClick={() => entry.onChange(true)}
        selected={entry.enabled}
      />
      <SelectableOption
        label="Caption off"
        onClick={() => entry.onChange(false)}
        selected={!entry.enabled}
      />
    </div>
  ),

  renderPopoverMenuItem: ({ entry, activeSubmenu, onSubmenuChange }) => {
    if (entry.disabled) {
      return (
        <div className="h-9.5 px-2.5 rounded-sm text-sm font-medium flex items-center justify-between w-full text-left transition-colors opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-2">
            <Caption className="size-4.5" />
            <span>Caption</span>
          </div>
          <div className="flex items-center gap-1 text-secondary">
            <span className="text-sm">{entry.enabled ? 'On' : 'Off'}</span>
            <SemiArrowRight className="size-3" />
          </div>
        </div>
      )
    }

    return (
      <Popover
        align="start"
        className="bg-transparent shadow-none border-0 p-0 text-primary"
        content={
          <div
            className="flex flex-row"
            onMouseEnter={() => onSubmenuChange('caption')}
            onMouseLeave={() => onSubmenuChange(null)}
          >
            <div className="w-2 shrink-0" />
            <div className="flex flex-col w-56 bg-menu-background backdrop-blur-2xl rounded-2xl p-1.5">
              <AnimatedCaptionPreview />
              <button
                className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors"
                onClick={() => {
                  entry.onChange(true)
                  onSubmenuChange(null)
                }}
              >
                <span className="flex-1">Caption on</span>
                {entry.enabled && <CheckMark className="size-4.5 text-primary" />}
              </button>
              <button
                className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors"
                onClick={() => {
                  entry.onChange(false)
                  onSubmenuChange(null)
                }}
              >
                <span className="flex-1">Caption off</span>
                {!entry.enabled && <CheckMark className="size-4.5 text-primary" />}
              </button>
            </div>
          </div>
        }
        onOpenChange={(open) => onSubmenuChange(open ? 'caption' : null)}
        open={activeSubmenu === 'caption'}
        side="right"
        sideOffset={0}
      >
        <div
          className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center justify-between w-full text-left transition-colors"
          onMouseEnter={() => onSubmenuChange('caption')}
          onMouseLeave={() => onSubmenuChange(null)}
        >
          <div className="flex items-center gap-2">
            <Caption className="size-4.5" />
            <span>Caption</span>
          </div>
          <div className="flex items-center gap-1 text-secondary">
            <span className="text-sm">{entry.enabled ? 'On' : 'Off'}</span>
            <SemiArrowRight className="size-3" />
          </div>
        </div>
      </Popover>
    )
  },
}
