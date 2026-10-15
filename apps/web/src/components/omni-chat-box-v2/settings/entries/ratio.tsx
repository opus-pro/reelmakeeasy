import { Popover } from '@shared/ui'
import React from 'react'

import { CheckMark, Ratio11, Ratio169, Ratio916, SemiArrowRight } from '@/components/icons/core'

import { DrawerSubPageHeader } from '../shared/DrawerSubPageHeader'
import { SelectableOption } from '../shared/SelectableOption'
import type { RatioEntry } from '../types'

import type { EntryRenderer } from './types'

export const ratioRenderer: EntryRenderer<RatioEntry> = {
  type: 'ratio',

  renderDrawerMenuItem: ({ entry, onNavigate }) => (
    <button
      className="flex items-center gap-1.5 h-11 w-full px-4 transition-colors active:bg-fill-hover"
      onClick={() => onNavigate('ratio')}
    >
      <span className="text-primary shrink-0">
        <Ratio916 className="size-4.5" />
      </span>
      <span className="flex-1 text-primary text-base font-medium text-left">Aspect Ratio</span>
      <span className="text-secondary text-base font-medium">{entry.value}</span>
      <SemiArrowRight className="size-4 text-secondary shrink-0" />
    </button>
  ),

  renderDrawerSubPage: ({ entry, onBack }) => (
    <div className="flex flex-col">
      <DrawerSubPageHeader onBack={onBack} title="Aspect Ratio" />
      <SelectableOption
        icon={<Ratio916 className="size-4.5 text-primary" />}
        label="9:16"
        onClick={() => entry.onChange('9:16')}
        selected={entry.value === '9:16'}
      />
      {entry.enableAllRatios ? (
        <>
          <SelectableOption
            icon={<Ratio169 className="size-4.5 text-primary" />}
            label="16:9"
            onClick={() => entry.onChange('16:9')}
            selected={entry.value === '16:9'}
          />
          <SelectableOption
            icon={<Ratio11 className="size-4.5 text-primary" />}
            label="1:1"
            onClick={() => entry.onChange('1:1')}
            selected={entry.value === '1:1'}
          />
        </>
      ) : (
        <>
          <SelectableOption
            disabled
            disabledLabel="Soon"
            icon={<Ratio169 className="size-4.5 text-primary" />}
            label="16:9"
            selected={false}
          />
          <SelectableOption
            disabled
            disabledLabel="Soon"
            icon={<Ratio11 className="size-4.5 text-primary" />}
            label="1:1"
            selected={false}
          />
        </>
      )}
    </div>
  ),

  renderPopoverMenuItem: ({ entry, activeSubmenu, onSubmenuChange }) => (
    <Popover
      align="start"
      className="bg-transparent shadow-none border-0 p-0 text-primary"
      content={
        <div
          className="flex flex-row"
          onMouseEnter={() => onSubmenuChange('ratio')}
          onMouseLeave={() => onSubmenuChange(null)}
        >
          <div className="w-2 shrink-0" />
          <div className="flex flex-col w-56 bg-menu-background backdrop-blur-2xl rounded-2xl p-1.5">
            <button
              className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors"
              onClick={() => {
                entry.onChange('9:16')
                onSubmenuChange(null)
              }}
            >
              <Ratio916 className="size-4.5" />
              <span className="flex-1">9:16</span>
              {entry.value === '9:16' && <CheckMark className="size-4.5 text-primary" />}
            </button>
            {entry.enableAllRatios ? (
              <>
                <button
                  className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors"
                  onClick={() => {
                    entry.onChange('16:9')
                    onSubmenuChange(null)
                  }}
                >
                  <Ratio169 className="size-4.5" />
                  <span className="flex-1">16:9</span>
                  {entry.value === '16:9' && <CheckMark className="size-4.5 text-primary" />}
                </button>
                <button
                  className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors"
                  onClick={() => {
                    entry.onChange('1:1')
                    onSubmenuChange(null)
                  }}
                >
                  <Ratio11 className="size-4.5" />
                  <span className="flex-1">1:1</span>
                  {entry.value === '1:1' && <CheckMark className="size-4.5 text-primary" />}
                </button>
              </>
            ) : (
              <>
                <div className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-not-allowed flex items-center gap-1.5 text-secondary">
                  <Ratio169 className="size-4.5" />
                  <span className="flex-1">16:9</span>
                  <span className="text-xs">Soon</span>
                </div>
                <div className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-not-allowed flex items-center gap-1.5 text-secondary">
                  <Ratio11 className="size-4.5" />
                  <span className="flex-1">1:1</span>
                  <span className="text-xs">Soon</span>
                </div>
              </>
            )}
          </div>
        </div>
      }
      onOpenChange={(open) => onSubmenuChange(open ? 'ratio' : null)}
      open={activeSubmenu === 'ratio'}
      side="right"
      sideOffset={0}
    >
      <div
        className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center justify-between w-full text-left transition-colors"
        onMouseEnter={() => onSubmenuChange('ratio')}
        onMouseLeave={() => onSubmenuChange(null)}
      >
        <div className="flex items-center gap-2">
          <Ratio916 className="size-4.5" />
          <span>Aspect Ratio</span>
        </div>
        <div className="flex items-center gap-1 text-secondary">
          <span className="text-sm">{entry.value}</span>
          <SemiArrowRight className="size-3" />
        </div>
      </div>
    </Popover>
  ),
}
