import { cn } from '@shared/ui/lib/utils'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { ExpiredVoicesBanner } from './ExpiredVoicesBanner'
import { type VoiceOption } from './voice-over-selection'
import VoiceList from './VoiceList'

interface VoiceLibraryViewProps {
  forcedTab?: 'library' | 'my-voices' | null
  isVoicePlaying?: (voiceId: string) => boolean
  onForcedTabApplied?: () => void
  onPlayVoice?: (voice: VoiceOption) => Promise<void>
  onVoiceRenamed?: (voiceId: string, newName: string) => void
  onVoiceSelect: (voice: null | VoiceOption) => void
  selectedVoice?: null | string
  selectedVoiceOption?: null | VoiceOption
  voiceOptions: VoiceOption[]
}

export function VoiceLibraryView({
  forcedTab,
  onVoiceSelect,
  onForcedTabApplied,
  onVoiceRenamed,
  selectedVoice,
  selectedVoiceOption,
  voiceOptions,
}: VoiceLibraryViewProps) {
  // Separate voice clones (my voices) and preset voices (library)
  const customVoices = useMemo(
    () => voiceOptions.filter((voice) => voice.voiceCloneId),
    [voiceOptions],
  )
  const presetVoices = useMemo(
    () => voiceOptions.filter((voice) => !voice.voiceCloneId),
    [voiceOptions],
  )
  const orderedVoiceOptions = useMemo(
    () => [...customVoices, ...presetVoices],
    [customVoices, presetVoices],
  )

  // Check if selected voice is a custom voice
  const currentSelected = selectedVoice || selectedVoiceOption?.value
  const isSelectedCustomVoice = customVoices.some((voice) => voice.value === currentSelected)

  // Initialize active tab - will be updated in useEffect based on selected voice
  const [activeTab, setActiveTab] = useState<'library' | 'my-voices'>('library')
  const hasInitialized = useRef(false)
  const [defaultVoiceId] = useState<null | string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('defaultVoiceId')
    }
    return null
  })

  // Switch to correct tab on initial load based on selected voice
  useEffect(() => {
    if (hasInitialized.current) {
      return
    }
    if (customVoices.length === 0 && presetVoices.length === 0) {
      return
    }

    // If selected voice is a custom voice, switch to My voices tab
    if (isSelectedCustomVoice) {
      setActiveTab('my-voices')
    } else {
      setActiveTab('library')
    }
    hasInitialized.current = true
  }, [customVoices.length, presetVoices.length, isSelectedCustomVoice])

  useEffect(() => {
    if (!forcedTab) {
      return
    }
    setActiveTab(forcedTab)
    onForcedTabApplied?.()
  }, [forcedTab, onForcedTabApplied])

  // Check if there are expired voices
  const hasExpiredVoices = customVoices.some((voice) => voice.isExpired)

  // Store the initial selected voice (from when dialog opened)
  // This is used for sorting - position doesn't change during current session
  const [initialSelectedVoice] = useState<null | string>(
    selectedVoice || selectedVoiceOption?.value || null,
  )

  // Sort voices to put initial selected voice at the top
  const sortedPresetVoices = useMemo(() => {
    if (!initialSelectedVoice) {
      return presetVoices
    }
    const selected = presetVoices.find((v) => v.value === initialSelectedVoice)
    if (!selected) {
      return presetVoices
    }
    return [selected, ...presetVoices.filter((v) => v.value !== initialSelectedVoice)]
  }, [presetVoices, initialSelectedVoice])

  const sortedCustomVoices = useMemo(() => {
    if (!initialSelectedVoice) {
      return customVoices
    }
    const selected = customVoices.find((v) => v.value === initialSelectedVoice)
    if (!selected) {
      return customVoices
    }
    return [selected, ...customVoices.filter((v) => v.value !== initialSelectedVoice)]
  }, [customVoices, initialSelectedVoice])

  // Display voices based on active tab
  const displayVoices = activeTab === 'library' ? sortedPresetVoices : sortedCustomVoices

  return (
    <div className="flex flex-col gap-1 max-h-[360px]">
      <div className="border-b border-tertiary flex flex-row gap-3 items-center justify-start w-full">
        <div className="flex flex-row gap-3 items-center justify-start flex-1">
          <button
            className={cn(
              'pt-4 pb-4 flex flex-row gap-0 items-center justify-center relative transition-all',
              activeTab === 'library'
                ? 'border-b-2 border-primary'
                : 'border-b-2 border-transparent',
            )}
            onClick={() => setActiveTab('library')}
            type="button"
          >
            <div
              className={cn(
                'text-left text-sm font-medium transition-colors',
                activeTab === 'library' ? 'text-primary' : 'text-secondary',
              )}
            >
              Library
            </div>
          </button>

          {/* My Voices Tab */}
          <button
            className={cn(
              'pt-4 pb-4 flex flex-row gap-0 items-center justify-center relative transition-all',
              activeTab === 'my-voices'
                ? 'border-b-2 border-primary'
                : 'border-b-2 border-transparent',
            )}
            onClick={() => setActiveTab('my-voices')}
            type="button"
          >
            <div
              className={cn(
                'text-left text-sm font-medium transition-colors',
                activeTab === 'my-voices' ? 'text-primary' : 'text-secondary',
              )}
            >
              My voices
            </div>
          </button>
        </div>
      </div>

      {activeTab === 'my-voices' && hasExpiredVoices && <ExpiredVoicesBanner />}

      <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0">
        {displayVoices.length === 0 ? (
          <div className="text-secondary text-sm p-4">
            {activeTab === 'library' ? 'No voices available' : 'No custom voices yet'}
          </div>
        ) : (
          <VoiceList
            allVoices={orderedVoiceOptions}
            defaultVoiceId={defaultVoiceId}
            onSelect={onVoiceSelect}
            onVoiceRenamed={onVoiceRenamed}
            selected={selectedVoice || selectedVoiceOption?.value || null}
            showLanguageBadge={activeTab === 'library'}
            showVoiceMenu={true}
            voiceListContext="avatar-creation"
            voices={displayVoices.filter((voice) => voice.visible !== false)}
          />
        )}
      </div>
    </div>
  )
}
