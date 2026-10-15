'use client'

import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { cn } from '@shared/ui'
import { useInterval } from 'ahooks'
import { useAtom } from 'jotai'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { ChatBoxMode, pendingSourceVoiceAtom } from '@/atom/home'
import { AddVoiceoverSquare } from '@/components/icons/core'
import { resolveRemixVoiceSelection } from '@/components/omni-chat-box-v2/remix-voice.utils'
import {
  useDefaultVoiceId,
  usePresetVoiceOptions,
  useUserVoiceClones,
  VoiceOption,
} from '@/components/voice/components/voice-over-selection'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { useIsMobile } from '@/util/browserUtils'

import { SourceFilterSettings } from '../source-filter/SourceFilterDialog'

import { LongTakeStyleButton } from './ChatBoxLeftActionButtons'
import { ChatBoxLeftActionsDialogs } from './ChatBoxLeftActionsDialogs'
import { FileUploadButton } from './FileUploadButton'
import { LongTakeDurationButton } from './LongTakeDurationButton'
import type { ReferenceUploadButtonValue } from './ReferenceUploadButton'
import { SettingsDropdownMenu, SettingsDropdownMenuRef, SettingsEntry } from './settings'
import { StoryModeVoiceButton } from './StoryModeVoiceButton'
import { isVoiceCatalogReady, useVoiceAutoSelect } from './use-voice-auto-select'
import { resolveDisplayVoiceOption } from './voice-display.utils'

const STORY_MODE_AUDIO_ACCEPT =
  'audio/mpeg,audio/wav,audio/ogg,audio/webm,.mp3,.wav,.m4a,.ogg,.weba'

export type ChatBoxLeftActionsProps = {
  chatBoxMode?: ChatBoxMode
  disabled?: boolean
  fileInputRef?: React.RefObject<HTMLInputElement | null>
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  hideVoiceButton?: boolean
  isEnhancing?: boolean
  /** Enable state for Apply button in Add Style dialog */
  isLongTakeStyleApplyEnabled?: boolean
  /** Loading state for Apply button (save in progress) */
  isLongTakeStyleApplySaving?: boolean
  /** Enable state for Generate preview button in Add Style dialog */
  isLongTakeStyleGeneratePreviewEnabled?: boolean
  isLongTakeStylePreviewGenerating?: boolean
  isVoiceDialogOpen?: boolean
  layout?: 'default' | 'story'
  longTakeEnabled: boolean
  longTakeStyleCustom: string
  longTakeStyleDialogOpen?: boolean
  longTakeStyleImageError?: null | string
  longTakeStyleImageValue?: null | ReferenceUploadButtonValue
  longTakeStyleInputMode?: 'image' | 'none' | 'preset' | 'text'
  longTakeStyleName: string
  longTakeStylePreviewImageUrl?: null | string
  longTakeTargetDurationSeconds?: null | number
  onFileUploadClick?: () => void
  onLongTakeStyleApply?: () => void
  onLongTakeStyleCustomChange: (value: string) => void
  onLongTakeStyleDialogOpenChange?: (open: boolean) => void
  onLongTakeStyleGeneratePreview?: () => void
  onLongTakeStyleImageClear?: () => void
  onLongTakeStyleImageSelect?: (file: File) => void
  onLongTakeStyleNameChange: (value: string) => void
  onLongTakeStyleTextClear?: () => void
  onLongTakeTargetDurationSecondsChange?: (durationSeconds: null | number) => void
  /** Callback when aspect ratio changes (for copy-motion workflows) */
  onRatioChange?: (ratio: AspectRatio) => void
  onVoiceDialogOpenChange?: (open: boolean) => void
  /** Selected aspect ratio (controlled by parent for copy-motion workflows) */
  selectedRatio?: AspectRatio
  selectedVoice: null | VoiceOption
  setSelectedVoice: (voice: null | VoiceOption) => void
  setShowCaptions: (show: boolean) => void
  settingsMenuRef?: React.Ref<null | SettingsDropdownMenuRef>
  showCaptions: boolean
  storyModeHasAudioAttachment?: boolean
}

