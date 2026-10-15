import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  generateTTSAudio,
  resolveTtsModel,
  resolveVoiceRoute,
} from '@agent-lib/agents/story-loader/voice-tools/utils/provider-tts.util'
import { elevenLabsTtsModelId } from '@reelmakeeasy/common/asr/elevenlabs'
import { ElevenLabsClient } from '@reelmakeeasy/common/elevenlabs/client'
import { elevenLabsApiKey, NEEDS_ELEVENLABS_KEY } from '@reelmakeeasy/common/elevenlabs/key'
import { logger } from '@reelmakeeasy/common/logger'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import { defaultVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import {
  elevenLabsFalModelName,
  generateElevenLabsViaFal,
  isElevenLabsFalModel,
} from '@reelmakeeasy/common/tts/elevenlabs-fal'
import {
  falMinimaxModelName,
  falMinimaxTtsEndpoint,
  textToSpeech as falMinimaxTextToSpeech,
} from '@reelmakeeasy/common/tts/fal-minimax'
import { resolveLanguageBoostFromScriptLanguage } from '@reelmakeeasy/common/tts/language-config'
import { isRetiredVoiceId } from '@reelmakeeasy/common/tts/legacy-voices'
import { localTtsHealth } from '@reelmakeeasy/common/tts/local-tts'
import {
  type LanguageBoost,
  type TTSModel as MiniMaxTTSModel,
} from '@reelmakeeasy/common/tts/minimax-text'
import {
  DEFAULT_VOICE_ID,
  falElevenLabsVoice,
  isPresetVoiceId,
} from '@reelmakeeasy/common/tts/preset-voices'
import {
  currentVoiceContext,
  geminiVoicesUsable,
  NEEDS_GEMINI_KEY,
  pickedVoiceUnavailableReason,
  presetEngine,
  qwen3CloneStatus,
  shownVoiceEngines,
} from '@reelmakeeasy/common/tts/voice-engines'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { unwrapMidSentenceLineBreaks } from '@reelmakeeasy/common/utils/tts-sanitize'
import { currentGenerationProvider } from '@reelmakeeasy/llm/registry'
import { BadRequestException, Injectable } from '@nestjs/common'
import { TtsEnginesResponse, VoiceOverOptionsResponse } from '@shared/types/api/voice-over'

import { PrismaService } from '../prisma/prisma.service'
import { getAudioDurationSecondsFromBuffer } from '../util/audio-duration'
import { standardCloneBackend } from '../voice-clones/voice-clones.backend'

import { presetPreviewData } from './voice-over'

const PRESET_URL_TTL_MS = 365 * 24 * 60 * 60 * 1000 // preset URLs don't expire

const TTS_PREVIEW_MAX_TEXT_LENGTH = 2400
const ELEVENLABS_EMOTION_TAGS: Record<string, string> = {
  angry: '[angry]',
  calm: '[calm]',
  disgusted: '[disgusted]',
  fearful: '[nervously]',
  happy: '[happily]',
  sad: '[sad]',
  surprised: '[surprised]',
}
const ELEVENLABS_INTERJECTION_TAGS: Record<string, string> = {
  breath: '[breathes]',
  burps: '[burps]',
  chuckle: '[chuckles]',
  'clear-throat': '[clears throat]',
  coughs: '[coughs]',
  emm: '[emm]',
  exhale: '[exhales]',
  gasps: '[gasps]',
  groans: '[groans]',
  hissing: '[hisses]',
  humming: '[hums]',
  inhale: '[inhales]',
  laughs: '[laughs]',
  'lip-smacking': '[smacks lips]',
  pant: '[pants]',
  sighs: '[sighs]',
  sneezes: '[sneezes]',
  sniffs: '[sniffs]',
  snorts: '[snorts]',
}
const MINIMAX_INTERJECTION_TAGS: Record<string, string> = {
  breath: '(breath)',
  burps: '(burps)',
  chuckle: '(chuckle)',
  'clear-throat': '(clear-throat)',
  coughs: '(coughs)',
  emm: '(emm)',
  exhale: '(exhale)',
  gasps: '(gasps)',
  groans: '(groans)',
  hissing: '(hissing)',
  humming: '(humming)',
  inhale: '(inhale)',
  laughs: '(laughs)',
  'lip-smacking': '(lip-smacking)',
  pant: '(pant)',
  sighs: '(sighs)',
  sneezes: '(sneezes)',
  sniffs: '(sniffs)',
  snorts: '(snorts)',
}

export type TtsPreviewRequest = {
  elevenLabsPronunciationMode?: 'dictionary-locators' | 'replace-text'
  emotion?: string
  // MiniMax language_boost. When set, biases synthesis to this language so bare-digit
  // tokens (e.g. years) are spoken in-locale instead of auto-detected.
  languageBoost?: LanguageBoost
  /** ElevenLabs model id. MiniMax always uses the registry's `tts.minimax` endpoint. */
  model?: string
  pronunciationDict?: string[]
  pronunciationDictionaryLocators?: ElevenLabsPronunciationDictionaryLocator[]
  provider?: TtsPreviewRequestProvider
  // BCP-47 script language from the planner. Used to derive `languageBoost` when the
  // caller does not set one.
  scriptLanguage?: string
  similarityBoost?: number
  skipScriptOptimization?: boolean
  speed?: number
  stability?: number
  style?: number
  text?: string
  useSpeakerBoost?: boolean
  voiceId?: string
}
export type TtsPreviewResponse = {
  audioBase64: string
  audioDurationSeconds: number
  byteLength: number
  contentType: 'audio/mpeg'
  generationMs: number
  model: string
  normalizedText: string
  preprocessedText?: string
  pronunciationDict: string[]
  provider: TtsPreviewProvider
  resolvedVoiceId?: string
  traceId?: string
  voiceId: string
}

type ElevenLabsPronunciationDictionaryLocator = {
  dictionaryId?: string
  pronunciationDictionaryId?: string
  versionId?: string
}

// Previews run on ElevenLabs, MiniMax on fal, Gemini TTS, or Kokoro / Qwen3-TTS (fal).
type TtsPreviewProvider = 'elevenlabs' | 'fal' | 'gemini' | 'kokoro' | 'qwen3'
// Callers may still send the retired values stored on older sessions; every one of them
// is served by fal.
type TtsPreviewRequestProvider = 'byteplus' | 'gemini' | 'minimax' | TtsPreviewProvider

@Injectable()
export class VoiceOverService {
  constructor(private readonly prisma?: PrismaService) {}

  async generatePresignedUrl(voiceId: string): Promise<{ expiresAt: string; signedUrl: string }> {
    try {
      // Preset voice previews ship in the repo's presets/ folder.
      const key = `voice-over/previews/preview-${voiceId}.mp3`
      if (!existsSync(presetPath(key))) {
        throw new BadRequestException('Voice preview not found')
      }
      return {
        expiresAt: new Date(Date.now() + PRESET_URL_TTL_MS).toISOString(),
        signedUrl: presetUrl(key),
      }
    } catch (error) {
      const err = ensureError(error)
      logger.error(`[VoiceOver] Failed to generate URL - voiceId=${voiceId} error=${err.message}`)
      throw new BadRequestException('Failed to generate preview URL')
    }
  }

  async generateTtsPreview(
    body: TtsPreviewRequest = {},
    options: { costProjectId?: string; fullScript?: boolean } = {},
  ): Promise<TtsPreviewResponse> {
    // A Gemini voice speaks on GEMINI_API_KEY whoever makes the videos; without it, say how to
    // fix that before anything runs (its stored preview still plays from the voice list).
    const unavailable = pickedVoiceUnavailableReason(body.voiceId)
    if (unavailable) throw new BadRequestException(unavailable)
    // Gemini, Kokoro and Qwen3 voices preview through their own TTS.
    const routed = await this.routedVoicePreview(body, options)
    if (routed) return routed
    const requestedVoiceId = body.voiceId?.trim() ?? ''
    // Presets, swapped voices and "no voice" all preview on ElevenLabs; only a voice clone
    // minted on fal previews there. Routing swapped a retired voice for Sarah (a bare Gemini
    // name with GEMINI_API_KEY previewed above as that Gemini voice), so it previews as Sarah.
    const isSwappedVoice = isRetiredVoiceId(requestedVoiceId)
    const provider =
      !requestedVoiceId || isSwappedVoice || isPresetVoiceId(requestedVoiceId)
        ? 'elevenlabs'
        : normalizePreviewProvider(body.provider)
    const parsedText = extractInlinePronunciationMarkers(
      unwrapMidSentenceLineBreaks(body.text ?? ''),
    )
    const explicitEmotion = normalizeEmotion(body.emotion)
    const previewBodyWithEmotion: TtsPreviewRequest = {
      ...body,
      ...(isSwappedVoice ? { voiceId: DEFAULT_VOICE_ID } : {}),
    }
    if (explicitEmotion) {
      previewBodyWithEmotion.emotion = explicitEmotion
    } else {
      delete previewBodyWithEmotion.emotion
    }
    const miniMaxModel = provider === 'elevenlabs' ? undefined : miniMaxPreviewModel()
    const text = formatPreviewTextForProvider(provider, parsedText.text, miniMaxModel).trim()
    if (!text) {
      throw new BadRequestException('Text is required')
    }
    // Confirm synthesizes the complete narration with the same settings as the audition.
    // MiniMax accepts longer scripts; its client enforces synthesis limits. The interactive
    // preview and ElevenLabs keep their cap.
    const fullMiniMaxScript = options.fullScript && provider === 'fal'
    if (text.length > TTS_PREVIEW_MAX_TEXT_LENGTH && !fullMiniMaxScript) {
      throw new BadRequestException(
        `Text must be ${TTS_PREVIEW_MAX_TEXT_LENGTH} characters or less`,
      )
    }

    const pronunciationDict = normalizePronunciationDict([
      ...parsedText.pronunciationDict,
      ...(body.pronunciationDict ?? []),
    ])
    const startedAt = Date.now()

    if (provider === 'elevenlabs') {
      const result = await this.generateElevenLabsPreview({
        body: previewBodyWithEmotion,
        pronunciationDict,
        startedAt,
        text,
      })
      // Report the substitution so the session keeps the voice that actually spoke.
      return isSwappedVoice
        ? { ...result, resolvedVoiceId: DEFAULT_VOICE_ID, voiceId: requestedVoiceId }
        : result
    }

    return this.generateMiniMaxPreview({
      body: previewBodyWithEmotion,
      costProjectId: options.costProjectId,
      pronunciationDict,
      startedAt,
      text,
      ...(miniMaxModel ? { model: miniMaxModel } : {}),
    })
  }

  /**
   * Preset voices of the engines listed now, with the provider's default voice flagged. Gemini's
   * voices are always listed; without GEMINI_API_KEY each says why it can't be picked.
   */
  async getOptions(provider: string): Promise<VoiceOverOptionsResponse> {
    const context = await currentVoiceContext()
    const shown = new Set(shownVoiceEngines(context))
    const geminiReason = geminiVoicesUsable(context) ? undefined : NEEDS_GEMINI_KEY
    const defaultId = defaultVoiceId()
    const data = presetPreviewData
      .filter(
        (item) =>
          shown.has(presetEngine(item.provider)) && (!provider || item.provider === provider),
      )
      .map((item) => (item.voiceId === defaultId ? { ...item, default: true } : item))
      .map((item) =>
        geminiReason && presetEngine(item.provider) === 'gemini'
          ? { ...item, unavailableReason: geminiReason }
          : item,
      )
    return { data }
  }

  /** Where each engine runs (free on this computer, or paid), which the picker lists, and who can clone. */
  async getTtsEngines(): Promise<TtsEnginesResponse> {
    const [local, context] = await Promise.all([localTtsHealth(), currentVoiceContext()])
    const onLocal = (engine: 'kokoro' | 'qwen3') =>
      local?.engines[engine]
        ? { free: true, runsOn: 'local' as const }
        : { free: false, runsOn: 'fal' as const }
    return {
      elevenlabsKey: context.elevenlabsKey,
      engines: {
        elevenlabs: { free: false, runsOn: context.elevenlabsKey ? 'elevenlabs' : 'fal' },
        gemini: { free: false, runsOn: 'google' },
        kokoro: onLocal('kokoro'),
        qwen3: onLocal('qwen3'),
      },
      geminiKey: geminiVoicesUsable(context),
      generationProvider: context.generation,
      ...(local ? { localBackend: local.backend } : {}),
      qwen3Clone: qwen3CloneStatus(context),
      shown: shownVoiceEngines(context),
      standardClone: standardCloneBackend(),
    }
  }

  private async generateElevenLabsPreview(args: {
    body: TtsPreviewRequest
    pronunciationDict: string[]
    startedAt: number
    text: string
  }): Promise<TtsPreviewResponse> {
    const { body, pronunciationDict, startedAt } = args
    const apiKey = elevenLabsApiKey()
    const voiceId = body.voiceId?.trim() || DEFAULT_VOICE_ID
    // Without a key, ElevenLabs voices run on fal, which speaks only the presets checked
    // against it, and never while Gemini makes the voices (tts.elevenlabs is null there).
    // A voice cloned on the user's own ElevenLabs account can't run on fal either.
    if (
      !apiKey &&
      (currentGenerationProvider() === 'google' || falElevenLabsVoice(voiceId) === null)
    ) {
      throw new BadRequestException(NEEDS_ELEVENLABS_KEY)
    }
    const model = apiKey ? directElevenLabsModel(body.model) : elevenLabsFalModelName()
    const text =
      body.elevenLabsPronunciationMode === 'replace-text'
        ? applyPronunciationReplacement(
            formatElevenLabsText(args.text, body.emotion),
            pronunciationDict,
          )
        : formatElevenLabsText(args.text, body.emotion)
    const speed = mapUnifiedSpeedToElevenLabs(body.speed)
    const stability = clampNumber(body.stability, 0, 1, 0.5)

    try {
      const audioBuffer = apiKey
        ? await elevenLabsDirectAudio({ apiKey, body, model, speed, stability, text, voiceId })
        : await generateElevenLabsViaFal({ speed, stability, text, voiceId })
      const generationMs = Date.now() - startedAt
      const audioDurationSeconds = await getAudioDurationSecondsFromBuffer(audioBuffer)

      return {
        audioBase64: audioBuffer.toString('base64'),
        audioDurationSeconds,
        byteLength: audioBuffer.byteLength,
        contentType: 'audio/mpeg',
        generationMs,
        model,
        normalizedText: text,
        pronunciationDict,
        provider: 'elevenlabs',
        voiceId,
      }
    } catch (error) {
      const err = ensureError(error)
      logger.warn(
        { err: err.message, model, provider: apiKey ? 'elevenlabs' : 'fal', voiceId },
        '[VoiceOver] TTS preview failed',
      )
      throw new BadRequestException(err.message)
    }
  }

  private async generateFalVoicePreview(args: {
    body: TtsPreviewRequest
    fullScript?: boolean
    provider: 'gemini' | 'kokoro' | 'qwen3'
    voiceId: string
  }): Promise<TtsPreviewResponse> {
    const { body, provider, voiceId } = args
    // Neither model reads inline delivery tags, so they are dropped rather than spoken.
    const text = extractInlinePronunciationMarkers(unwrapMidSentenceLineBreaks(body.text ?? ''))
      .text.replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) {
      throw new BadRequestException('Text is required')
    }
    if (text.length > TTS_PREVIEW_MAX_TEXT_LENGTH && !(args.fullScript && provider === 'gemini')) {
      throw new BadRequestException(
        `Text must be ${TTS_PREVIEW_MAX_TEXT_LENGTH} characters or less`,
      )
    }
    const startedAt = Date.now()
    try {
      const model = resolveTtsModel(provider)
      const { audioBuffer } = await generateTTSAudio(text, voiceId, model, provider, undefined, {
        languageCode: body.scriptLanguage,
      })
      return {
        audioBase64: audioBuffer.toString('base64'),
        audioDurationSeconds: await getAudioDurationSecondsFromBuffer(audioBuffer),
        byteLength: audioBuffer.byteLength,
        contentType: 'audio/mpeg',
        generationMs: Date.now() - startedAt,
        model,
        normalizedText: text,
        pronunciationDict: [],
        provider,
        voiceId,
      }
    } catch (error) {
      const err = ensureError(error)
      logger.warn({ err: err.message, provider, voiceId }, '[VoiceOver] TTS preview failed')
      throw new BadRequestException(err.message)
    }
  }

  private async generateMiniMaxPreview(args: {
    body: TtsPreviewRequest
    costProjectId?: string
    model?: string
    pronunciationDict: string[]
    startedAt: number
    text: string
  }): Promise<TtsPreviewResponse> {
    const { body, pronunciationDict, startedAt, text } = args
    const languageBoost = resolvePreviewLanguageBoost(body)
    const model = args.model ?? miniMaxPreviewModel()
    // Only a fal voice clone reaches this path, so a voice id is always set.
    const voiceId = body.voiceId?.trim() ?? ''
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tts-preview-minimax-'))

    try {
      const result = await falMinimaxTextToSpeech({
        ...(args.costProjectId ? { costProjectId: args.costProjectId } : {}),
        text,
        voiceId,
        emotion: normalizeOptionalString(body.emotion),
        // Fall back to the planner's script language when the caller did not pass a
        // boost. The confirm-time handoff never did, so the audio that actually ships was
        // synthesized with no language hint at all while the UI preview had one.
        // Still omitted entirely when neither is available (MiniMax auto-detects).
        ...(languageBoost ? { languageBoost } : {}),
        model: model as MiniMaxTTSModel,
        outputDirectory: tempDir,
        pronunciationDict,
        skipScriptOptimization: body.skipScriptOptimization ?? true,
        speed: clampNumber(body.speed, 0.5, 2, 1),
      })

      if (result.status !== 'success' || !result.outputPath) {
        throw new BadRequestException(result.message || 'MiniMax TTS failed')
      }

      const audioBuffer = await readFile(result.outputPath)
      const generationMs = Date.now() - startedAt
      const audioDurationSeconds = await getAudioDurationSecondsFromBuffer(audioBuffer)

      return {
        audioBase64: audioBuffer.toString('base64'),
        audioDurationSeconds,
        byteLength: audioBuffer.byteLength,
        contentType: 'audio/mpeg',
        generationMs,
        model,
        normalizedText: text,
        preprocessedText: result.preprocessedText,
        pronunciationDict,
        provider: 'fal',
        traceId: result.traceId,
        voiceId,
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error
      }
      const err = ensureError(error)
      logger.warn({ err: err.message, provider: 'fal', voiceId }, '[VoiceOver] TTS preview failed')
      throw new BadRequestException(err.message)
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  }

  /**
   * Gemini, Kokoro and Qwen3 voices (presets and Qwen3 user voices) preview through their own
   * TTS, and on Gemini "no voice" means its default. Null for the voices that preview on
   * ElevenLabs or MiniMax: on fal that includes Gemini voices, which Task 3.14 routes to Sarah.
   */
  private async routedVoicePreview(
    body: TtsPreviewRequest,
    options: { fullScript?: boolean },
  ): Promise<null | TtsPreviewResponse> {
    const requestedVoiceId =
      body.voiceId?.trim() || (currentGenerationProvider() === 'google' ? defaultVoiceId() : '')
    if (!requestedVoiceId) return null
    const route = await resolveVoiceRoute(requestedVoiceId)
    if (route.provider !== 'gemini' && route.provider !== 'kokoro' && route.provider !== 'qwen3') {
      return null
    }
    const result = await this.generateFalVoicePreview({
      body,
      fullScript: options.fullScript,
      provider: route.provider,
      voiceId: route.voiceId,
    })
    // Report a substitution so the session keeps the voice that actually spoke.
    return route.substitutedFrom
      ? { ...result, resolvedVoiceId: route.voiceId, voiceId: requestedVoiceId }
      : result
  }
}

function applyPronunciationReplacement(text: string, pronunciationDict: string[]): string {
  return pronunciationDict.reduce((currentText, entry) => {
    const slashIndex = entry.indexOf('/')
    if (slashIndex === -1) {
      return currentText
    }
    const word = entry.slice(0, slashIndex).trim()
    const pronunciation = entry.slice(slashIndex + 1).trim()
    if (!word || !pronunciation) {
      return currentText
    }
    return currentText.replace(
      new RegExp(`(^|[^A-Za-z0-9_{}|])(${escapeRegExp(word)})(?=$|[^A-Za-z0-9_{}|])`, 'gi'),
      (_match, prefix) => `${prefix}${pronunciation}`,
    )
  }, text)
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numericValue))
}

