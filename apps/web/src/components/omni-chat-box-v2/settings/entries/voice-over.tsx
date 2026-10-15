'use client'
import { Button, cn } from '@shared/ui'
import React, { useCallback, useState } from 'react'

import { SemiArrowRight, Voiceover } from '@/components/icons/core'
import { useAudio } from '@/hooks/useAudio'

import {
  usePresetVoiceOptions,
  useUserVoiceClones,
  VoiceOption,
} from '../../../voice/components/voice-over-selection'
import { useVoiceListData } from '../../../voice/components/VoiceClone'
import VoiceList from '../../../voice/components/VoiceList'
import { DrawerSubPageHeader } from '../shared/DrawerSubPageHeader'
import type { VoiceEntry } from '../types'

import type { EntryRenderer } from './types'

/** Voice over sub page content */
export const VoiceOverSubPage: React.FC<{
  onApply: (voice: null | VoiceOption) => void
  onBack: () => void
  selectedVoiceId: null | string
}> = ({ onApply, onBack, selectedVoiceId }) => {
  const { userVoices: customVoices } = useUserVoiceClones()
  const { options: presetVoices } = usePresetVoiceOptions()
  const { pause } = useAudio()

  const [currentSelectedId, setCurrentSelectedId] = useState<null | string>(selectedVoiceId)

  // Use shared hook for voice list data, tab management, and default voice
  const {
    activeTab,
    defaultVoiceId,
    displayVoices,
    libraryVoicesWithAutoSelect,
    setActiveTab,
    setDefaultVoiceId,
    sortedCustomVoices,
  } = useVoiceListData({
    customVoices,
    presetVoices,
    selectedVoiceId,
  })

  const handleVoiceSelect = useCallback((voice: null | VoiceOption) => {
    setCurrentSelectedId(voice?.value ?? null)
  }, [])

  const handleApply = useCallback(() => {
    if (!currentSelectedId) {
      return
    }

    const allVoices = [...libraryVoicesWithAutoSelect, ...sortedCustomVoices]
    const selectedVoice = allVoices.find((v) => v.value === currentSelectedId)

    if (selectedVoice) {
      pause()
      onApply(selectedVoice)
      onBack()
    }
  }, [currentSelectedId, libraryVoicesWithAutoSelect, sortedCustomVoices, onApply, onBack, pause])

  return (
    <div className="flex flex-col h-full py-4">
      <DrawerSubPageHeader onBack={onBack} title="Select a voiceover" />

      <div className="flex-1 flex flex-col min-h-0 px-4">
        <div className="border-b border-tertiary flex flex-row gap-4 items-center justify-start w-full shrink-0">
          <div className="flex flex-row gap-4 items-center justify-start flex-1">
            {(
              [
                { key: 'library', label: 'Library' },
                { key: 'my-voices', label: 'My voices' },
              ] as const
            ).map((tab) => (
              <button
                className={cn(
                  'py-4 flex items-center justify-center relative transition-all border-b-2',
                  activeTab === tab.key ? 'border-primary' : 'border-transparent',
                )}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                <span
                  className={cn(
                    'text-sm font-medium transition-colors',
                    activeTab === tab.key ? 'text-primary' : 'text-secondary',
                  )}
                >
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          <VoiceList
            defaultVoiceId={defaultVoiceId}
            onSelect={handleVoiceSelect}
            onSetDefaultVoice={setDefaultVoiceId}
            selected={currentSelectedId}
            showLanguageBadge={activeTab === 'library'}
            voices={displayVoices.filter((voice) => voice.visible !== false)}
          />
        </div>
      </div>

      <div className="shrink-0 px-4">
        <Button
          className="w-full rounded-sm"
          disabled={!currentSelectedId}
          onClick={handleApply}
          variant="primary"
        >
          Apply
        </Button>
      </div>
    </div>
  )
}

export const voiceRenderer: EntryRenderer<VoiceEntry> = {
  type: 'voice',

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
        onNavigate('voice')
      }}
    >
      <span className="text-primary shrink-0">
        <Voiceover className="size-4.5" />
      </span>
      <span className="flex-1 text-primary text-base font-medium text-left">Voiceover</span>
      <span className="text-secondary text-base font-medium">{entry.displayName}</span>
      <SemiArrowRight className="size-4 text-secondary shrink-0" />
    </button>
  ),

  renderDrawerSubPage: ({ entry, onBack }) => (
    <VoiceOverSubPage
      onApply={entry.onApply}
      onBack={onBack}
      selectedVoiceId={entry.selectedVoiceId}
    />
  ),
}
