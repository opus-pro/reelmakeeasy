'use client'
import { Button, cn } from '@shared/ui'
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { AddVoiceoverSquare, Camera, CrossSmall, MagicEdit, Music } from '@/components/icons/core'
import {
  type EngineFilter,
  filterVoicesByEngine,
  TtsEngineToggle,
} from '@/components/voice/components/tts-engines'
import {
  usePresetVoiceOptions,
  useUserVoiceClones,
  type VoiceOption,
} from '@/components/voice/components/voice-over-selection'
import { useVoiceListData } from '@/components/voice/components/VoiceClone'
import { VoiceList } from '@/components/voice/components/VoiceList'
import { VoiceCreateDialog } from '@/components/voice/dialogs/VoiceCreateDialog'
import { VoiceDesignDialog } from '@/components/voice/dialogs/VoiceDesignDialog'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useAudio } from '@/hooks/useAudio'
import { useIsMobile } from '@/util/browserUtils'

import {
  isStoryModeVideoAudioSource,
  STORY_MODE_AUDIO_ACCEPT,
  STORY_MODE_MAX_AUDIO_DURATION_MINUTES,
} from '../omni-chat-box-helpers'
import { BackdropDialog } from '../shared/BackdropDialog'
import { getAudioInputRefAtom, getTriggerUploadFileAtom } from '../state/atoms/domain/audio'
import { useChatBoxState } from '../state/chatbox-context'

import { useVoiceFilter } from './useVoiceFilter'
import { VoiceFilterPanel } from './VoiceFilterPanel'

// Accept audio + video containers for Story Mode voice-over; video files are
// gated through a pre-upload confirmation popup inside processFiles.
const DEFAULT_AUDIO_ACCEPT = STORY_MODE_AUDIO_ACCEPT
const SUPPORTED_AUDIO_UPLOAD_FORMATS_LABEL = 'MP3, M4A, WAV, MP4'

const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

type ActionButtonProps = {
  className?: string
  onClick: () => void
}

type ApplyButtonProps = ActionButtonProps & { disabled: boolean }

type AudioVoiceoverDialogProps = {
  audioUploadEnabled?: boolean
  // Max audio-upload duration (minutes) shown on the card. Defaults to the
  // legacy ceiling; callers pass the expanded figure for gated users so the
  // card reads "up to 10 min".
  maxAudioDurationMinutes?: number
  onApplyVoice: (voice: null | VoiceOption) => void
  onOpenChange: (open: boolean) => void
  onUploadAudioFile: (file: File) => Promise<void> | void
  open: boolean
  // True when the calling context will route video-extension uploads through
  // the VideoAudioConfirmDialog (story-mode). In that case the dialog defers
  // its own close to the parent so cancel re-opens it. Outside story-mode
  // (UGC video / News Article) no confirm fires, so the dialog must close
  // itself after upload like it does for plain audio.
  requiresVideoSourceConfirm?: boolean
  selectedVoice: null | VoiceOption
  voiceSelectionEnabled?: boolean
}

type UploadCardProps = {
  audioUploadEnabled: boolean
  className?: string
  maxAudioDurationMinutes: number
  onClick: () => void
}

