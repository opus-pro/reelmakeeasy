import { readFile } from 'node:fs/promises'

import { DEFAULT_ASR_MODEL_ID, speechToText } from '@reelmakeeasy/common/asr/elevenlabs'
import { logger } from '@reelmakeeasy/common/logger'
import {
  classifyLanguageCode,
  DEFAULT_LANGUAGE_CONFIG,
  type VoiceLanguageDetection,
} from '@reelmakeeasy/common/tts/language-config'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

// The language tables + pure resolvers moved to @reelmakeeasy/common/tts/language-config
// so both this api path (voice-clone preview) and the story-mode render path (libs/agent)
// share one authoritative mapping. Re-exported here so existing importers are unchanged.
export * from '@reelmakeeasy/common/tts/language-config'

/**
 * Detects the spoken language in an audio file via ElevenLabs ASR and classifies it
 * against MiniMax's voice-clone support. ASR failures fall back to 'undetected' (English)
 * rather than throwing, so callers decide whether to block the clone.
 */
export async function detectVoiceLanguageConfig(
  audioFilePath: string,
): Promise<VoiceLanguageDetection> {
  try {
    const audioBuffer = await readFile(audioFilePath)
    const asrResult = await speechToText({
      file: new Blob([new Uint8Array(audioBuffer)]),
      modelId: DEFAULT_ASR_MODEL_ID,
    })
    const detection = classifyLanguageCode(asrResult.languageCode)
    logger.info(
      {
        kind: detection.kind,
        langCode: 'langCode' in detection ? detection.langCode : 'undefined',
      },
      '[VoiceClone] Voice clone language detection',
    )
    return detection
  } catch (error) {
    logger.warn(
      { error: ensureError(error) },
      '[VoiceClone] Language detection failed, defaulting to English',
    )
    return { config: DEFAULT_LANGUAGE_CONFIG, kind: 'undetected' }
  }
}
