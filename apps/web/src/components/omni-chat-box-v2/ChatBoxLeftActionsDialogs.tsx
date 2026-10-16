'use client'

import React from 'react'

import { VoiceOption } from '@/components/voice/components/voice-over-selection'

import { VoiceSelectionDialog } from '../voice'

import type { ReferenceUploadButtonValue } from './ReferenceUploadButton'
import { StyleStudioDialogs } from './StyleStudioDialogs'

export type ChatBoxLeftActionsDialogsProps = {
  disabled?: boolean
  displaySelectedVoice: null | undefined | VoiceOption
  handleVoiceBrowse: (voice: null | VoiceOption) => void
  handleVoiceConfirm: (voice: null | VoiceOption) => void
  isLongTakeStyleApplyEnabled?: boolean
  isLongTakeStyleApplySaving?: boolean
  isLongTakeStyleDialogOpen: boolean
  isLongTakeStyleGeneratePreviewEnabled?: boolean
  isLongTakeStylePreviewGenerating?: boolean
  isLongTakeStyleWritingWithAi?: boolean
  isVoiceDialogOpen: boolean
  longTakeStyleCustom: string
  longTakeStyleImageError?: null | string
  longTakeStyleImageValue?: null | ReferenceUploadButtonValue
  longTakeStyleInputMode?: 'image' | 'none' | 'preset' | 'text'
  longTakeStyleName: string
  longTakeStylePreviewImageUrl?: null | string
  onLongTakeStyleApply?: () => void
  onLongTakeStyleCustomChange: (value: string) => void
  onLongTakeStyleGeneratePreview?: () => void
  onLongTakeStyleImageClear?: () => void
  onLongTakeStyleImageSelect?: (file: File) => void
  onLongTakeStyleNameChange: (value: string) => void
  onLongTakeStyleTextClear?: () => void
  onLongTakeStyleWriteWithAi?: () => void
  setIsLongTakeStyleDialogOpen: (open: boolean) => void
  setIsVoiceDialogOpen: (open: boolean) => void
}

export const ChatBoxLeftActionsDialogs: React.FC<ChatBoxLeftActionsDialogsProps> = ({
  displaySelectedVoice,
  handleVoiceBrowse,
  handleVoiceConfirm,
  isLongTakeStyleDialogOpen,
  isVoiceDialogOpen,
  longTakeStyleCustom,
  longTakeStyleImageError,
  longTakeStyleImageValue,
  longTakeStyleInputMode = 'preset',
  longTakeStyleName,
  longTakeStylePreviewImageUrl = null,
  disabled = false,
  isLongTakeStyleApplyEnabled = false,
  isLongTakeStyleApplySaving = false,
  isLongTakeStyleGeneratePreviewEnabled = false,
  isLongTakeStyleWritingWithAi = false,
  isLongTakeStylePreviewGenerating = false,
  onLongTakeStyleApply,
  onLongTakeStyleCustomChange,
  onLongTakeStyleGeneratePreview,
  onLongTakeStyleWriteWithAi,
  onLongTakeStyleImageClear,
  onLongTakeStyleImageSelect,
  onLongTakeStyleNameChange,
  onLongTakeStyleTextClear,
  setIsLongTakeStyleDialogOpen,
  setIsVoiceDialogOpen,
}) => {
  return (
    <>
      <StyleStudioDialogs
        disabled={disabled}
        isLongTakeStyleApplyEnabled={isLongTakeStyleApplyEnabled}
        isLongTakeStyleApplySaving={isLongTakeStyleApplySaving}
        isLongTakeStyleDialogOpen={isLongTakeStyleDialogOpen}
        isLongTakeStyleGeneratePreviewEnabled={isLongTakeStyleGeneratePreviewEnabled}
        isLongTakeStylePreviewGenerating={isLongTakeStylePreviewGenerating}
        isLongTakeStyleWritingWithAi={isLongTakeStyleWritingWithAi}
        longTakeStyleCustom={longTakeStyleCustom}
        longTakeStyleImageError={longTakeStyleImageError}
        longTakeStyleImageValue={longTakeStyleImageValue}
        longTakeStyleInputMode={longTakeStyleInputMode}
        longTakeStyleName={longTakeStyleName}
        longTakeStylePreviewImageUrl={longTakeStylePreviewImageUrl}
        onLongTakeStyleApply={onLongTakeStyleApply}
        onLongTakeStyleCustomChange={onLongTakeStyleCustomChange}
        onLongTakeStyleGeneratePreview={onLongTakeStyleGeneratePreview}
        onLongTakeStyleImageClear={onLongTakeStyleImageClear}
        onLongTakeStyleImageSelect={onLongTakeStyleImageSelect}
        onLongTakeStyleNameChange={onLongTakeStyleNameChange}
        onLongTakeStyleTextClear={onLongTakeStyleTextClear}
        onLongTakeStyleWriteWithAi={onLongTakeStyleWriteWithAi}
        setIsLongTakeStyleDialogOpen={setIsLongTakeStyleDialogOpen}
      />

      <VoiceSelectionDialog
        onOpenChange={setIsVoiceDialogOpen}
        onVoiceConfirm={handleVoiceConfirm}
        onVoiceSelect={handleVoiceBrowse}
        open={isVoiceDialogOpen}
        // Pass the resolved voice id so the dialog preselects an item that
        // exists in its allVoices. Drop the 'auto-select' sentinel.
        selectedVoice={
          displaySelectedVoice && displaySelectedVoice.value !== 'auto-select'
            ? displaySelectedVoice.value
            : null
        }
      />
    </>
  )
}