export function AudioVoiceoverDialog({
  audioUploadEnabled = true,
  voiceSelectionEnabled = true,
  maxAudioDurationMinutes = STORY_MODE_MAX_AUDIO_DURATION_MINUTES,
  onApplyVoice,
  onOpenChange,
  onUploadAudioFile,
  open,
  requiresVideoSourceConfirm = false,
  selectedVoice,
}: AudioVoiceoverDialogProps) {
  const chatBoxState = useChatBoxState()
  const { pause, playingId, toggle } = useAudio()
  const isMobile = useIsMobile()

  const [currentSelectedId, setCurrentSelectedId] = useState<null | string>(
    selectedVoice?.value ?? null,
  )
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isDesignDialogOpen, setIsDesignDialogOpen] = useState(false)

  const getAudioInputRef = useRefCallback((ref: HTMLInputElement | null) => {
    chatBoxState.set(getAudioInputRefAtom, ref)
  })

  const { options: presetVoices } = usePresetVoiceOptions()
  const { refetch, userVoices: customVoices } = useUserVoiceClones()
  const {
    activeTab,
    displayVoices,
    libraryVoicesWithAutoSelect,
    setActiveTab,
    sortedCustomVoices,
  } = useVoiceListData({
    customVoices,
    presetVoices,
    selectedVoiceId: selectedVoice?.value ?? null,
    showAutoSelectOption: false,
  })

  const allVoices = useMemo(
    () => [...libraryVoicesWithAutoSelect, ...sortedCustomVoices],
    [libraryVoicesWithAutoSelect, sortedCustomVoices],
  )

  const selectedVoiceOption = useMemo(
    () => allVoices.find((voice) => voice.value === currentSelectedId) ?? null,
    [allVoices, currentSelectedId],
  )

  const isApplyDisabled = Boolean(
    !selectedVoiceOption || selectedVoiceOption.visible === false || selectedVoiceOption.isExpired,
  )

  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all')
  const engineVoices = useMemo(
    () => filterVoicesByEngine(displayVoices, engineFilter),
    [displayVoices, engineFilter],
  )

  const voiceFilter = useVoiceFilter({
    activeTab,
    dialogOpen: open,
    displayVoices: engineVoices,
    libraryVoices: libraryVoicesWithAutoSelect,
    pinnedVoiceId: selectedVoice?.value ?? null,
  })

  // Reset dialog state when it closes
  useEffect(() => {
    if (!open) {
      setIsCreateDialogOpen(false)
      return
    }
    setCurrentSelectedId(selectedVoice?.value ?? null)
  }, [open, selectedVoice?.value])

  const { closeFilterPanel } = voiceFilter
  const handleTabChange = useCallback(
    (tab: 'library' | 'my-voices') => {
      setActiveTab(tab)
      closeFilterPanel()
    },
    [setActiveTab, closeFilterPanel],
  )

  const handleUploadCardClick = useRefCallback(() => {
    if (!audioUploadEnabled) {
      return
    }
    chatBoxState.get(getAudioInputRefAtom)?.click()
  })
  chatBoxState.useNullRegister(getTriggerUploadFileAtom, handleUploadCardClick)

  const handleAudioInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      const audioInputRef = chatBoxState.get(getAudioInputRefAtom)
      if (audioInputRef) {
        audioInputRef.value = ''
      }
      if (!file) {
        return
      }
      // Video sources go through a pre-upload confirm popup in
      // processFiles when the parent enables it (story-mode). If the user
      // cancels that popup we want to return them to this voice-over dialog,
      // not dismiss both. So we skip the unconditional close only in that
      // context; the parent explicitly closes via handleVideoAudioConfirm.
      // Outside story-mode no confirm popup fires, so close like for audio.
      const deferCloseToParent = requiresVideoSourceConfirm && isStoryModeVideoAudioSource(file)
      try {
        await onUploadAudioFile(file)
      } finally {
        if (!deferCloseToParent) {
          onOpenChange(false)
        }
      }
    },
    [onOpenChange, onUploadAudioFile, requiresVideoSourceConfirm],
  )

  const handleApplyVoice = useCallback(() => {
    if (!selectedVoiceOption || isApplyDisabled) {
      return
    }
    onApplyVoice(selectedVoiceOption)
    onOpenChange(false)
  }, [isApplyDisabled, onApplyVoice, onOpenChange, selectedVoice?.value, selectedVoiceOption])

  const handleCloneVoiceClick = useCallback(() => {
    setIsCreateDialogOpen(true)
  }, [])

  const handleVoiceCreated = useCallback(
    async (voice: VoiceOption) => {
      await refetch()
      setCurrentSelectedId(voice.value)
      setIsCreateDialogOpen(false)
      setIsDesignDialogOpen(false)
    },
    [refetch],
  )

  return (
    <>
      <BackdropDialog
        contentClassName={cn(
          'w-[544px] max-w-[calc(100vw-32px)]',
          voiceSelectionEnabled && 'h-[min(560px,calc(100dvh-32px))]',
        )}
        ignoreInteractOutside={isMobile}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isCreateDialogOpen && !isDesignDialogOpen) {
            onOpenChange(false)
          }
        }}
        open={open && !isCreateDialogOpen && !isDesignDialogOpen}
        title="Audio & voiceover"
      >
        <section className="relative flex size-full gap-2 md:gap-0 min-h-0 max-h-full max-w-[544px] flex-col rounded-3xl bg-menu-background px-4 pb-4 max-sm:max-w-full">
          <header className="flex w-full items-center gap-4 pt-4 md:pt-3 md:py-4">
            <div className="flex min-h-[22px] min-w-0 flex-1 flex-col justify-center py-[3px]">
              <h2
                className="text-[18px] font-semibold leading-[21.8px] text-white"
                style={FF_STYLE}
              >
                Audio & voiceover
              </h2>
            </div>
            <button
              aria-label="Close audio and voiceover dialog"
              className="flex shrink-0 size-[38px] md:size-auto items-center justify-center rounded-full bg-white/10 transition-colors md:hover:bg-white/[0.18]"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <CrossSmall className="size-[var(--mobile-icon-size)] md:size-6 text-white" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-visible pb-4">
            {(!isMobile || !voiceSelectionEnabled) && (
              <UploadCard
                audioUploadEnabled={audioUploadEnabled}
                maxAudioDurationMinutes={maxAudioDurationMinutes}
                onClick={handleUploadCardClick}
              />
            )}

            <input
              accept={DEFAULT_AUDIO_ACCEPT}
              className="hidden"
              disabled={!audioUploadEnabled}
              onChange={handleAudioInputChange}
              ref={getAudioInputRef}
              type="file"
            />

            {voiceSelectionEnabled && !isMobile && (
              <p className="text-center text-sm leading-[22px] text-white/30" style={FF_STYLE}>
                OR
              </p>
            )}

            {voiceSelectionEnabled && (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {/* Tab bar + action buttons */}
                <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    {[
                      {
                        key: 'library' as const,
                        label: isMobile ? 'Pick a voice' : 'Library',
                      },
                      { key: 'my-voices' as const, label: 'My voices' },
                    ].map((tab) => (
                      <button
                        className={cn(
                          'h-[38px] border-b text-base md:text-sm font-medium transition-colors',
                          activeTab === tab.key
                            ? 'border-white text-white'
                            : 'border-transparent text-white/50',
                        )}
                        key={tab.key}
                        onClick={() => handleTabChange(tab.key)}
                        style={FF_STYLE}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'library' && <VoiceFilterPanel {...voiceFilter} />}

                  {!isMobile && (
                    <>
                      <DesignVoiceButton
                        className="shrink-0 rounded-sm"
                        onClick={() => setIsDesignDialogOpen(true)}
                      />
                      <CloneVoiceButton
                        className="shrink-0 rounded-sm"
                        onClick={handleCloneVoiceClick}
                      />
                    </>
                  )}
                </div>

                <TtsEngineToggle onChange={setEngineFilter} value={engineFilter} />

                <div className="min-h-0 flex-1 overflow-hidden">
                  {voiceFilter.filteredDisplayVoices.length === 0 &&
                  (engineFilter !== 'all' ||
                    (activeTab === 'library' && voiceFilter.activeFilterCount > 0)) ? (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-sm text-white/30" style={FF_STYLE}>
                        No voices match these filters.
                      </p>
                    </div>
                  ) : (
                    <VoiceList
                      onSelect={(voice) => setCurrentSelectedId(voice?.value ?? null)}
                      selected={currentSelectedId}
                      showLanguageBadge={activeTab === 'library'}
                      voiceListContext="main-dialog"
                      voices={voiceFilter.filteredDisplayVoices}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {voiceSelectionEnabled && (
            <footer
              className={cn(
                'flex items-center justify-end',
                isMobile && 'pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-4 pt-24',
              )}
            >
              {isMobile ? (
                <>
                  <div aria-hidden className="pointer-events-none absolute inset-0 translate-y-0.5">
                    <div className="absolute inset-0 [backdrop-filter:blur(20px)_saturate(120%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_55%)] [-webkit-backdrop-filter:blur(20px)_saturate(120%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_55%)]" />
                    <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,var(--bg-background)_100%)]" />
                    <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,var(--bg-background)_100%)]" />
                  </div>
                  <div className="pointer-events-auto relative flex w-full flex-col items-center gap-4">
                    <UploadCard
                      audioUploadEnabled={audioUploadEnabled}
                      maxAudioDurationMinutes={maxAudioDurationMinutes}
                      onClick={handleUploadCardClick}
                    />
                    <div className="flex w-full gap-2">
                      <DesignVoiceButton
                        className="flex-1 rounded-full"
                        onClick={() => setIsDesignDialogOpen(true)}
                      />
                      <CloneVoiceButton
                        className="flex-1 rounded-full"
                        onClick={handleCloneVoiceClick}
                      />
                      <ApplyButton
                        className="flex-1 rounded-full h-[48px] text-base"
                        disabled={isApplyDisabled}
                        onClick={handleApplyVoice}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <ApplyButton
                  className="rounded-sm"
                  disabled={isApplyDisabled}
                  onClick={handleApplyVoice}
                />
              )}
            </footer>
          )}
        </section>
      </BackdropDialog>

      {voiceSelectionEnabled && (
        <VoiceCreateDialog
          onBack={() => setIsCreateDialogOpen(false)}
          onClose={() => setIsCreateDialogOpen(false)}
          onVoiceCreated={handleVoiceCreated}
          open={isCreateDialogOpen}
          pause={pause}
          playingId={playingId}
          toggle={toggle}
        />
      )}

      {voiceSelectionEnabled && (
        <VoiceDesignDialog
          onClose={() => setIsDesignDialogOpen(false)}
          onVoiceCreated={handleVoiceCreated}
          open={isDesignDialogOpen}
        />
      )}
    </>
  )
}

