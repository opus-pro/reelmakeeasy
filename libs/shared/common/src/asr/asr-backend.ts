import { assertGenerationReady, currentGenerationProvider } from '@reelmakeeasy/llm/registry'

import { hasElevenLabsKey } from '../elevenlabs/key'
import { localSttSupports } from '../tts/local-tts'

/** Where speech to text and forced alignment run: this computer, or a cloud backend. */
export type AsrBackend = 'local' | CloudAsrBackend

export type CloudAsrBackend = 'elevenlabs' | 'fal' | 'google'

export interface ResolveAsrBackendOptions {
  /**
   * Where LOCAL_ASR and ELEVENLABS_API_KEY are read. The local server's address
   * (LOCAL_TTS_URL, with its cached status) and the generation provider always come
   * from process.env.
   */
  env?: NodeJS.ProcessEnv
  /**
   * The transcript feeds the voice-quality checks, which read speaker labels and audio
   * events that only ElevenLabs Scribe gives: it stays on Scribe when ELEVENLABS_API_KEY is set.
   */
  forQualityChecks?: boolean
}

/**
 * The cloud backend: ElevenLabs directly with its own key; otherwise Gemini Transcribe when
 * Gemini makes the voices (google), else ElevenLabs Scribe on fal. Without an ElevenLabs key it
 * needs a generation provider that can run, and fails with the Setup reason otherwise (never
 * swapping providers).
 */
export function asrBackend(env: NodeJS.ProcessEnv = process.env): CloudAsrBackend {
  if (hasElevenLabsKey(env)) return 'elevenlabs'
  assertGenerationReady()
  return currentGenerationProvider() === 'google' ? 'google' : 'fal'
}

/** Local speech to text is on unless LOCAL_ASR=off. */
export const localAsrEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env['LOCAL_ASR']?.trim() !== 'off'

/**
 * This computer first, free and private: Whisper and the aligner on the local server, when it
 * runs Whisper and LOCAL_ASR isn't off. Running locally needs no generation provider, so it
 * works when Setup isn't done. The quality-check transcript stays on ElevenLabs Scribe with
 * the user's key. Otherwise the cloud backend (`asrBackend`).
 */
export async function resolveAsrBackend(
  options: ResolveAsrBackendOptions = {},
): Promise<AsrBackend> {
  const env = options.env ?? process.env
  const keepScribe = options.forQualityChecks === true && hasElevenLabsKey(env)
  if (!keepScribe && localAsrEnabled(env) && (await localSttSupports('transcribe'))) {
    return 'local'
  }
  return asrBackend(env)
}
