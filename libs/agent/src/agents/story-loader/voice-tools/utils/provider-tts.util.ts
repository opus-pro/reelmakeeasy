import { readFile, rm } from 'node:fs/promises'
import os from 'node:os'

import { elevenLabsTtsModelId } from '@reelmakeeasy/common/asr/elevenlabs'
import { hasElevenLabsKey, NEEDS_ELEVENLABS_KEY } from '@reelmakeeasy/common/elevenlabs/key'
import { logger } from '@reelmakeeasy/common/logger'
import { defaultVoice } from '@reelmakeeasy/common/tts/default-voice'
import { stripDeliveryMarkup } from '@reelmakeeasy/common/tts/delivery-markup'
import {
  elevenLabsFalModelName,
  generateElevenLabsViaFal,
} from '@reelmakeeasy/common/tts/elevenlabs-fal'
import {
  falMinimaxModelName,
  falMinimaxTtsEndpoint,
  textToSpeech as falMinimaxTextToSpeech,
} from '@reelmakeeasy/common/tts/fal-minimax'
import {
  falTtsModelName,
  falTtsProviderForVoiceId,
  kokoroTextToSpeech,
  qwen3PresetSpeaker,
  type Qwen3Speaker,
  qwen3TextToSpeech,
} from '@reelmakeeasy/common/tts/fal-tts'
import { geminiTextToSpeech, geminiTtsModelName } from '@reelmakeeasy/common/tts/gemini-tts'
import { geminiPresetIdForLegacyName, isGeminiVoiceId } from '@reelmakeeasy/common/tts/gemini-voices'
import { resolveLanguageBoostFromScriptLanguage } from '@reelmakeeasy/common/tts/language-config'
import {
  isBytePlusReferenceVoiceId,
  isGeminiPresetVoiceId,
  isRetiredVoiceId,
} from '@reelmakeeasy/common/tts/legacy-voices'
import { localTtsSupports } from '@reelmakeeasy/common/tts/local-tts'
import { falElevenLabsVoice } from '@reelmakeeasy/common/tts/preset-voices'
import { qwen3VoiceReference } from '@reelmakeeasy/common/tts/qwen3-voice'
import { hasGeminiKey, NEEDS_GEMINI_KEY } from '@reelmakeeasy/common/tts/voice-engines'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { sanitizeForTts } from '@reelmakeeasy/common/utils/tts-sanitize'
import { currentGenerationProvider } from '@reelmakeeasy/llm/registry'
import { getUserVoiceCloneDataService } from '@shared/db-access-layer'

import { generateTTSAudio as elevenLabsGenerateTTS } from './elevenlabs-audio-pipeline.util'

export { isGeminiPresetVoiceId } from '@reelmakeeasy/common/tts/legacy-voices'

/**
 * Where speech is synthesized:
 * - `elevenlabs`: ElevenLabs presets and clones.
 * - `fal`: MiniMax on fal, only for voice clones minted there.
 * - `gemini`: Gemini TTS prebuilt voices (`gemini-*`), with GEMINI_API_KEY, whoever makes
 *   the pictures and clips (fal or Gemini).
 * - `kokoro`: Kokoro English presets (`kokoro-*`), on the local voice server when
 *   it runs, else on fal.
 * - `qwen3`: Qwen3-TTS, likewise local or fal, for its presets (`qwen3-*`) and
 *   the voices users clone or design with it.
 * Retired voices render as the default preset voice (see `resolveVoiceRoute`).
 */
export type TtsProvider = 'elevenlabs' | 'fal' | 'gemini' | 'kokoro' | 'qwen3'

/** Where a voice id is synthesized, after legacy voices are mapped to a usable one. */
export interface VoiceRoute {
  provider: TtsProvider
  /** The requested voice id, set only when it fell back to the default voice. */
  substitutedFrom?: string
  voiceId: string
}