function ApplyButton({ className, disabled, onClick }: ApplyButtonProps) {
  return (
    <Button
      className={cn('h-[38px] min-w-[77px] px-2.5 text-sm font-medium', className)}
      disabled={disabled}
      onClick={onClick}
      style={FF_STYLE}
      variant="primary"
    >
      Apply
    </Button>
  )
}

function CloneVoiceButton({ className, onClick }: ActionButtonProps) {
  return (
    <Button
      className={cn(
        'h-[48px] md:h-[38px] items-center justify-center gap-1.5 md:border md:border-white/10 px-2.5 text-base md:text-sm font-medium text-white transition-colors hover:bg-white/[0.08]',
        className,
      )}
      onClick={onClick}
      style={FF_STYLE}
    >
      <AddVoiceoverSquare className="size-[18px] text-white" />
      Clone voice
    </Button>
  )
}

function DesignVoiceButton({ className, onClick }: ActionButtonProps) {
  return (
    <Button
      className={cn(
        'h-[48px] md:h-[38px] items-center justify-center gap-1.5 md:border md:border-white/10 px-2.5 text-base md:text-sm font-medium text-white transition-colors hover:bg-white/[0.08]',
        className,
      )}
      onClick={onClick}
      style={FF_STYLE}
    >
      <MagicEdit className="size-[18px] text-white" />
      Design voice
    </Button>
  )
}

