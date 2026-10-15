'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Button, cn, toast } from '@shared/ui'
import React, { useCallback } from 'react'

import { Filter, SemiArrowRight } from '@/components/icons/core'
import {
  SourceFilterForm,
  SourceFilterSettings,
  useSourceFilterState,
} from '@/components/source-filter'

import { DrawerSubPageHeader } from '../shared/DrawerSubPageHeader'
import type { SourceFilterEntry } from '../types'

import type { EntryRenderer } from './types'

const nsLogger = Logger.get('omni-chat-box.source-filter')

/** Source filter sub page content */
const SourceFilterSubPage: React.FC<{
  onBack: () => void
  onSave: (settings: SourceFilterSettings) => void
}> = ({ onBack, onSave }) => {
  const state = useSourceFilterState()

  const handleSave = useCallback(async () => {
    try {
      const settings = await state.save()
      toast.success('Source filter settings saved successfully')
      onSave(settings)
      onBack()
    } catch (error) {
      nsLogger.error('Failed to save source filter settings:', error)
      toast.error('Failed to save source filter settings')
    }
  }, [state, onSave, onBack])

  return (
    <div className="flex flex-col h-full">
      <DrawerSubPageHeader onBack={onBack} title="Source filter settings" />

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Description */}
        <div className="px-4 pb-4">
          <p className="text-sm text-secondary leading-relaxed">
            Choose which sources to allow or block. Your preferences will stay saved.
          </p>
        </div>

        <div className="flex-1 flex flex-col px-4">
          <SourceFilterForm
            blockedSites={state.blockedSites}
            onAddSite={state.handleAddSite}
            onBlockedSiteChange={state.handleInputChange}
            onRemoveSite={state.handleRemoveSite}
            onYoutubeContentTypeChange={state.setYoutubeContentType}
            onYoutubeEnabledChange={state.setYoutubeEnabled}
            variant="drawer"
            youtubeContentType={state.youtubeContentType}
            youtubeEnabled={state.youtubeEnabled}
          />
        </div>
      </div>

      {/* Save button */}
      <div className="shrink-0 p-4">
        <Button
          className="w-full rounded-sm"
          disabled={state.isUpdating || state.isLoading}
          onClick={handleSave}
          variant="primary"
        >
          {state.isUpdating ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export const sourceFilterRenderer: EntryRenderer<SourceFilterEntry> = {
  type: 'source-filter',

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
        onNavigate('source-filter')
      }}
    >
      <span className="text-primary shrink-0">
        <Filter className="size-4.5" />
      </span>
      <span className="flex-1 text-primary text-base font-medium text-left">Source filter</span>
      <span className="text-secondary text-base font-medium">
        {entry.applied ? 'Applied' : 'Default'}
      </span>
      <SemiArrowRight className="size-4 text-secondary shrink-0" />
    </button>
  ),

  renderDrawerSubPage: ({ entry, onBack }) => (
    <SourceFilterSubPage onBack={onBack} onSave={entry.onSave} />
  ),

  renderPopoverMenuItem: ({ entry, onSourceFilterClick }) => (
    <button
      className={cn(
        'h-9.5 px-2.5 rounded-sm text-sm font-medium flex items-center justify-between w-full text-left transition-colors',
        entry.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-fill-hover',
      )}
      disabled={entry.disabled}
      onClick={() => {
        if (entry.disabled) {
          return
        }
        onSourceFilterClick()
      }}
    >
      <div className="flex items-center gap-2">
        <Filter className="size-4.5" />
        <span>Source filter</span>
      </div>
      <div className="flex items-center gap-1 text-secondary">
        {entry.applied && <span className="text-sm">Applied</span>}
        <SemiArrowRight className="size-3" />
      </div>
    </button>
  ),
}