/**
 * The model for a direct ElevenLabs call: the one the request names, unless that is the
 * fal model a preview saved while no key was set (ElevenLabs doesn't know it).
 */
function directElevenLabsModel(requested: string | undefined): string {
  const model = requested?.trim()
  return model && !isElevenLabsFalModel(model) ? model : elevenLabsTtsModelId()
}

/** ElevenLabs text to speech on the user's own account, with every voice setting the preview offers. */
async function elevenLabsDirectAudio(args: {
  apiKey: string
  body: TtsPreviewRequest
  model: string
  speed: number
  stability: number
  text: string
  voiceId: string
}): Promise<Buffer> {
  const { body } = args
  const pronunciationDictionaryLocators = normalizeElevenLabsLocators(
    body.pronunciationDictionaryLocators,
  )
  const audioResult = await new ElevenLabsClient({ apiKey: args.apiKey }).textToSpeech.convert(
    args.voiceId,
    {
      modelId: args.model,
      outputFormat: 'mp3_44100_128',
      text: args.text,
      voiceSettings: {
        similarityBoost: clampNumber(body.similarityBoost, 0, 1, 0.75),
        speed: args.speed,
        stability: args.stability,
        style: clampNumber(body.style, 0, 1, 0),
        useSpeakerBoost: body.useSpeakerBoost ?? true,
      },
      ...(pronunciationDictionaryLocators.length ? { pronunciationDictionaryLocators } : {}),
    },
  )
  return streamToBuffer(audioResult)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function extractInlinePronunciationMarkers(text: string): {
  pronunciationDict: string[]
  text: string
} {
  const pronunciationDict: string[] = []
  const cleanedText = text.replace(
    /\{([^{}|/\n]{1,80})\|([^{}\n]{1,160})\}/g,
    (_, rawWord, rawPronunciation) => {
      const word = String(rawWord).trim()
      const pronunciation = String(rawPronunciation).trim()
      if (!word || !pronunciation) {
        return word
      }
      pronunciationDict.push(`${word}/${pronunciation}`)
      return word
    },
  )

  return { pronunciationDict, text: cleanedText }
}

function formatElevenLabsText(text: string, emotion?: string) {
  const tag = emotion ? ELEVENLABS_EMOTION_TAGS[emotion] : ''
  return tag ? `${tag} ${text}` : text
}

function formatPreviewTextForProvider(
  provider: TtsPreviewProvider,
  text: string,
  miniMaxModel?: string,
) {
  if (provider === 'elevenlabs') {
    return transformElevenLabsInlineTtsTags(text)
  }
  return transformMiniMaxInlineTtsTags(text, miniMaxModel)
}

function isMiniMaxInterjectionModel(model: string | undefined) {
  return Boolean(model?.startsWith('speech-2.8-'))
}

/** The MiniMax model the registry's `tts.minimax` endpoint serves, e.g. `speech-2.8-hd`. */
function mapUnifiedSpeedToElevenLabs(speed: number | undefined) {
  const unifiedSpeed = clampNumber(speed, 0.5, 2, 1)
  const mappedSpeed = unifiedSpeed <= 1 ? 0.4 + unifiedSpeed * 0.6 : 0.8 + unifiedSpeed * 0.2
  return clampNumber(Number(mappedSpeed.toFixed(2)), 0.7, 1.2, 1)
}

function miniMaxPreviewModel(): string {
  return falMinimaxModelName(falMinimaxTtsEndpoint())
}

function normalizeElevenLabsLocators(
  locators: ElevenLabsPronunciationDictionaryLocator[] | undefined,
): Array<{ pronunciationDictionaryId: string; versionId?: string }> {
  if (!Array.isArray(locators)) {
    return []
  }

  return locators
    .map((locator) => {
      const pronunciationDictionaryId =
        locator.pronunciationDictionaryId?.trim() || locator.dictionaryId?.trim() || ''
      const versionId = locator.versionId?.trim()
      return {
        pronunciationDictionaryId,
        ...(versionId ? { versionId } : {}),
      }
    })
    .filter((locator) => locator.pronunciationDictionaryId)
}

function normalizeEmotion(value?: string) {
  const normalized = value?.trim().toLowerCase()
  return normalized && normalized in ELEVENLABS_EMOTION_TAGS ? normalized : undefined
}

function normalizeInterjection(value?: string) {
  const normalized = value?.trim().toLowerCase()
  return normalized && normalized in MINIMAX_INTERJECTION_TAGS ? normalized : undefined
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizePreviewProvider(
  provider: TtsPreviewRequestProvider | undefined,
): TtsPreviewProvider {
  return provider === 'elevenlabs' ? 'elevenlabs' : 'fal'
}

function normalizePronunciationDict(entries: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of entries) {
    const value = normalizePronunciationEntry(entry)
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function normalizePronunciationEntry(entry: string): null | string {
  const trimmed = entry.trim()
  if (!trimmed) {
    return null
  }

  const arrowIndex = trimmed.indexOf('->')
  if (arrowIndex !== -1) {
    const word = trimmed.slice(0, arrowIndex).trim()
    const pronunciation = trimmed.slice(arrowIndex + 2).trim()
    return word && pronunciation ? `${word}/${pronunciation}` : null
  }

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex !== -1) {
    const word = trimmed.slice(0, slashIndex).trim()
    const pronunciation = trimmed.slice(slashIndex + 1).trim()
    return word && pronunciation ? `${word}/${pronunciation}` : null
  }

  return null
}

/**
 * An explicit `languageBoost` from the caller wins; otherwise derive it from the
 * planner's BCP-47 `scriptLanguage`. Returns undefined when neither is usable so the caller
 * omits the field and MiniMax keeps auto-detecting (unchanged behaviour).
 */
function resolvePreviewLanguageBoost(body: TtsPreviewRequest): LanguageBoost | undefined {
  return body.languageBoost ?? resolveLanguageBoostFromScriptLanguage(body.scriptLanguage)
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function transformElevenLabsInlineTtsTags(text: string) {
  return text.replace(/\[([^\]\n]{1,48})\]/g, (match, rawTag) => {
    const interjection = normalizeInterjection(String(rawTag))
    if (interjection) {
      return ELEVENLABS_INTERJECTION_TAGS[interjection]
    }

    const emotion = normalizeEmotion(String(rawTag))
    return emotion ? ELEVENLABS_EMOTION_TAGS[emotion] : match
  })
}

function transformMiniMaxInlineTtsTags(text: string, model: string | undefined) {
  const supportsInterjections = isMiniMaxInterjectionModel(model)
  return text
    .replace(/\[([^\]\n]{1,48})\]/g, (match, rawTag) => {
      const interjection = normalizeInterjection(String(rawTag))
      if (interjection) {
        return supportsInterjections ? MINIMAX_INTERJECTION_TAGS[interjection] : ''
      }

      const emotion = normalizeEmotion(String(rawTag))
      return emotion ? '' : match
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
}
