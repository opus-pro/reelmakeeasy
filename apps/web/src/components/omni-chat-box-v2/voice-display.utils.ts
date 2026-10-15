import {
  convertVoiceOptionToApiFormat,
  type VoiceOption,
} from '@/components/voice/components/voice-over-selection'

export function resolveDisplayVoiceOption({
  defaultVoiceId,
  selectedVoice,
  voiceOptions,
}: {
  defaultVoiceId?: string
  selectedVoice: null | VoiceOption
  voiceOptions: VoiceOption[]
}): null | VoiceOption {
  if (!selectedVoice) {
    return null
  }
  if (selectedVoice.value !== 'auto-select') {
    return selectedVoice
  }
  const resolvedVoiceId = convertVoiceOptionToApiFormat(selectedVoice, defaultVoiceId).voiceId
  return voiceOptions.find((voiceOption) => voiceOption.value === resolvedVoiceId) || selectedVoice
}
