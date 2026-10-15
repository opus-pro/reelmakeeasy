import { Logger } from '@reelmakeeasy/common/utils/logger'
import { toast } from '@shared/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { memo, useEffect, useRef, useState } from 'react'

import { CheckMark, MicrophoneOff, Pin } from '@/components/icons/core'
import { DeleteIcon, RenameIcon } from '@/components/shared/resource-icons'
import { ResourceMenuAction } from '@/components/shared/ResourceOptionsMenu'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { useAudio } from '@/hooks/useAudio'
import { useIsMobile } from '@/util/browserUtils'

import { VoiceDeleteConfirmDialog } from '../dialogs/VoiceDeleteConfirmDialog'
import { VoiceRenameDialog } from '../dialogs/VoiceRenameDialog'

import { NEEDS_GEMINI_KEY_LABEL, SETUP_HREF, voiceUnavailableReason } from './tts-engine-copy'
import { useTtsEnginesResponse } from './tts-engines'
import { type VoiceOption } from './voice-over-selection'
import { VOICE_PREVIEW_PLAYBACK_ERROR } from './voice-preview-copy'
import { VoiceItem } from './VoiceItem'

const nsLogger = Logger.get('voice.voice-list')

// Custom toast for voice actions with green checkmark
const voiceToast = {
  success: (message: string) => {
    toast.custom((t) => (
      <div
        className="pointer-events-auto inline-flex items-start gap-1.5 p-2.5 shadow-lg"
        style={{
          borderRadius: 'var(--Radius-rounded-button, 10px)',
          background: 'var(--UI-menu-background, rgba(68, 68, 68, 0.50))',
          backdropFilter: 'blur(40px)',
        }}
      >
        <CheckMark className="size-5 text-[#A8E21F]" />
        <div className="text-[var(--primary)] text-sm leading-5 font-normal whitespace-nowrap">
          {message}
        </div>
      </div>
    ))
  },
}

interface VoiceListProps {
  allVoices?: VoiceOption[]
  compact?: boolean
  defaultVoiceId?: null | string
  disableHover?: boolean
  onSelect?: (voice: null | VoiceOption, isForced?: boolean) => void
  onSetDefaultVoice?: (voiceId: null | string) => void
  onVoiceDeleted?: (voiceId: string) => void
  onVoiceRenamed?: (voiceId: string, newName: string) => void
  selected: null | string
  showLanguageBadge?: boolean
  showToneLabel?: boolean
  showVoiceMenu?: boolean
  voiceListContext?: 'avatar-creation' | 'drawer-settings' | 'main-dialog'
  voices: VoiceOption[]
}

