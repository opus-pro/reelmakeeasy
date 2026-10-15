'use client'
import { Button, cn, Dialog } from '@shared/ui'
import { useEffect, useState } from 'react'

import { useAudio } from '@/hooks/useAudio'

import {
  usePresetVoiceOptions,
  useUserVoiceClones,
  type VoiceOption,
} from '../components/voice-over-selection'
import VoiceClone from '../components/VoiceClone'

import { VoiceCreateDialog } from './VoiceCreateDialog'

type VoiceSelectionAuxDialogsProps = {
  isCreateDialogOpen: boolean
  onCreateDialogBack: () => void
  onCreateDialogClose: () => void
  onVoiceCreated: (voice: VoiceOption) => void
  pause: ReturnType<typeof useAudio>['pause']
  playingId: ReturnType<typeof useAudio>['playingId']
  toggle: ReturnType<typeof useAudio>['toggle']
}

type VoiceSelectionDialogClassNames = {
  content?: string
  overlay?: string
}

type VoiceSelectionDialogModel = {
  confirmDisabled: boolean
  confirmLabel: string
  description: string
  handleCreateVoiceClick: () => void
  handleUseVoice: () => void
  handleVoiceCreated: (voice: VoiceOption) => void
  handleVoiceSelect: (voice: null | VoiceOption, isForced?: boolean) => void
  initialActiveTab?: 'my-voices'
  internalSelectedVoiceId: null | string
  isAvatarCreationMode: boolean
  isCreateDialogOpen: boolean
  pause: ReturnType<typeof useAudio>['pause']
  playingId: ReturnType<typeof useAudio>['playingId']
  refetch: () => Promise<unknown>
  setIsCreateDialogOpen: (open: boolean) => void
  title: string
  toggle: ReturnType<typeof useAudio>['toggle']
}

interface VoiceSelectionDialogProps {
  dialogClassNames?: VoiceSelectionDialogClassNames
  mode?: 'avatar-creation' | 'default'
  onOpenChange: (open: boolean) => void
  onVoiceConfirm?: (voice: null | VoiceOption) => void
  onVoiceDeleted?: (voiceId: string) => void
  onVoiceSelect: (voice: null | VoiceOption) => void
  open: boolean
  selectedVoice: null | string
}

type VoiceSelectionMainDialogProps = {
  confirmDisabled: boolean
  confirmLabel: string
  description: string
  dialogClassNames?: VoiceSelectionDialogClassNames
  initialActiveTab?: 'my-voices'
  isAvatarCreationMode: boolean
  onChange: (voice: null | VoiceOption, isForced?: boolean) => void
  onClose: () => void
  onCreateVoice: () => void
  onOpenChange: (open: boolean) => void
  onUseVoice: () => void
  onVoiceDeleted?: (voiceId: string) => void
  onVoiceRenamed: () => void
  open: boolean
  title: string
  value: null | string
}

const getDialogMeta = (isAvatarCreationMode: boolean) => ({
  confirmLabel: isAvatarCreationMode ? 'Continue' : 'Apply',
  description: isAvatarCreationMode
    ? 'Create a new custom voice or select from the library'
    : 'Select a voice actor to narrate your video',
  title: isAvatarCreationMode ? 'Select a voice for your avatar' : 'Voiceover',
})

const resolveVoiceToApply = ({
  internalSelectedVoiceId,
  selectedVoiceOption,
}: {
  internalSelectedVoiceId: null | string
  selectedVoiceOption?: VoiceOption
}): null | undefined | VoiceOption => {
  if (selectedVoiceOption) {
    return selectedVoiceOption
  }
  if (internalSelectedVoiceId === null) {
    return null
  }
  return undefined
}

const persistLastAccessedVoice = (voice: VoiceOption): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('lastAccessedVoiceId', voice.value)
  }
}

const applyVoiceSelection = ({
  onOpenChange,
  onVoiceConfirm,
  onVoiceSelect,
  voice,
}: {
  onOpenChange: (open: boolean) => void
  onVoiceConfirm?: (voice: null | VoiceOption) => void
  onVoiceSelect: (voice: null | VoiceOption) => void
  voice: null | VoiceOption
}) => {
  onVoiceSelect(voice)
  onVoiceConfirm?.(voice)
  onOpenChange(false)
}

export function VoiceSelectionDialog({
  dialogClassNames,
  mode = 'default',
  onOpenChange,
  onVoiceConfirm,
  onVoiceDeleted,
  onVoiceSelect,
  open,
  selectedVoice,
}: VoiceSelectionDialogProps) {
  const model = useVoiceSelectionDialogModel({
    mode,
    onOpenChange,
    onVoiceConfirm,
    onVoiceSelect,
    open,
    selectedVoice,
  })

  return (
    <>
      <VoiceSelectionAuxDialogs
        isCreateDialogOpen={model.isCreateDialogOpen}
        onCreateDialogBack={() => {
          model.setIsCreateDialogOpen(false)
          onOpenChange(true)
        }}
        onCreateDialogClose={() => {
          model.setIsCreateDialogOpen(false)
        }}
        onVoiceCreated={model.handleVoiceCreated}
        pause={model.pause}
        playingId={model.playingId}
        toggle={model.toggle}
      />

      <VoiceSelectionMainDialog
        confirmDisabled={model.confirmDisabled}
        confirmLabel={model.confirmLabel}
        description={model.description}
        dialogClassNames={dialogClassNames}
        initialActiveTab={model.initialActiveTab}
        isAvatarCreationMode={model.isAvatarCreationMode}
        onChange={model.handleVoiceSelect}
        onClose={() => onOpenChange(false)}
        onCreateVoice={model.handleCreateVoiceClick}
        onOpenChange={onOpenChange}
        onUseVoice={model.handleUseVoice}
        onVoiceDeleted={onVoiceDeleted}
        onVoiceRenamed={model.refetch}
        open={open}
        title={model.title}
        value={model.internalSelectedVoiceId}
      />
    </>
  )
}

