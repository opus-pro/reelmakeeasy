'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useRive } from '@rive-app/react-canvas'
import { cn } from '@shared/ui'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { useIsMobile } from '@/util/browserUtils'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import { ExpiredVoicesBanner } from './ExpiredVoicesBanner'
import { type EngineFilter, filterVoicesByEngine, TtsEngineToggle } from './tts-engines'
import { pinVoiceToTop } from './voice-list-utils'
import { usePresetVoiceOptions, useUserVoiceClones, type VoiceOption } from './voice-over-selection'
import VoiceList from './VoiceList'

const nsLogger = Logger.get('voice.voice-clone')

/** Auto-select voice option constant */
export const AUTO_SELECT_VOICE: VoiceOption = {
  value: 'auto-select',
  name: 'Auto-select',
  labels: ['A preset voice will be chosen automatically'],
  color: 'radial-gradient(circle at 30% 30%, #E8E8E8, #C0C0C0, #A8A8A8)',
}

interface UseVoiceListDataParams {
  customVoices: VoiceOption[]
  initialActiveTab?: 'library' | 'my-voices'
  presetVoices: VoiceOption[]
  selectedVoiceId: null | string
  showAutoSelectOption?: boolean
}

interface VoiceCloneProps {
  enableAutomaticSelection?: boolean
  initialActiveTab?: 'library' | 'my-voices'
  onChange: (voice: null | VoiceOption, isForced?: boolean) => void
  onClose?: () => void
  onCreateVoice?: () => void
  onVoiceDeleted?: (voiceId: string) => void
  onVoiceRenamed?: (voiceId: string, newName: string) => void
  showAutoSelectOption?: boolean
  showUserVoices?: boolean
  value: null | string
  voiceListContext?: 'avatar-creation' | 'drawer-settings' | 'main-dialog'
}

/**
 * Hook to compute sorted voice lists with the selected voice prioritized at the top,
 * and manage the active tab state and default voice ID.
 * Shared between VoiceClone component and VoiceOverSubPage in drawer settings.
 */
export function useVoiceListData({
  customVoices,
  initialActiveTab,
  presetVoices,
  selectedVoiceId,
  showAutoSelectOption = true,
}: UseVoiceListDataParams) {
  // Store the initial selected voice (from when dialog opened)
  // This is used for sorting - position doesn't change during current session
  const [initialSelectedVoice] = useState<null | string>(selectedVoiceId)

  // Check if selected voice is a custom voice
  const isSelectedCustomVoice = customVoices.some((voice) => voice.value === selectedVoiceId)

  // Initialize active tab - will be updated in useEffect based on selected voice
  const [activeTab, setActiveTab] = useState<'library' | 'my-voices'>(initialActiveTab || 'library')
  const hasTabInitialized = useRef(false)

  // Current default voice ID (updates when user sets a new default)
  const [defaultVoiceId, setDefaultVoiceId] = useState<null | string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('defaultVoiceId')
    }
    return null
  })

  // Sort custom voices to put initial selected voice at the top
  const sortedCustomVoices = useMemo(
    () => pinVoiceToTop(customVoices, initialSelectedVoice),
    [customVoices, initialSelectedVoice],
  )

  // Build library voices with initial selected voice at the very top (before Auto-select)
  const libraryVoicesWithAutoSelect = useMemo(() => {
    // If no initial selection or selected is auto-select, keep default ordering.
    if (!initialSelectedVoice || initialSelectedVoice === 'auto-select') {
      return showAutoSelectOption ? [AUTO_SELECT_VOICE, ...presetVoices] : presetVoices
    }

    // Check if initial selected voice is a preset voice.
    const selectedVoice = presetVoices.find((v) => v.value === initialSelectedVoice)
    if (!selectedVoice) {
      return showAutoSelectOption ? [AUTO_SELECT_VOICE, ...presetVoices] : presetVoices
    }

    // Put selected voice first, then optional auto-select, then rest of preset voices.
    const otherPresetVoices = presetVoices.filter((v) => v.value !== initialSelectedVoice)
    if (showAutoSelectOption) {
      return [selectedVoice, AUTO_SELECT_VOICE, ...otherPresetVoices]
    }
    return [selectedVoice, ...otherPresetVoices]
  }, [initialSelectedVoice, presetVoices, showAutoSelectOption])

  const displayVoices = activeTab === 'library' ? libraryVoicesWithAutoSelect : sortedCustomVoices

  // Switch to correct tab on initial load based on selected voice
  useEffect(() => {
    if (hasTabInitialized.current) {
      return
    }
    if (customVoices.length === 0 && presetVoices.length === 0) {
      return
    }

    if (initialActiveTab) {
      setActiveTab(initialActiveTab)
    } else if (isSelectedCustomVoice) {
      setActiveTab('my-voices')
    } else {
      setActiveTab('library')
    }
    hasTabInitialized.current = true
  }, [customVoices.length, initialActiveTab, isSelectedCustomVoice, presetVoices.length])

  return {
    activeTab,
    autoSelectVoice: AUTO_SELECT_VOICE,
    defaultVoiceId,
    displayVoices,
    libraryVoicesWithAutoSelect,
    setActiveTab,
    setDefaultVoiceId,
    sortedCustomVoices,
  }
}