export const VoiceList: React.FC<VoiceListProps> = ({
  allVoices,
  compact = false,
  defaultVoiceId = null,
  disableHover = false,
  onSelect,
  onSetDefaultVoice,
  onVoiceDeleted,
  onVoiceRenamed,
  selected,
  voices,
  showLanguageBadge = true,
  showToneLabel = false,
  showVoiceMenu = true,
  voiceListContext,
}) => {
  const shouldElevateNestedLayers = voiceListContext === 'main-dialog'
  const nestedDialogClassNames = shouldElevateNestedLayers
    ? {
        content: 'z-[96]',
        overlay: 'z-[95]',
      }
    : undefined
  const nestedMenuClassName = shouldElevateNestedLayers ? 'z-[96]' : undefined

  // A single failing source reports twice: once from the media element's error event and
  // once from the rejected play promise. Latched per attempt so both produce one toast.
  const failedPlaybackRef = useRef(false)
  // Bumped on every click and on unmount, so a response that lands after the user moved
  // on neither plays nor toasts.
  const playbackRequestRef = useRef(0)
  const [loadingVoiceId, setLoadingVoiceId] = useState<null | string>(null)
  const showPlaybackError = useRefCallback(() => {
    if (failedPlaybackRef.current) {
      return
    }
    failedPlaybackRef.current = true
    toast.error(VOICE_PREVIEW_PLAYBACK_ERROR)
  })
  const { pause, playingId, toggle } = useAudio({ onError: showPlaybackError })

  useEffect(
    () => () => {
      playbackRequestRef.current += 1
    },
    [],
  )

  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [voiceToDelete, setVoiceToDelete] = useState<null | VoiceOption>(null)
  const [voiceToRename, setVoiceToRename] = useState<null | VoiceOption>(null)
  const [openMenuVoiceId, setOpenMenuVoiceId] = useState<null | string>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Clones that can't speak with the keys and the generation provider (an ElevenLabs clone
  // without its key; on Gemini, MiniMax clones and Qwen3 clones without the local voices) are
  // greyed out like expired ones.
  const engines = useTtsEnginesResponse()
  const isVoiceSelectableForUse = (voice: VoiceOption) =>
    !voice.isExpired && !voiceUnavailableReason(voice, engines)

  const voiceClonePlaybackMutation = useMutation({
    mutationFn: async (voiceCloneId: string) => {
      const res = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
        voiceCloneId: string
      }>(`/api/voice-clones/${voiceCloneId}/playback`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to get playback URL')
      }

      return res.data
    },
  })

  const voiceOverPreviewMutation = useMutation({
    mutationFn: async (voiceId: string) => {
      const res = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
      }>(`/api/voice-over/${voiceId}/preview`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to get presigned URL')
      }

      return res.data
    },
  })

  // Delete voice clone mutation
  const deleteVoiceCloneMutation = useMutation({
    mutationFn: async (voiceCloneId: string) => {
      const res = await fetchWithProjectId(`/api/voice-clones/${voiceCloneId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to delete voice clone')
      }

      return res.data
    },
    onSuccess: () => {
      // Invalidate and refetch user voice clones list
      queryClient.invalidateQueries({ queryKey: ['user-voice-clones'] })
      // Invalidate avatars list to reflect voiceId changes
      queryClient.invalidateQueries({ queryKey: ['avatars'] })
    },
  })

  // Rename voice clone mutation
  const renameVoiceCloneMutation = useMutation({
    mutationFn: async ({ name, voiceCloneId }: { name: string; voiceCloneId: string }) => {
      const res = await fetchWithProjectId(`/api/voice-clones/${voiceCloneId}`, {
        data: { name },
        method: 'PUT',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to rename voice')
      }

      return res.data
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to rename voice')
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-voice-clones'] })
      voiceToast.success('Voice renamed successfully')
      // Use voiceCloneId (which equals .value for voice clones) for consistency with API
      onVoiceRenamed?.(variables.voiceCloneId, variables.name)
      setVoiceToRename(null)
    },
  })

  const handlePlayback = async (voice: VoiceOption) => {
    const requestId = ++playbackRequestRef.current
    failedPlaybackRef.current = false
    pause()
    if (playingId === voice.value) {
      setLoadingVoiceId(null)
      return
    }
    setLoadingVoiceId(voice.value)
    try {
      const url = voice.voiceCloneId
        ? (await voiceClonePlaybackMutation.mutateAsync(voice.voiceCloneId)).signedUrl
        : voice.needsPresignedUrl
          ? (await voiceOverPreviewMutation.mutateAsync(voice.value)).signedUrl
          : voice.previewAudioUrl
      if (requestId !== playbackRequestRef.current) {
        return
      }
      if (!url) {
        throw new Error('Voice preview URL is missing')
      }
      toggle(voice.value, url)
    } catch (error) {
      if (requestId !== playbackRequestRef.current) {
        return
      }
      nsLogger.error('Failed to play voice preview:', error)
      showPlaybackError()
    } finally {
      if (requestId === playbackRequestRef.current) {
        setLoadingVoiceId(null)
      }
    }
  }

  const handleRenameClick = (voice: VoiceOption): void => {
    setVoiceToRename(voice)
  }

  const handleConfirmRename = async (voiceCloneId: string, newName: string): Promise<void> => {
    await renameVoiceCloneMutation.mutateAsync({ name: newName, voiceCloneId })
  }

  const handleCancelRename = (): void => {
    setVoiceToRename(null)
  }

  const handleDeleteClick = (voice: VoiceOption): void => {
    setVoiceToDelete(voice)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!voiceToDelete?.voiceCloneId) {
      return
    }

    try {
      const deletedVoiceId = voiceToDelete.value
      await deleteVoiceCloneMutation.mutateAsync(voiceToDelete.voiceCloneId)
      nsLogger.log('Voice clone deleted successfully:', voiceToDelete.voiceCloneId)

      // If the deleted voice was the default voice, clear the default
      const wasDeletingDefault = deletedVoiceId === defaultVoiceId
      if (wasDeletingDefault) {
        handleClearDefault()
      }

      // If the deleted voice was selected, switch to default voice or clear selection
      if (selected === deletedVoiceId && onSelect) {
        const voicePool = (allVoices ?? voices).filter((voice) => voice.value !== deletedVoiceId)
        const selectableVoicePool = voicePool.filter(isVoiceSelectableForUse)
        const fallbackVoice = wasDeletingDefault
          ? selectableVoicePool.find((v) => v.value === 'auto-select') || null
          : defaultVoiceId
            ? selectableVoicePool.find((v) => v.value === defaultVoiceId) || null
            : selectableVoicePool.find((v) => v.value === 'auto-select') || null
        onSelect(fallbackVoice || null, true)
      }

      onVoiceDeleted?.(deletedVoiceId)
      setVoiceToDelete(null)
    } catch (error) {
      nsLogger.error('Failed to delete voice clone:', error)
      setVoiceToDelete(null)
    }
  }

  const handleCancelDelete = (): void => {
    setVoiceToDelete(null)
  }

  // Handle set as default
  // Uses localStorage as local cache for default voice preference.
  const handleSetDefault = (voice: VoiceOption): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultVoiceId', voice.value)
      onSetDefaultVoice?.(voice.value)
      voiceToast.success(`${voice.name} is now your default voice`)
    }
  }

  // Handle clear default
  const handleClearDefault = (): void => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('defaultVoiceId')
      onSetDefaultVoice?.(null)
      voiceToast.success('Default voice cleared, auto-select is now default')
    }
  }

  // Create actions for voice menu
  const createVoiceActions = (voice: VoiceOption): ResourceMenuAction[] => {
    const actions: ResourceMenuAction[] = []

    const isAutoSelect = voice.value === 'auto-select'
    const isDefaultVoice = voice.value === defaultVoiceId || (isAutoSelect && !defaultVoiceId)
    const isExpired = voice.isExpired
    const isLibraryVoice = !voice.voiceCloneId
    const isMainDialog = voiceListContext === 'main-dialog'
    const isAvatarCreation = voiceListContext === 'avatar-creation'

    // Main dialog OR Avatar creation + Library voices: NO MENU AT ALL
    if ((isMainDialog || isAvatarCreation) && isLibraryVoice) {
      return []
    }

    // Main dialog OR Avatar creation + My voices: NO default actions, only rename/delete
    // Drawer settings (undefined): Full menu with default actions (existing behavior)
    const shouldShowDefaultActions = !isMainDialog && !isAvatarCreation

    // Show default actions for non-expired voices (only in drawer settings)
    if (shouldShowDefaultActions && !isExpired && !isAutoSelect) {
      // If this voice is the current default, show "Clear default" (also once it can't be used:
      // a key removed since). Otherwise, "Set as default", only on a voice that can be used.
      if (isDefaultVoice) {
        actions.push({
          icon: <Pin className="size-4" />,
          id: 'clear-default',
          label: 'Clear default',
          onClick: () => handleClearDefault(),
        })
      } else if (!voiceUnavailableReason(voice, engines)) {
        actions.push({
          icon: <Pin className="size-4" />,
          id: 'set-default',
          label: 'Set as default',
          onClick: () => handleSetDefault(voice),
        })
      }
    }

    // Custom voices: show rename and delete (for main dialog and avatar creation)
    if (voice.voiceCloneId) {
      actions.push(
        {
          icon: <RenameIcon className="size-4" />,
          id: 'rename',
          label: 'Rename',
          onClick: () => handleRenameClick(voice),
        },
        {
          icon: <DeleteIcon />,
          id: 'delete',
          label: 'Delete',
          onClick: () => handleDeleteClick(voice),
        },
      )
    }

    return actions
  }

  return (
    <>
      <div className="relative size-full">
        <div
          className="flex flex-col h-full gap-1 md:gap-0 overflow-y-scroll scrollbar-thin py-1 pr-1 pb-42 md:pb-0"
          ref={scrollRef}
        >
          {voices.length === 0 ? (
            <div className="flex flex-col gap-3 items-center justify-center h-full pb-6">
              <MicrophoneOff className="size-11 text-secondary" />
              <div className="text-secondary text-center">
                <p className="text-sm">No voices yet</p>
                <p className="text-xs sm:hidden">Please use the website on desktop to create one</p>
              </div>
            </div>
          ) : (
            voices.map((voice) => {
              const isSelected = selected === voice.value
              const isPlaying = playingId === voice.value
              const isLoading = loadingVoiceId === voice.value
              const isExpired = voice.isExpired

              const isAutoSelect = voice.value === 'auto-select'
              // If no default is set, auto-select is the default
              const isDefaultVoice =
                voice.value === defaultVoiceId || (isAutoSelect && !defaultVoiceId)

              // Determine if we should show menu
              const shouldShowMenu = (() => {
                // Never show menu for auto-select when it's default
                if (isAutoSelect && isDefaultVoice) {
                  return false
                }

                // Main dialog OR Avatar creation context: only show menu for custom voices
                if (voiceListContext === 'main-dialog' || voiceListContext === 'avatar-creation') {
                  return showVoiceMenu && !!voice.voiceCloneId
                }

                // Other contexts (drawer settings with undefined): show menu based on prop
                return showVoiceMenu
              })()

              const voiceActions = shouldShowMenu ? createVoiceActions(voice) : []
              // A row with nothing to offer (a voice that can't be used) shows no menu button.
              const actions = voiceActions.length ? voiceActions : null

              return (
                <VoiceItem
                  compact={compact}
                  disableHover={disableHover}
                  isDefault={isDefaultVoice}
                  isExpired={isExpired}
                  isLoading={isLoading}
                  isPlaying={isPlaying}
                  isSelected={isSelected}
                  key={voice.value}
                  menuActions={actions}
                  menuClassName={nestedMenuClassName}
                  menuOpen={openMenuVoiceId === voice.value}
                  onMenuOpenChange={(open) => {
                    setOpenMenuVoiceId(open ? voice.value : null)
                  }}
                  onPlayback={handlePlayback}
                  onSelect={onSelect}
                  // A preset's preview ships with the app, so it plays even when it can't be picked.
                  previewWhenUnavailable={!voice.voiceCloneId}
                  showLanguage={showLanguageBadge}
                  showToneLabel={showToneLabel}
                  unavailableHref={
                    voiceUnavailableReason(voice, engines) === NEEDS_GEMINI_KEY_LABEL
                      ? SETUP_HREF
                      : undefined
                  }
                  unavailableReason={voiceUnavailableReason(voice, engines)}
                  voice={voice}
                />
              )
            })
          )}
        </div>
      </div>

      <VoiceDeleteConfirmDialog
        dialogClassNames={nestedDialogClassNames}
        onCancel={handleCancelDelete}
        onConfirmDelete={handleConfirmDelete}
        open={!!voiceToDelete}
        showClose={isMobile ? false : true}
        voice={voiceToDelete}
      />

      <VoiceRenameDialog
        dialogClassNames={nestedDialogClassNames}
        isPending={renameVoiceCloneMutation.isPending}
        onCancel={handleCancelRename}
        onConfirmRename={handleConfirmRename}
        open={!!voiceToRename}
        showClose={isMobile ? false : true}
        voice={voiceToRename}
      />
    </>
  )
}

export default memo(VoiceList)