function useVoiceSelectionDialogModel({
  mode,
  onOpenChange,
  onVoiceConfirm,
  onVoiceSelect,
  open,
  selectedVoice,
}: Omit<
  VoiceSelectionDialogProps,
  'dialogClassNames' | 'onVoiceDeleted'
>): VoiceSelectionDialogModel {
  const isAvatarCreationMode = mode === 'avatar-creation'
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [internalSelectedVoiceId, setInternalSelectedVoiceId] = useState<null | string>(
    isAvatarCreationMode ? null : selectedVoice,
  )

  const { options: presetOptions } = usePresetVoiceOptions()
  const { userVoices: userOptions, refetch } = useUserVoiceClones()
  const { playingId, toggle, pause } = useAudio()

  const allVoices = [...userOptions, ...presetOptions]
  const selectedVoiceOption = allVoices.find((voice) => voice.value === internalSelectedVoiceId)
  const { confirmLabel, description, title } = getDialogMeta(isAvatarCreationMode)
  const initialActiveTab = isAvatarCreationMode ? 'my-voices' : undefined
  const confirmDisabled = Boolean(
    !internalSelectedVoiceId || selectedVoiceOption?.visible === false,
  )

  useEffect(() => {
    if (open) {
      setInternalSelectedVoiceId(isAvatarCreationMode ? null : selectedVoice)
    }
  }, [isAvatarCreationMode, open, selectedVoice])

  const handleVoiceSelect = (voice: null | VoiceOption, isForced?: boolean) => {
    setInternalSelectedVoiceId(voice?.value ?? null)
    if (isForced) {
      onVoiceSelect(voice)
    }
  }

  const handleVoiceCreated = (voice: VoiceOption) => {
    refetch()
    onVoiceSelect(voice)
    setInternalSelectedVoiceId(voice.value)
    setIsCreateDialogOpen(false)
    if (!isAvatarCreationMode) {
      onVoiceConfirm?.(voice)
      onOpenChange(false)
    }
  }

  const handleUseVoice = () => {
    const voiceToApply = resolveVoiceToApply({ internalSelectedVoiceId, selectedVoiceOption })
    if (voiceToApply === undefined) {
      return
    }
    if (voiceToApply) {
      persistLastAccessedVoice(voiceToApply)
    }
    applyVoiceSelection({ onOpenChange, onVoiceConfirm, onVoiceSelect, voice: voiceToApply })
  }

  const handleCreateVoiceClick = () => {
    setIsCreateDialogOpen(true)
    if (!isAvatarCreationMode) {
      onOpenChange(false)
    }
  }

  return {
    confirmDisabled,
    confirmLabel,
    description,
    handleCreateVoiceClick,
    handleUseVoice,
    handleVoiceCreated,
    handleVoiceSelect,
    initialActiveTab,
    internalSelectedVoiceId,
    isAvatarCreationMode,
    isCreateDialogOpen,
    pause,
    playingId,
    refetch,
    setIsCreateDialogOpen,
    title,
    toggle,
  }
}

function VoiceSelectionAuxDialogs({
  isCreateDialogOpen,
  onCreateDialogBack,
  onCreateDialogClose,
  onVoiceCreated,
  pause,
  playingId,
  toggle,
}: VoiceSelectionAuxDialogsProps) {
  return (
    <VoiceCreateDialog
      onBack={onCreateDialogBack}
      onClose={onCreateDialogClose}
      onVoiceCreated={onVoiceCreated}
      open={isCreateDialogOpen}
      pause={pause}
      playingId={playingId}
      toggle={toggle}
    />
  )
}

function VoiceSelectionMainDialog({
  confirmDisabled,
  confirmLabel,
  description,
  dialogClassNames,
  initialActiveTab,
  isAvatarCreationMode,
  onChange,
  onClose,
  onCreateVoice,
  onOpenChange,
  onUseVoice,
  onVoiceDeleted,
  onVoiceRenamed,
  open,
  title,
  value,
}: VoiceSelectionMainDialogProps) {
  return (
    <Dialog
      classNames={{
        content: cn(
          'bg-[rgba(68,68,68,0.5)] backdrop-blur-2xl text-white border-0 w-[90%] max-w-[560px] flex flex-col gap-y-1 rounded-xl p-6 z-[64] h-[min(560px,calc(100dvh-64px))]',
          dialogClassNames?.content,
        ),
        description: 'text-secondary',
        header: 'mb-3',
        overlay: cn('z-[63]', dialogClassNames?.overlay),
      }}
      description={description}
      footer={
        <div className="flex justify-end gap-x-2 pt-0">
          <Button
            className="bg-primary hover:bg-primary-hover h-[38px] rounded-sm px-[12px] text-black"
            disabled={confirmDisabled}
            onClick={onUseVoice}
          >
            {confirmLabel}
          </Button>
        </div>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <VoiceClone
            enableAutomaticSelection={!isAvatarCreationMode}
            initialActiveTab={initialActiveTab}
            onChange={onChange}
            onClose={onClose}
            onCreateVoice={onCreateVoice}
            onVoiceDeleted={onVoiceDeleted}
            onVoiceRenamed={onVoiceRenamed}
            showAutoSelectOption={false}
            value={value}
            voiceListContext="main-dialog"
          />
        </div>
      </div>
    </Dialog>
  )
}