export const VoiceCloneButton = ({ className }: { className?: string }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const { RiveComponent } = useRive({
    src: getPublicCdnUrl('agent/voice-over/voice_icon.riv'),
    autoplay: true,
    onLoad: () => setIsLoaded(true),
  })

  return (
    <div
      className={cn(
        'flex items-center justify-center size-[60px] rounded-sm mr-3 overflow-hidden shrink-0',
        className,
      )}
    >
      <div
        className={cn(
          'size-full transition-opacity duration-200',
          isLoaded ? 'opacity-100' : 'opacity-0',
        )}
      >
        <RiveComponent />
      </div>
    </div>
  )
}

const VoiceClone: React.FC<VoiceCloneProps> = ({
  enableAutomaticSelection = true,
  initialActiveTab,
  onChange,
  onCreateVoice,
  onVoiceDeleted,
  onVoiceRenamed,
  showAutoSelectOption = true,
  value,
  voiceListContext = 'avatar-creation',
}) => {
  const { userVoices: customVoices } = useUserVoiceClones()
  const { options: presetVoices } = usePresetVoiceOptions()
  const isMobile = useIsMobile()

  const hasInitialized = useRef(false)
  // Check if there are any expired voices
  const hasExpiredVoices = customVoices.some((voice) => voice.isExpired)

  // Use shared hook for voice list data, tab management, and default voice
  const {
    activeTab,
    autoSelectVoice,
    defaultVoiceId,
    displayVoices,
    libraryVoicesWithAutoSelect,
    setActiveTab,
    setDefaultVoiceId,
    sortedCustomVoices,
  } = useVoiceListData({
    customVoices: customVoices,
    initialActiveTab,
    presetVoices,
    selectedVoiceId: value,
    showAutoSelectOption,
  })

  // Auto-select default voice on component mount
  useEffect(() => {
    if (!enableAutomaticSelection) {
      return
    }

    // If user already selected a voice, mark as initialized and don't override
    // Only run once when voices are loaded
    if (hasInitialized.current || !presetVoices.length) {
      return
    }

    if (value) {
      const allVoices = [...libraryVoicesWithAutoSelect, ...sortedCustomVoices]
      const selectedVoice = allVoices.find((voice) => voice.value === value)

      if (selectedVoice && !selectedVoice.isExpired) {
        hasInitialized.current = true
        return
      }
    }

    // Only auto-select if no voice is currently selected
    if (defaultVoiceId) {
      // User has set a default voice, find and select it
      const allVoices = [...libraryVoicesWithAutoSelect, ...sortedCustomVoices]
      const defaultVoice = allVoices.find((v) => v.value === defaultVoiceId)

      if (defaultVoice && !defaultVoice.isExpired) {
        onChange(defaultVoice)
        // Switch to the correct tab if needed
        if (defaultVoice.voiceCloneId) {
          setActiveTab('my-voices')
        } else {
          setActiveTab('library')
        }
        hasInitialized.current = true
      } else {
        onChange(autoSelectVoice)
        setActiveTab('library')
        hasInitialized.current = true
      }
    } else {
      // No default set, auto-select the Auto-select option
      nsLogger.log('Auto-selecting Auto-select voice')
      onChange(autoSelectVoice)
      setActiveTab('library')
      hasInitialized.current = true
    }
  }, [
    autoSelectVoice,
    defaultVoiceId,
    enableAutomaticSelection,
    libraryVoicesWithAutoSelect,
    onChange,
    presetVoices.length,
    setActiveTab,
    sortedCustomVoices,
    value,
  ])

  const isMyVoicesEmpty = activeTab === 'my-voices' && sortedCustomVoices.length === 0
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all')

  return (
    <div
      className={cn(
        'flex size-full flex-col justify-start gap-4 flex-1 min-h-0',
        isMyVoicesEmpty && 'h-full',
      )}
    >
      {/* Voice Clone Card */}
      {!isMobile && (
        <div className="bg-menu-background rounded-xl flex w-full items-center p-3 shrink-0">
          <VoiceCloneButton />
          <div className="flex-1">
            <div className="text-primary font-medium text-sm">Custom voice</div>
            <div className="text-secondary text-nowrap text-xs">
              Clone your voice from a 10-second recording
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-primary bg-tertiary cursor-pointer rounded-sm px-[10px] h-[38px] min-w-[38px] text-sm font-medium hover:bg-fill-hover transition-colors flex items-center justify-center gap-1.5"
              onClick={() => {
                onCreateVoice?.()
              }}
              type="button"
            >
              Create voice
            </button>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-tertiary flex flex-row gap-3 items-center justify-start w-full shrink-0">
        <div className="flex flex-row gap-3 items-center justify-start flex-1">
          {/* Library Tab */}
          <button
            className={cn(
              'h-[38px] flex flex-row gap-0 items-center justify-center relative transition-all',
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
              'h-[38px] flex flex-row gap-0 items-center justify-center relative transition-all',
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

        {/* Sort Button - Temporarily hidden
        <button
          className="bg-ui-button-hover rounded-full px-2 flex flex-row gap-1 items-center justify-center h-7 min-w-7 transition-colors hover:bg-fill-hover"
          type="button"
        >
          <div className="px-0.5 flex flex-row gap-2.5 items-center justify-center">
            <div className="text-primary text-left text-sm font-medium">Sort by trending</div>
          </div>
          <ChevronDownSmall className="shrink-0 size-4 text-primary" />
        </button>
        */}
      </div>

      <TtsEngineToggle className="shrink-0" onChange={setEngineFilter} value={engineFilter} />

      {/* Expiration Notice Banner - only for My Voices tab */}
      {activeTab === 'my-voices' && hasExpiredVoices && <ExpiredVoicesBanner />}

      {/* Voice list: when My Voices is empty, fill the rectangle below the tabs and above the Apply button so the empty state can center in it */}
      <div
        className={cn(
          'flex w-full flex-col gap-1 flex-1 min-h-0',
          isMyVoicesEmpty && 'flex-1 min-h-0',
        )}
      >
        <VoiceList
          allVoices={[...libraryVoicesWithAutoSelect, ...sortedCustomVoices]}
          defaultVoiceId={defaultVoiceId}
          onSelect={(voice, isForced) => {
            onChange(voice, isForced)
            if (voice) {
              setActiveTab(voice.voiceCloneId ? 'my-voices' : 'library')
            }
          }}
          onSetDefaultVoice={setDefaultVoiceId}
          onVoiceDeleted={onVoiceDeleted}
          onVoiceRenamed={onVoiceRenamed}
          selected={value}
          showLanguageBadge={activeTab === 'library'}
          voiceListContext={voiceListContext}
          voices={filterVoicesByEngine(displayVoices, engineFilter).filter(
            (voice) => voice.visible !== false,
          )}
        />
      </div>
    </div>
  )
}

export default memo(VoiceClone)
