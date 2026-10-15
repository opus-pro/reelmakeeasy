'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Button, Dialog, toast } from '@shared/ui'
import React, { useCallback } from 'react'

import { SourceFilterForm } from './SourceFilterForm'
import { useSourceFilterState } from './useSourceFilterState'

const nsLogger = Logger.get('source-filter.source-filter-dialog')

export interface SourceFilterDialogProps {
  onOpenChange?: (open: boolean) => void
  onSave?: (settings: SourceFilterSettings) => void
  open: boolean
}

export interface SourceFilterSettings {
  blockedSites: string[]
  youtubeFilter: 'all' | 'blockAll' | 'creativeCommonsOnly'
}

export const SourceFilterDialog: React.FC<SourceFilterDialogProps> = ({
  onOpenChange,
  onSave,
  open,
}) => {
  const state = useSourceFilterState({ isActive: open })

  const handleSave = useCallback(async () => {
    try {
      const settings = await state.save()
      toast.success('Source filter settings saved successfully')
      onSave?.(settings)
      onOpenChange?.(false)
    } catch (error) {
      nsLogger.error('Failed to save source filter settings:', error)
      toast.error('Failed to save source filter settings')
    }
  }, [state, onSave, onOpenChange])

  return (
    <Dialog
      classNames={{
        content:
          'max-w-[560px] bg-[rgba(68,68,68,0.5)] backdrop-blur-2xl text-white border-0 max-sm:max-w-[90dvw] max-sm:p-2',
        title: 'text-[18px] font-semibold text-white',
        description: 'text-[14px] text-secondary mt-1',
        footer: 'mt-4',
      }}
      description="Choose which sources to allow or block. Your preferences will stay saved."
      footer={
        <div className="flex justify-end">
          <Button
            className="bg-white text-black hover:bg-gray-100 rounded-sm px-2.5 h-[38px] min-w-[38px]"
            disabled={state.isUpdating || state.isLoading}
            onClick={handleSave}
            size="sm"
          >
            <span className="text-[14px] font-medium">
              {state.isUpdating ? 'Saving...' : 'Save'}
            </span>
          </Button>
        </div>
      }
      onOpenAutoFocus={(event) => event.preventDefault()}
      onOpenChange={onOpenChange}
      open={open}
      showClose
      title="Source filter settings"
    >
      {/* Scrollable container */}
      <div className="bg-[rgba(68,68,68,0.5)] rounded-sm px-5 py-4 max-h-[394px] overflow-y-auto relative [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.2)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-[rgba(255,255,255,0.3)]">
        <SourceFilterForm
          blockedSites={state.blockedSites}
          onAddSite={state.handleAddSite}
          onBlockedSiteChange={state.handleInputChange}
          onRemoveSite={state.handleRemoveSite}
          onYoutubeContentTypeChange={state.setYoutubeContentType}
          onYoutubeEnabledChange={state.setYoutubeEnabled}
          variant="dialog"
          youtubeContentType={state.youtubeContentType}
          youtubeEnabled={state.youtubeEnabled}
        />
      </div>
    </Dialog>
  )
}