export async function generateTTSAudio(
  text: string,
  voiceId: string,
  ttsModel: string,
  provider: TtsProvider,
  userContext?: { userEmail: string; userId: string },
  // languageCode is the BCP-47 script language (e.g. 'de'). Each provider
  // branch below adapts it to its own native knob so non-English scripts are not
  // rendered with an English voice/accent.
  // projectId is threaded explicitly so MiniMax voiceover spend can be
  // attributed to a project (`audioCostUsd`). Nothing on this path populates the
  // ambient JobContext, so an implicit lookup would drop the roll-up silently.
  options: {
    languageCode?: string
    projectId?: string
    skipMiniMaxScriptOptimization?: boolean
  } = {},
): Promise<{
  audioBuffer: Buffer
  preprocessedText?: string
  timestamps?: {
    alignment?: {
      characterEndTimesSeconds: number[]
      characters: string[]
      characterStartTimesSeconds: number[]
    }
  }
}> {
  text = sanitizeForTts(text)

  if (provider === 'gemini') {
    const result = await geminiTextToSpeech({ text, voiceId })
    logger.info('[GeminiTTS] TTS generation completed (buffered)')
    return { audioBuffer: result.audioBuffer }
  }

  if (provider === 'kokoro') {
    const result = await kokoroTextToSpeech({ text, voiceId })
    logger.info('[Kokoro] TTS generation completed (buffered)')
    return { audioBuffer: result.audioBuffer }
  }

  if (provider === 'qwen3') {
    const result = await qwen3TextToSpeech({
      languageCode: options.languageCode,
      speaker: await resolveQwen3Speaker(voiceId),
      text,
    })
    logger.info('[Qwen3-TTS] TTS generation completed (buffered)')
    return { audioBuffer: result.audioBuffer }
  }

  // MiniMax speech, hosted on fal. The endpoint comes from the registry.
  if (provider === 'fal') {
    const result = await falMinimaxTextToSpeech({
      // MiniMax reads bracketed delivery tags aloud.
      text: stripDeliveryMarkup(text),
      voiceId,
      languageBoost: resolveLanguageBoostFromScriptLanguage(options.languageCode),
      outputDirectory: os.tmpdir(),
      // Cost attribution only. `projectId` would also switch the
      // client's storage routing to the canonical voiceover key, which this path
      // must not do -- it reads the temp file back below, and chunked TTS runs N
      // concurrent chunks that would all race on that one key.
      costProjectId: options.projectId,
      skipScriptOptimization: options.skipMiniMaxScriptOptimization,
    })

    if (result.status !== 'success' || !result.outputPath) {
      throw new Error(`Fal MiniMax TTS failed: ${result.message}`)
    }

    const audioBuffer = await readFile(result.outputPath)
    try {
      await rm(result.outputPath)
    } catch {
      // ignore cleanup errors
    }

    logger.info('[FalMiniMax] TTS generation completed (buffered)')

    return { audioBuffer, preprocessedText: result.preprocessedText }
  }

  // No ElevenLabs key: the same voice through Eleven v3 hosted on fal. fal returns no
  // character timings; the speech-to-text step times the words instead.
  if (!hasElevenLabsKey()) {
    // On Gemini, ElevenLabs voices never run on fal (tts.elevenlabs is null there). Routing
    // already swaps them for the Gemini default, so only a caller that skips routing gets here.
    if (currentGenerationProvider() === 'google') throw new Error(NEEDS_ELEVENLABS_KEY)
    const audioBuffer = await generateElevenLabsViaFal({
      languageCode: options.languageCode,
      text,
      voiceId,
    })
    logger.info('[ElevenLabsFal] TTS generation completed (buffered)')
    return { audioBuffer }
  }

  // eleven_multilingual_v2 auto-detects language from the text; also pass the
  // script language_code when known so selection is explicit rather than inferred.
  const ttsResult = await elevenLabsGenerateTTS(text, voiceId, ttsModel, options.languageCode)
  logger.info('[ElevenLabs] TTS generation completed (buffered)')
  return { audioBuffer: ttsResult.audioBuffer, timestamps: ttsResult.timestamps }
}

/** The vendor a voice id is synthesized on. */
export async function getProviderForVoice(voiceId: string): Promise<TtsProvider> {
  return (await resolveVoiceRoute(voiceId)).provider
}

export async function isUserVoiceCloneVoiceId(voiceId: string | undefined): Promise<boolean> {
  const normalizedVoiceId = voiceId?.trim()
  if (!normalizedVoiceId) {
    return false
  }
  try {
    const provider = await getUserVoiceCloneDataService().getProviderByVoiceId(normalizedVoiceId)
    return (
      provider === 'byteplus' ||
      provider === 'elevenlabs' ||
      provider === 'fal' ||
      provider === 'minimax' ||
      provider === 'qwen3'
    )
  } catch (error) {
    logger.warn(
      `[ProviderRouter] Failed to check user voice clone - voiceId=${normalizedVoiceId}: ${ensureError(error).message}`,
    )
    return false
  }
}

/** The model id a provider synthesizes with, from the model registry. */
export function resolveTtsModel(provider: TtsProvider): string {
  if (provider === 'gemini') return geminiTtsModelName()
  if (provider === 'kokoro' || provider === 'qwen3') {
    return falTtsModelName(provider)
  }
  if (provider === 'fal') {
    return falMinimaxModelName(falMinimaxTtsEndpoint())
  }
  if (hasElevenLabsKey()) return elevenLabsTtsModelId()
  // On Gemini, ElevenLabs voices run only on the user's own key: say so instead of the
  // registry error elevenLabsFalModelName() throws for the null tts.elevenlabs role.
  if (currentGenerationProvider() === 'google') throw new Error(NEEDS_ELEVENLABS_KEY)
  return elevenLabsFalModelName()
}

