export const STORY_MODE_AUDIO_TRANSCRIPT_PENDING_TOOLTIP = 'Generating transcript from audio...'
export const STORY_MODE_AUDIO_TRANSCRIPT_ERROR_TOOLTIP =
  'Audio has no transcript. Upload another file or remove this one.'
export const STORY_MODE_AUDIO_UPLOAD_PENDING_TOOLTIP = 'Uploading audio...'
export const STORY_MODE_AUDIO_UPLOAD_ERROR_TOOLTIP =
  'Audio upload failed. Upload another file or remove this one.'

export const getStoryModeAudioSubmitTooltip = ({
  audioTranscriptErrorMessage,
  hasAudioAttachment,
  isAudioTranscriptError,
  isAudioTranscriptPending,
  isAudioTranscriptReady,
  isAudioUploadError,
  isAudioUploading,
}: {
  audioTranscriptErrorMessage?: string
  hasAudioAttachment: boolean
  isAudioTranscriptError: boolean
  isAudioTranscriptPending: boolean
  isAudioTranscriptReady: boolean
  isAudioUploadError: boolean
  isAudioUploading: boolean
}): string | undefined => {
  if (!hasAudioAttachment) {
    return undefined
  }
  if (isAudioUploadError) {
    return STORY_MODE_AUDIO_UPLOAD_ERROR_TOOLTIP
  }
  if (isAudioUploading) {
    return STORY_MODE_AUDIO_UPLOAD_PENDING_TOOLTIP
  }
  if (isAudioTranscriptReady) {
    return undefined
  }
  if (isAudioTranscriptError) {
    return audioTranscriptErrorMessage || STORY_MODE_AUDIO_TRANSCRIPT_ERROR_TOOLTIP
  }
  // Nothing has started yet (e.g. a guest attachment awaiting login): upload is
  // the next step, so claiming a transcript is running would be a lie.
  return isAudioTranscriptPending
    ? STORY_MODE_AUDIO_TRANSCRIPT_PENDING_TOOLTIP
    : STORY_MODE_AUDIO_UPLOAD_PENDING_TOOLTIP
}
