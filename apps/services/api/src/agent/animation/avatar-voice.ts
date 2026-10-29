import {
  generateTTSAudio,
  isUserVoiceCloneVoiceId,
  resolveQwen3Speaker,
  resolveTtsModel,
  resolveVoiceRoute,
} from '@agent-lib/agents/story-loader/voice-tools/utils/provider-tts.util'
import { kokoroTextToSpeech, qwen3TextToSpeech } from '@reelmakeeasy/common/tts/fal-tts'
import { PRESET_VOICES } from '@reelmakeeasy/common/tts/preset-voices'

/**
 * An avatar's fixed voice: a voice library id (a preset, or one of the user's own voices) that
 * speaks every line of every video with it, so the avatar always sounds the same (the voices
 * Claude picks from are in `avatar-voice-list`).
 */

/** Where a fixed voice speaks: Kokoro or Qwen3 (on this computer, else fal), or a paid service
 *  (ElevenLabs, Gemini, MiniMax on fal). */
export type FixedVoiceEngine = 'cloud' | 'kokoro' | 'qwen3'

/** Whether a voice library id names a voice: a preset, or one of the user's own voices. */
export async function isKnownVoice(voiceId: string): Promise<boolean> {
  if (PRESET_VOICES.some((v) => v.id === voiceId)) return true
  return isUserVoiceCloneVoiceId(voiceId)
}

/** Where a fixed voice speaks (the voice it falls back to, when it can't speak here). */
export async function fixedVoiceEngine(voiceId: string): Promise<FixedVoiceEngine> {
  const { provider } = await resolveVoiceRoute(voiceId)
  return provider === 'kokoro' || provider === 'qwen3' ? provider : 'cloud'
}

/** Speaks `text` in a fixed voice. */
export async function fixedVoiceSpeech(
  voiceId: string,
  text: string,
): Promise<{ audioBuffer: Buffer; ranOn: 'fal' | 'local' }> {
  const route = await resolveVoiceRoute(voiceId)
  if (route.provider === 'kokoro') return kokoroTextToSpeech({ text, voiceId: route.voiceId })
  if (route.provider === 'qwen3')
    return qwen3TextToSpeech({
      languageCode: 'en',
      speaker: await resolveQwen3Speaker(route.voiceId),
      text,
    })
  const { audioBuffer } = await generateTTSAudio(
    text,
    route.voiceId,
    resolveTtsModel(route.provider),
    route.provider,
    undefined,
    { languageCode: 'en' },
  )
  return { audioBuffer, ranOn: 'fal' }
}