/**
 * Resolves the vendor and the voice id to synthesize for a requested voice.
 *
 * A stored clone row decides first, because a clone id can collide with a preset
 * name. Legacy rows that fal cannot synthesize fall back to the default voice:
 * - `provider: 'minimax'`: minted on MiniMax's own tenant. Clone ids are
 *   tenant-scoped, so fal rejects them. The fal re-clone (`migratedFromVoiceId`)
 *   is used when one exists.
 * - `provider: 'byteplus'`: retired zero-shot clones.
 * Retired presets (MiniMax, Gemini, BytePlus, library voices) map to the default
 * voice. Kokoro and Qwen3 presets route by their id prefix. Every other id is an
 * ElevenLabs voice. Without ELEVENLABS_API_KEY those run on fal, which speaks only
 * the ElevenLabs presets (`falElevenLabsVoice`); other ElevenLabs ids, clones
 * included, fall back to the default voice.
 */
export async function resolveVoiceRoute(voiceId: string): Promise<VoiceRoute> {
  const userVoiceCloneService = getUserVoiceCloneDataService()
  const cloneProvider = await userVoiceCloneService.getProviderByVoiceId(voiceId)

  if (cloneProvider === 'fal') {
    if (currentGenerationProvider() === 'google') {
      return substituteDefaultVoice(voiceId, 'fal_clone', ON_GEMINI_MINIMAX)
    }
    if (!process.env['FAL_KEY']) {
      return substituteDefaultVoice(
        voiceId,
        'fal_clone',
        'MiniMax clones run on fal, and FAL_KEY is not set',
      )
    }
    logger.info(`[ProviderRouter] Using fal-hosted MiniMax voice clone - voiceId=${voiceId}`)
    return { provider: 'fal', voiceId }
  }

  if (cloneProvider === 'qwen3') {
    if (!(await runsWithoutFal('qwen3'))) {
      return substituteDefaultVoice(voiceId, 'qwen3_clone', ON_GEMINI_LOCAL)
    }
    logger.info(`[ProviderRouter] Using Qwen3-TTS user voice - voiceId=${voiceId}`)
    return { provider: 'qwen3', voiceId }
  }

  if (cloneProvider === 'elevenlabs') {
    // The clone lives on the user's own ElevenLabs account, which fal can't reach.
    if (!hasElevenLabsKey()) {
      return substituteDefaultVoice(
        voiceId,
        'elevenlabs_clone',
        'ElevenLabs voice clones need ELEVENLABS_API_KEY',
      )
    }
    logger.info(`[ProviderRouter] Using ElevenLabs voice clone - voiceId=${voiceId}`)
    return { provider: 'elevenlabs', voiceId }
  }

  if (cloneProvider === 'minimax') return minimaxCloneRoute(voiceId)

  if (cloneProvider === 'byteplus') {
    return substituteDefaultVoice(
      voiceId,
      'byteplus',
      isBytePlusReferenceVoiceId(voiceId)
        ? 'Legacy Seed Audio clone can no longer be synthesized'
        : 'Seed Audio is no longer available',
    )
  }

  if (isRetiredVoiceId(voiceId)) return retiredRoute(voiceId)

  return presetRoute(voiceId)
}

const ON_GEMINI_ELEVENLABS =
  'Gemini makes the voices, and ElevenLabs voices need ELEVENLABS_API_KEY'
const ON_GEMINI_LOCAL = 'Gemini makes the voices, and this voice needs the free local voices'
const ON_GEMINI_MINIMAX = 'Gemini makes the voices, and MiniMax clones run on fal'

/**
 * Gemini TTS narrates with GEMINI_API_KEY, whoever makes the pictures and clips: a Gemini voice
 * picked while fal makes the videos speaks with Gemini, and its captions are timed the usual way
 * (on this computer first).
 */
function geminiSpeaks(): boolean {
  return hasGeminiKey()
}

/**
 * A legacy MiniMax clone speaks through its fal re-clone (the same voice, re-minted on fal's
 * tenant). On Gemini nothing runs on fal, so it speaks as the Gemini default voice instead.
 */
