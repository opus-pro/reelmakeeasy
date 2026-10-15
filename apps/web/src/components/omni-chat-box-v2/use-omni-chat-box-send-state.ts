import type { Attachment } from '@shared/types/assets/attachment'
import { useMemo } from 'react'

import { getSubmitDisabledReason } from './submit-disabled-reason'
import { isStoreUri } from '@reelmakeeasy/common/storage/address'

export function useSendState({
  activeStoryModeAudioAttachment,
  activeStoryModeAudioId,
  attachments,
  disabled,
  hasFailedImageAttachment,
  imageUploadingCount,
  isEnhancing,
  isLongTakeStyleImageProcessing,
  isPromptValid,
  isSending,
  longTakeCustomStyle,
  longTakeEnabled,
  longTakeStyleInputMode,
  storyModeAudioTranscriptError,
  storyModeAudioTranscriptStatus,
  storyModeAudioTranscriptText,
  storyModeAudioUploadId,
  storyModeAudioUploadStatus,
}: {
  activeStoryModeAudioAttachment: Attachment | null | undefined
  activeStoryModeAudioId: string | undefined
  attachments: Attachment[]
  disabled: boolean
  hasFailedImageAttachment: boolean
  imageUploadingCount: number
  isEnhancing: boolean
  isLongTakeStyleImageProcessing: boolean
  isPromptValid: boolean
  isSending: boolean
  longTakeCustomStyle: string
  longTakeEnabled: boolean
  longTakeStyleInputMode: string
  storyModeAudioTranscriptError: string
  storyModeAudioTranscriptStatus: string
  storyModeAudioTranscriptText: string
  storyModeAudioUploadId: string | undefined
  storyModeAudioUploadStatus: string
}) {
  return useMemo(() => {
    const lacksUsableInput = !isPromptValid && attachments.length === 0
    const baseDisabledValue = disabled || lacksUsableInput || isSending || isEnhancing
    const isStyleImageInputMode = longTakeStyleInputMode === 'image'
    const isStyleImageUploading = isStyleImageInputMode && isLongTakeStyleImageProcessing
    const isStyleImageMissing =
      isStyleImageInputMode &&
      !isLongTakeStyleImageProcessing &&
      longTakeCustomStyle.trim().length === 0
    const isStyleImagePendingValue = isStyleImageUploading || isStyleImageMissing
    const isStoryModeAudioReadyValue =
      !activeStoryModeAudioAttachment || Boolean(isStoreUri(activeStoryModeAudioAttachment.url))
    const isStoryModeAudioUploadingValue =
      Boolean(activeStoryModeAudioId) &&
      storyModeAudioUploadStatus === 'pending' &&
      storyModeAudioUploadId === activeStoryModeAudioId
    const isStoryModeAudioUploadErrorValue =
      Boolean(activeStoryModeAudioId) &&
      storyModeAudioUploadStatus === 'error' &&
      storyModeAudioUploadId === activeStoryModeAudioId
    const requiresStoryModeAudioTranscript =
      longTakeEnabled && Boolean(activeStoryModeAudioAttachment)
    const hasStoryModeAudioTranscript =
      storyModeAudioTranscriptStatus === 'ready' && storyModeAudioTranscriptText.trim().length > 0
    const isStoryModeAudioTranscriptReadyValue =
      !requiresStoryModeAudioTranscript || hasStoryModeAudioTranscript
    const isStoryModeAudioTranscriptErrorValue =
      requiresStoryModeAudioTranscript && storyModeAudioTranscriptStatus === 'error'
    // Gate submit in both modes so we never send before image store addresses resolve.
    const isStoryModeImageUploading = longTakeEnabled && imageUploadingCount > 0
    // Terminal counterpart of the uploading gate: a failed upload keeps its
    // mention in the composer while its store path entry is gone, so sending
    // would ship a reference with no bytes behind it.
    const isStoryModeImageUploadErrorValue = longTakeEnabled && hasFailedImageAttachment
    const disableSendValue =
      baseDisabledValue ||
      isStyleImagePendingValue ||
      isStoryModeImageUploading ||
      isStoryModeImageUploadErrorValue ||
      (requiresStoryModeAudioTranscript && !hasStoryModeAudioTranscript)
    const submitDisabledReason = getSubmitDisabledReason({
      audioTranscriptErrorMessage: storyModeAudioTranscriptError,
      hasAudioAttachment: requiresStoryModeAudioTranscript,
      isAudioTranscriptError: isStoryModeAudioTranscriptErrorValue,
      isAudioTranscriptPending:
        requiresStoryModeAudioTranscript && storyModeAudioTranscriptStatus === 'pending',
      isAudioTranscriptReady: isStoryModeAudioTranscriptReadyValue,
      isAudioUploadError: isStoryModeAudioUploadErrorValue,
      isAudioUploading: isStoryModeAudioUploadingValue,
      isEnhancing,
      isImageUploadError: isStoryModeImageUploadErrorValue,
      isImageUploading: isStoryModeImageUploading,
      isStyleImageMissing,
      isStyleImageUploading,
      lacksUsableInput,
    })
    return {
      disableSend: disableSendValue,
      isStoryModeImageUploading,
      isStoryModeImageUploadError: isStoryModeImageUploadErrorValue,
      isStoryModeAudioReady: isStoryModeAudioReadyValue,
      isStoryModeAudioTranscriptReady: isStoryModeAudioTranscriptReadyValue,
      isStoryModeAudioTranscriptError: isStoryModeAudioTranscriptErrorValue,
      isStoryModeAudioUploadError: isStoryModeAudioUploadErrorValue,
      isStoryModeAudioUploading: isStoryModeAudioUploadingValue,
      submitDisabledReason,
      // Desktop reads the message straight into its tooltip.
      submitDisabledTooltipContent: submitDisabledReason?.message,
    }
  }, [
    activeStoryModeAudioAttachment,
    activeStoryModeAudioId,
    attachments.length,
    disabled,
    hasFailedImageAttachment,
    isEnhancing,
    isLongTakeStyleImageProcessing,
    isPromptValid,
    isSending,
    longTakeCustomStyle,
    longTakeEnabled,
    longTakeStyleInputMode,
    storyModeAudioTranscriptError,
    storyModeAudioTranscriptStatus,
    storyModeAudioTranscriptText,
    storyModeAudioUploadId,
    storyModeAudioUploadStatus,
    imageUploadingCount,
  ])
}