const ChatBoxLeftActionsComponent: React.FC<ChatBoxLeftActionsProps> = ({
  chatBoxMode = 'edit',
  disabled = false,
  fileInputRef,
  handleFileChange,
  hideVoiceButton = false,
  onFileUploadClick,
  isEnhancing = false,
  layout = 'default',
  longTakeEnabled,
  longTakeStyleDialogOpen,
  onLongTakeStyleDialogOpenChange,
  longTakeStyleCustom,
  longTakeStyleImageError,
  longTakeStyleImageValue,
  longTakeStyleInputMode = 'preset',
  isVoiceDialogOpen: isVoiceDialogOpenProp,
  storyModeHasAudioAttachment = false,
  isLongTakeStyleApplyEnabled = false,
  isLongTakeStyleApplySaving = false,
  isLongTakeStyleGeneratePreviewEnabled = false,
  isLongTakeStylePreviewGenerating = false,
  longTakeStylePreviewImageUrl = null,
  onLongTakeStyleApply,
  onLongTakeStyleCustomChange,
  onLongTakeStyleGeneratePreview,
  onLongTakeStyleImageClear,
  onLongTakeStyleImageSelect,
  onLongTakeStyleNameChange,
  onLongTakeStyleTextClear,
  onVoiceDialogOpenChange,
  longTakeStyleName,
  longTakeTargetDurationSeconds = null,
  onLongTakeTargetDurationSecondsChange,
  selectedVoice,
  setSelectedVoice,
  showCaptions,
  setShowCaptions,
  onRatioChange,
  selectedRatio: selectedRatioProp,
  settingsMenuRef,
}: ChatBoxLeftActionsProps) => {
  // Enhance review mode state
  const [enhancingStep, setEnhancingStep] = useState(0)
  const enhancingMessages = ['Analyzing your input...', 'Refining the prompt...']

  // Reset step when enhancing starts/stops
  useEffect(() => {
    if (isEnhancing) {
      setEnhancingStep(0)
    }
  }, [isEnhancing])

  // Advance step every 1 second, no loop (stop at last step)
  useInterval(
    () => {
      setEnhancingStep((prev) => Math.min(prev + 1, enhancingMessages.length - 1))
    },
    isEnhancing && enhancingStep < enhancingMessages.length - 1 ? 1000 : undefined,
  )

  const [internalVoiceDialogOpen, setInternalVoiceDialogOpen] = useState(false)

  // Use controlled ratio from parent if provided, otherwise use local state
  const [localSelectedRatio, setLocalSelectedRatio] = useState<AspectRatio>('9:16')
  const selectedRatio = selectedRatioProp ?? localSelectedRatio
  const setSelectedRatio = useCallback(
    (ratio: AspectRatio) => {
      setLocalSelectedRatio(ratio)
      onRatioChange?.(ratio)
    },
    [onRatioChange],
  )

  const [internalLongTakeStyleDialogOpen, setInternalLongTakeStyleDialogOpen] = useState(false)
  const [sourceFilterSettings, setSourceFilterSettings] = useState<null | SourceFilterSettings>(
    null,
  )

  const storyModeUserLimits = useStoryModeUserLimits()
  const isMobile = useIsMobile()
  const defaultVoiceId = useDefaultVoiceId()
  const guardedOnLongTakeStyleApply = onLongTakeStyleApply ? onLongTakeStyleApply : undefined

  const {
    failed: presetVoicesFailed,
    loading: isLoadingPresetVoices,
    options: presetVoiceOptions,
  } = usePresetVoiceOptions()
  const {
    failed: userVoicesFailed,
    loading: isLoadingUserVoices,
    userVoices: voiceCloneOptions,
  } = useUserVoiceClones()
  const [pendingSourceVoice, setPendingSourceVoice] = useAtom(pendingSourceVoiceAtom)
  const voiceOptions = useMemo(
    () => [...voiceCloneOptions, ...presetVoiceOptions],
    [voiceCloneOptions, presetVoiceOptions],
  )
  const displaySelectedVoice = useMemo(
    () => resolveDisplayVoiceOption({ defaultVoiceId, selectedVoice, voiceOptions }),
    [defaultVoiceId, selectedVoice, voiceOptions],
  )

  const isStoryModeLayout = layout === 'story'
  const showStoryModeVoiceButton = !storyModeHasAudioAttachment
  const isLongTakeStyleDialogOpen = longTakeStyleDialogOpen ?? internalLongTakeStyleDialogOpen
  const setIsLongTakeStyleDialogOpen =
    onLongTakeStyleDialogOpenChange ?? setInternalLongTakeStyleDialogOpen
  const isVoiceDialogOpen = isVoiceDialogOpenProp ?? internalVoiceDialogOpen
  const setIsVoiceDialogOpen = onVoiceDialogOpenChange ?? setInternalVoiceDialogOpen

  useEffect(() => {
    if (!longTakeEnabled) {
      setIsLongTakeStyleDialogOpen(false)
    }
  }, [longTakeEnabled, setIsLongTakeStyleDialogOpen])

  // Gate the auto-select reset on a fully-settled catalog (see
  // `isVoiceCatalogReady`) so a transient empty / partial / errored options
  // list can't demote the user's committed voice to Auto-select.
  const catalogReady = isVoiceCatalogReady({
    isLoadingPresetVoices,
    isLoadingUserVoices,
    presetVoicesFailed,
    userVoicesFailed,
  })

  useVoiceAutoSelect({ catalogReady, selectedVoice, setSelectedVoice, voiceOptions })

  useEffect(() => {
    if (!pendingSourceVoice) {
      return
    }

    if (isLoadingPresetVoices || isLoadingUserVoices) {
      return
    }

    const { selectedVoice: resolvedVoice } = resolveRemixVoiceSelection({
      presetVoiceOptions,
      sourceVoice: pendingSourceVoice,
      voiceCloneOptions: voiceCloneOptions,
    })

    if (resolvedVoice !== undefined) {
      setSelectedVoice(resolvedVoice)
    }

    setPendingSourceVoice(null)
  }, [
    isLoadingPresetVoices,
    isLoadingUserVoices,
    pendingSourceVoice,
    presetVoiceOptions,
    setPendingSourceVoice,
    setSelectedVoice,
    voiceCloneOptions,
  ])

  const handleVoiceBrowse = useCallback(
    (voice: null | VoiceOption) => {
      setSelectedVoice(voice)
    },
    [setSelectedVoice],
  )

  const persistLastUsedVoiceId = useCallback((voiceValue: string) => {
    if (typeof window === 'undefined') {
      return
    }
    if (voiceValue === 'auto-select') {
      localStorage.removeItem('lastUsedVoiceId')
    } else {
      localStorage.setItem('lastUsedVoiceId', voiceValue)
    }
  }, [])

  const handleVoiceConfirm = useCallback(
    (voice: null | VoiceOption) => {
      if (!voice) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('lastUsedVoiceId')
        }
        setSelectedVoice(voice)
        return
      }

      persistLastUsedVoiceId(voice.value)
      setSelectedVoice(voice)
    },
    [persistLastUsedVoiceId, setSelectedVoice],
  )

  const handleSourceFilterSave = useCallback((settings: SourceFilterSettings) => {
    setSourceFilterSettings(settings)
  }, [])

  const hasSourceFilterApplied = useMemo(() => {
    if (!sourceFilterSettings) {
      return false
    }
    const hasYoutubeFilter = sourceFilterSettings.youtubeFilter !== 'all'
    const hasBlockedSites = sourceFilterSettings.blockedSites.length > 0
    return hasYoutubeFilter || hasBlockedSites
  }, [sourceFilterSettings])

  const getVoiceDisplayName = useCallback(() => {
    if (!selectedVoice || selectedVoice.value === 'auto-select') {
      return 'Auto-select'
    }
    return selectedVoice.name
  }, [selectedVoice])

  const disableNonScriptActions = disabled || longTakeEnabled

  const handleVoiceClick = useCallback(() => {
    if (isMobile) {
      return
    }
    setIsVoiceDialogOpen(true)
  }, [isMobile, setIsVoiceDialogOpen])

  const handleLongTakeStyleClick = useCallback(() => {
    setIsLongTakeStyleDialogOpen(true)
  }, [setIsLongTakeStyleDialogOpen])

  const longTakeStyleButton = (
    <LongTakeStyleButton
      disabled={disabled}
      onClick={handleLongTakeStyleClick}
      visible={longTakeEnabled}
    />
  )

  const longTakeDurationButton = (
    <LongTakeDurationButton
      disabled={disabled}
      onChange={(seconds) => onLongTakeTargetDurationSecondsChange?.(seconds)}
      optionsSeconds={storyModeUserLimits.pickerOptionsSeconds}
      valueSeconds={longTakeTargetDurationSeconds}
      visible={longTakeEnabled}
    />
  )

  const baseSettingsEntries: SettingsEntry[] = useMemo(() => {
    const entries: SettingsEntry[] = [
      {
        type: 'ratio',
        value: selectedRatio,
        onChange: setSelectedRatio,
        // Enable additional ratios for Story Mode.
        enableAllRatios: longTakeEnabled,
      },
      {
        type: 'caption',
        disabled: longTakeEnabled,
        enabled: showCaptions,
        onChange: setShowCaptions,
      },
    ]
    entries.push({
      type: 'source-filter',
      applied: hasSourceFilterApplied,
      disabled: longTakeEnabled,
      onSave: handleSourceFilterSave,
    })
    return entries
  }, [
    longTakeEnabled,
    selectedRatio,
    setSelectedRatio,
    showCaptions,
    setShowCaptions,
    hasSourceFilterApplied,
    handleSourceFilterSave,
  ])

  const mobileSettingsEntries: SettingsEntry[] = (() => {
    const entries: SettingsEntry[] = []

    entries.push({
      type: 'voice',
      displayName: getVoiceDisplayName(),
      onApply: handleVoiceConfirm,
      selectedVoiceId: selectedVoice?.value ?? null,
    })

    return [...entries, ...baseSettingsEntries]
  })()

  const actionDialogs = (
    <ChatBoxLeftActionsDialogs
      disabled={disabled}
      displaySelectedVoice={displaySelectedVoice}
      handleVoiceBrowse={handleVoiceBrowse}
      handleVoiceConfirm={handleVoiceConfirm}
      isLongTakeStyleApplyEnabled={isLongTakeStyleApplyEnabled}
      isLongTakeStyleApplySaving={isLongTakeStyleApplySaving}
      isLongTakeStyleDialogOpen={isLongTakeStyleDialogOpen}
      isLongTakeStyleGeneratePreviewEnabled={isLongTakeStyleGeneratePreviewEnabled}
      isLongTakeStylePreviewGenerating={isLongTakeStylePreviewGenerating}
      isVoiceDialogOpen={isVoiceDialogOpen}
      longTakeStyleCustom={longTakeStyleCustom}
      longTakeStyleImageError={longTakeStyleImageError}
      longTakeStyleImageValue={longTakeStyleImageValue}
      longTakeStyleInputMode={longTakeStyleInputMode}
      longTakeStyleName={longTakeStyleName}
      longTakeStylePreviewImageUrl={longTakeStylePreviewImageUrl}
      onLongTakeStyleApply={guardedOnLongTakeStyleApply}
      onLongTakeStyleCustomChange={onLongTakeStyleCustomChange}
      onLongTakeStyleGeneratePreview={onLongTakeStyleGeneratePreview}
      onLongTakeStyleImageClear={onLongTakeStyleImageClear}
      onLongTakeStyleImageSelect={onLongTakeStyleImageSelect}
      onLongTakeStyleNameChange={onLongTakeStyleNameChange}
      onLongTakeStyleTextClear={onLongTakeStyleTextClear}
      setIsLongTakeStyleDialogOpen={setIsLongTakeStyleDialogOpen}
      setIsVoiceDialogOpen={setIsVoiceDialogOpen}
    />
  )

  // Enhance review mode text display
  if (chatBoxMode === 'enhance-review') {
    return (
      <span
        className={cn(
          'text-secondary text-sm sm:whitespace-nowrap pl-3',
          isEnhancing && 'shine-text',
        )}
      >
        {isEnhancing ? enhancingMessages[enhancingStep] : 'Prompt enhanced'}
      </span>
    )
  }

  if (isStoryModeLayout) {
    return (
      <>
        <div className="relative flex flex-wrap items-center gap-2 text-white">
          {showStoryModeVoiceButton && (
            <div data-onboarding-target="voice-selector">
              <StoryModeVoiceButton
                disabled={disabled}
                onOpenVoiceDialog={handleVoiceClick}
                selectedVoice={displaySelectedVoice}
                variant="story-bar"
              />
            </div>
          )}
        </div>
        {actionDialogs}
      </>
    )
  }

  return (
    <>
      <div className="relative flex flex-row items-center">
        {/* File Upload button */}
        {longTakeEnabled ? (
          <FileUploadButton
            accept={STORY_MODE_AUDIO_ACCEPT}
            disabled={disabled}
            icon={<AddVoiceoverSquare className="size-[18px]" />}
            onClick={onFileUploadClick}
            onFileChange={handleFileChange}
            ref={fileInputRef}
            tooltipContent="Upload an audio file for Story Mode"
          />
        ) : (
          <FileUploadButton
            disabled={disableNonScriptActions}
            onClick={onFileUploadClick}
            onFileChange={handleFileChange}
            ref={fileInputRef}
          />
        )}

        <SettingsDropdownMenu
          disabled={disabled}
          entries={isMobile ? mobileSettingsEntries : baseSettingsEntries}
          ref={settingsMenuRef}
          variant={isMobile ? 'drawer' : 'popover'}
        />

        {/* Divider + Voice + Hook buttons: hidden on mobile */}
        {!isMobile && (
          <>
            {!hideVoiceButton && (
              <StoryModeVoiceButton
                disabled={disabled}
                onOpenVoiceDialog={handleVoiceClick}
                selectedVoice={displaySelectedVoice}
                variant="default"
              />
            )}
            {longTakeStyleButton}
            {longTakeDurationButton}
          </>
        )}
      </div>
      {actionDialogs}
    </>
  )
}

export const ChatBoxLeftActions = React.memo(ChatBoxLeftActionsComponent)