async function minimaxCloneRoute(voiceId: string): Promise<VoiceRoute> {
  if (currentGenerationProvider() === 'google') {
    return substituteDefaultVoice(voiceId, 'minimax_clone', ON_GEMINI_MINIMAX)
  }
  const falVoiceId = await getUserVoiceCloneDataService()
    .getFalCounterpartVoiceId(voiceId)
    .catch((error: unknown) => {
      logger.warn(
        `[ProviderRouter] Failed to look up the fal re-clone of a MiniMax clone - voiceId=${voiceId}: ${ensureError(error).message}`,
      )
      return null
    })
  if (falVoiceId) {
    logger.info(
      `[ProviderRouter] Using the fal re-clone of a legacy MiniMax clone - sourceVoiceId=${voiceId} voiceId=${falVoiceId}`,
    )
    // The same voice, re-minted on fal's tenant, so not a substitution.
    return { provider: 'fal', voiceId: falVoiceId }
  }
  return substituteDefaultVoice(
    voiceId,
    'minimax_clone',
    'Legacy MiniMax clone has no fal re-clone, and fal cannot synthesize MiniMax-tenant clone ids',
  )
}

/**
 * Gemini, Kokoro and Qwen3 presets route by id; every other id is an ElevenLabs voice. A Gemini
 * voice speaks on GEMINI_API_KEY whoever makes the videos, and is refused without it. Any other
 * voice that can't speak with the keys set, or that would run on fal while Gemini makes the
 * voices, speaks as the default voice instead.
 */
async function presetRoute(voiceId: string): Promise<VoiceRoute> {
  if (isGeminiVoiceId(voiceId)) {
    // Picked on purpose, so never swapped for another voice: without the key, say how to fix it.
    if (!geminiSpeaks()) throw new Error(NEEDS_GEMINI_KEY)
    logger.info(`[ProviderRouter] Using Gemini preset voice - voiceId=${voiceId}`)
    return { provider: 'gemini', voiceId }
  }
  const falProvider = falTtsProviderForVoiceId(voiceId)
  if (falProvider === 'kokoro' || (falProvider === 'qwen3' && qwen3PresetSpeaker(voiceId))) {
    if (!(await runsWithoutFal(falProvider))) {
      return substituteDefaultVoice(voiceId, falProvider, ON_GEMINI_LOCAL)
    }
    logger.info(`[ProviderRouter] Using ${falProvider} preset voice - voiceId=${voiceId}`)
    return { provider: falProvider, voiceId }
  }
  if (!hasElevenLabsKey()) {
    // On Gemini, ElevenLabs voices never run on fal. On fal, phase 2's rule: fal speaks only
    // the presets checked against it, so library voices and typed-in ids get the default voice.
    if (currentGenerationProvider() === 'google') {
      return substituteDefaultVoice(voiceId, 'elevenlabs', ON_GEMINI_ELEVENLABS)
    }
    if (falElevenLabsVoice(voiceId) === null) {
      return substituteDefaultVoice(
        voiceId,
        'elevenlabs_voice',
        'ElevenLabs voices outside the presets need ELEVENLABS_API_KEY',
      )
    }
  }
  logger.info(`[ProviderRouter] Using ElevenLabs voice - voiceId=${voiceId}`)
  return { provider: 'elevenlabs', voiceId }
}

/**
 * A retired voice: a bare Gemini name ("Leda") is still that Gemini voice with GEMINI_API_KEY;
 * without it, it speaks as the default voice, like any retired voice.
 */
function retiredRoute(voiceId: string): VoiceRoute {
  const gemini = isGeminiPresetVoiceId(voiceId) ? geminiPresetIdForLegacyName(voiceId) : null
  if (gemini && geminiSpeaks()) {
    logger.info(`[ProviderRouter] Retired Gemini voice ${voiceId} speaks as ${gemini}`)
    return { provider: 'gemini', substitutedFrom: voiceId, voiceId: gemini }
  }
  return substituteDefaultVoice(voiceId, 'retired', 'This voice is no longer offered')
}

/** On fal, Kokoro and Qwen3 run locally or on fal; on Gemini only on this computer. */
async function runsWithoutFal(engine: 'kokoro' | 'qwen3'): Promise<boolean> {
  return currentGenerationProvider() !== 'google' || (await localTtsSupports(engine))
}

/** The default voice of the current generation provider (a Gemini voice on Gemini). */
function substituteDefaultVoice(voiceId: string, from: string, reason: string): VoiceRoute {
  const fallback = defaultVoice()
  logger.warn(
    `[ProviderRouter] ${reason}; using the default voice - from=${from} sourceVoiceId=${voiceId} voiceId=${fallback.voiceId}`,
  )
  return { provider: fallback.provider, substitutedFrom: voiceId, voiceId: fallback.voiceId }
}

/** The Qwen3 speaker for a voice id: a preset name, or a user's cloned or designed voice. */
export async function resolveQwen3Speaker(voiceId: string): Promise<Qwen3Speaker> {
  const preset = qwen3PresetSpeaker(voiceId)
  if (preset) return { voice: preset }
  const record = await getUserVoiceCloneDataService().getQwen3Speaker(voiceId)
  if (!record) throw new Error(`Qwen3 voice ${voiceId} not found`)
  return { reference: qwen3VoiceReference(record) }
}
