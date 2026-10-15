import { defaultVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import { PRESET_VOICES } from '@reelmakeeasy/common/tts/preset-voices'
import { type VoiceOverOption } from '@shared/types/api/voice-over'
import { buildPresetVoiceProfile } from '@shared/types/api/voice-profile'

const presetPreviewDataBase: VoiceOverOption[] = PRESET_VOICES.map((voice) => ({
  ...voice,
  needsPresignedUrl: true,
  previewAudioUrl: '',
  provider: voice.provider ?? 'elevenlabs',
  voiceId: voice.id,
}))

export const presetPreviewData: VoiceOverOption[] = presetPreviewDataBase.map((voice) => ({
  ...voice,
  voiceProfile: buildPresetVoiceProfile(voice.labels),
}))

/** The voice new projects get when none is chosen: the generation provider's default (Gemini on google). */
export function defaultVoiceOption(): VoiceOverOption {
  const id = defaultVoiceId()
  const base = presetPreviewData.find((voice) => voice.id === id) ?? presetPreviewData[0]
  return { ...(base as VoiceOverOption), default: true }
}
