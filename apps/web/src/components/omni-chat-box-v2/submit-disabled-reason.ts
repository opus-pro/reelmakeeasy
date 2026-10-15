import { getStoryModeAudioSubmitTooltip } from './story-mode-audio-submit-tooltip'

export const STYLE_IMAGE_PENDING_MESSAGE = 'Uploading style image...'
export const STYLE_IMAGE_MISSING_MESSAGE = 'Please select a style to continue'
export const IMAGE_UPLOADING_MESSAGE = 'Uploading to the cloud...'
export const IMAGE_UPLOAD_FAILED_MESSAGE = 'Image upload failed. Remove the image or re-attach it.'
export const PROMPT_ENHANCING_MESSAGE = 'Enhancing your prompt...'
export const PROMPT_OR_ATTACHMENT_REQUIRED_MESSAGE =
  'Please enter your prompt or upload an audio file'

export type SubmitDisabledReason = {
  key: SubmitDisabledReasonKey
  message: string
}

/**
 * Machine-readable counterpart to the message, so a blocked submit can be
 * attributed to a specific gate in telemetry.
 */
export type SubmitDisabledReasonKey =
  | 'audio'
  | 'image_upload_error'
  | 'image_uploading'
  | 'lacks_usable_input'
  | 'prompt_enhancing'
  | 'style_image_missing'
  | 'style_image_uploading'

/**
 * Resolves why submit is gated, for every gate a user can tap through to.
 * `disabled` and `isSending` are deliberately absent: both render the control
 * disabled or pending, so the user already sees the state.
 *
 * Order is precedence, not evaluation cost: terminal audio failures first (they
 * need the user to act), then missing input, then transient work that clears on
 * its own.
 */
export const getSubmitDisabledReason = ({
  audioTranscriptErrorMessage,
  hasAudioAttachment,
  isAudioTranscriptError,
  isAudioTranscriptPending,
  isAudioTranscriptReady,
  isAudioUploadError,
  isAudioUploading,
  isEnhancing,
  isImageUploadError,
  isImageUploading,
  isStyleImageMissing,
  isStyleImageUploading,
  lacksUsableInput,
}: {
  audioTranscriptErrorMessage?: string
  hasAudioAttachment: boolean
  isAudioTranscriptError: boolean
  isAudioTranscriptPending: boolean
  isAudioTranscriptReady: boolean
  isAudioUploadError: boolean
  isAudioUploading: boolean
  isEnhancing: boolean
  isImageUploadError: boolean
  isImageUploading: boolean
  isStyleImageMissing: boolean
  isStyleImageUploading: boolean
  lacksUsableInput: boolean
}): SubmitDisabledReason | undefined => {
  const audioMessage = getStoryModeAudioSubmitTooltip({
    audioTranscriptErrorMessage,
    hasAudioAttachment,
    isAudioTranscriptError,
    isAudioTranscriptPending,
    isAudioTranscriptReady,
    isAudioUploadError,
    isAudioUploading,
  })
  if (audioMessage && (isAudioUploadError || isAudioTranscriptError)) {
    return { key: 'audio', message: audioMessage }
  }
  // Terminal like the audio failures above: it only clears when the user
  // removes or re-attaches the image, so it outranks the transient gates.
  if (isImageUploadError) {
    return { key: 'image_upload_error', message: IMAGE_UPLOAD_FAILED_MESSAGE }
  }
  if (lacksUsableInput) {
    return {
      key: 'lacks_usable_input',
      message: PROMPT_OR_ATTACHMENT_REQUIRED_MESSAGE,
    }
  }
  if (audioMessage) {
    return { key: 'audio', message: audioMessage }
  }
  if (isStyleImageMissing) {
    return { key: 'style_image_missing', message: STYLE_IMAGE_MISSING_MESSAGE }
  }
  if (isImageUploading) {
    return { key: 'image_uploading', message: IMAGE_UPLOADING_MESSAGE }
  }
  if (isStyleImageUploading) {
    return { key: 'style_image_uploading', message: STYLE_IMAGE_PENDING_MESSAGE }
  }
  if (isEnhancing) {
    return { key: 'prompt_enhancing', message: PROMPT_ENHANCING_MESSAGE }
  }
  return undefined
}
