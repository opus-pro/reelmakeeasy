/**
 * The voice used when none is chosen, by generation provider: ElevenLabs Sarah
 * on fal, a Gemini TTS voice on google. Node only (it reads the registry
 * state); the web reads the `default` flag that GET /api/voice-over sets.
 *
 * A loop short says every line before it asks to be made (to check each fits
 * its clip), so its default is a free voice on this computer when one is
 * installed: never a paid voice in its place.
 */
import { currentGenerationProvider } from '@reelmakeeasy/llm/registry'

import { GEMINI_DEFAULT_VOICE_ID } from './gemini-voices'
import { localTtsHealth } from './local-tts'
import { DEFAULT_VOICE_ID } from './preset-voices'

/** A loop short's voice when Kokoro runs on this computer: Kokoro Heart (warm narration). */
export const KOKORO_LOOP_VOICE_ID = 'kokoro-af_heart'
/** A loop short's voice when only Qwen3 runs here: Qwen Ryan (an English speaker). */
export const QWEN3_LOOP_VOICE_ID = 'qwen3-ryan'

export interface DefaultVoice {
  provider: 'elevenlabs' | 'gemini'
  voiceId: string
}

export function defaultVoice(): DefaultVoice {
  return currentGenerationProvider() === 'google'
    ? { provider: 'gemini', voiceId: GEMINI_DEFAULT_VOICE_ID }
    : { provider: 'elevenlabs', voiceId: DEFAULT_VOICE_ID }
}

export const defaultVoiceId = (): string => defaultVoice().voiceId

/**
 * A loop short's voice when none is named: Kokoro Heart when Kokoro runs on this
 * computer, else Qwen Ryan when Qwen3 does (both free), else the default voice.
 */
export async function defaultLoopVoiceId(): Promise<string> {
  const engines = (await localTtsHealth())?.engines
  if (engines?.kokoro) return KOKORO_LOOP_VOICE_ID
  if (engines?.qwen3) return QWEN3_LOOP_VOICE_ID
  return defaultVoiceId()
}
