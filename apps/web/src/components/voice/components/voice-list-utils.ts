import { type VoiceOption } from './voice-over-selection'

/** Move the selected voice to the top of the list, preserving relative order of the rest. */
export function pinVoiceToTop(
  voices: VoiceOption[],
  selectedVoiceId: null | string,
): VoiceOption[] {
  if (!selectedVoiceId) {
    return voices
  }
  const selectedVoice = voices.find((voice) => voice.value === selectedVoiceId)
  if (!selectedVoice) {
    return voices
  }
  return [selectedVoice, ...voices.filter((voice) => voice.value !== selectedVoiceId)]
}