function UploadCard({
  audioUploadEnabled,
  className,
  maxAudioDurationMinutes,
  onClick,
}: UploadCardProps) {
  return (
    <button
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 border border-dashed border-white/[0.18] px-3 py-4 text-left transition-colors disabled:cursor-not-allowed rounded-sm backdrop-blur-2xl',
        audioUploadEnabled
          ? 'bg-[rgba(68,68,68,0.5)] hover:bg-[var(--UI-button-tonal,rgba(255,255,255,0.10))]'
          : 'cursor-not-allowed opacity-50',
        className,
      )}
      disabled={!audioUploadEnabled}
      onClick={onClick}
      type="button"
    >
      <span className="isolate flex h-[46px] shrink-0 items-center justify-center">
        <span className="z-[2] mr-[-10px] flex h-[45.363px] w-[37.661px] shrink-0 items-center justify-center">
          <span className="flex h-10 w-[30px] -rotate-12 items-center justify-center overflow-hidden rounded-xxs border border-white/10 bg-[#444]">
            <Music className="size-4 text-white/50" />
          </span>
        </span>
        <span className="z-[1] flex h-[45.363px] w-[37.661px] shrink-0 items-center justify-center">
          <span className="flex h-10 w-[30px] rotate-12 items-center justify-center overflow-hidden rounded-xxs border border-white/10 bg-[#444]">
            <Camera className="size-4 text-white/50" />
          </span>
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          className="text-base md:text-sm font-medium leading-[20px] md:leading-[17px] text-white"
          style={FF_STYLE}
        >
          Upload a file
        </span>
        <span
          className="text-sm md:text-xs leading-[22px] md:leading-[19px] text-white/50"
          style={FF_STYLE}
        >
          Used as voiceover · {SUPPORTED_AUDIO_UPLOAD_FORMATS_LABEL} · up to{' '}
          {maxAudioDurationMinutes} min
        </span>
      </span>
    </button>
  )
}

export default AudioVoiceoverDialog
