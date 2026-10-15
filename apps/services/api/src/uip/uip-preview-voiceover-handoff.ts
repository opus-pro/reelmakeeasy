import { randomUUID } from 'node:crypto'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { isMiniMaxSupportedScriptLanguage } from '@reelmakeeasy/common/tts/language-config'

import type { VoiceOverService } from '../voice-over/voice-over.service'

import { stripInlineTtsMarkupForDisplay } from './uip-planner-utils'
import { mergePronunciationDicts } from './uip-pronunciation-instructions'
import type { UipSessionState } from './uip-timeline-types'
import { readScriptLanguageFromSpec } from './uip-transcript-voice-preview'

type PreviewHandoffSessionState = {
  cached_artifacts?: {
    working_script?: null | {
      script?: null | string
    }
  }
  working_script?: null | {
    script?: null | string
  }
}
type PreviewProvider = NonNullable<UipSessionState['preview_voiceover']>['provider']
type PreviewVoiceover = NonNullable<UipSessionState['preview_voiceover']>

const logger = createSubLogger('uip-preview-voiceover-handoff')

const INLINE_PRONUNCIATION_PATTERN = /\{[^{}|/\n]{1,80}\|[^{}\n]{1,160}\}/
const INLINE_TTS_TAG_NAMES = [
  'angry',
  'breath',
  'burps',
  'calm',
  'chuckle',
  'clear-throat',
  'coughs',
  'disgusted',
  'emm',
  'exhale',
  'fearful',
  'gasps',
  'groans',
  'happy',
  'hissing',
  'humming',
  'inhale',
  'laughs',
  'lip-smacking',
  'pant',
  'sad',
  'sighs',
  'sneezes',
  'sniffs',
  'snorts',
  'surprised',
]
const INLINE_TTS_TAG_PATTERN = new RegExp(`\\[(${INLINE_TTS_TAG_NAMES.join('|')})\\]`, 'i')

export async function resolveOrGeneratePreviewVoiceoverHandoff(params: {
  projectId: string
  pronunciationDict?: string[]
  script: string
  sessionState: UipSessionState
  transcriptVoicePreviewEnabled: boolean
  voiceId?: null | string
  voiceOverJson?: unknown
  voiceOverService?: VoiceOverService
}): Promise<PreviewVoiceover | undefined> {
  // Read the script language up front. It decides both whether a cached preview is
  // still valid and, when regenerating, which engine renders it.
  const scriptLanguage = await readScriptLanguageFromSpec(params.projectId)
  const existing = resolvePreviewVoiceoverHandoff(params)
  if (
    existing &&
    hasRequestedPronunciationWords(existing.pronunciation_dict, params.pronunciationDict) &&
    !isPreviewStaleForLanguageRoute(existing, scriptLanguage)
  ) {
    return existing
  }

  const voiceOverService = params.voiceOverService
  if (
    !params.transcriptVoicePreviewEnabled ||
    !voiceOverService ||
    !shouldGeneratePreviewVoiceoverHandoff(params)
  ) {
    return undefined
  }

  try {
    return await generatePreviewVoiceoverHandoff({ ...params, scriptLanguage, voiceOverService })
  } catch (err) {
    logger.warn(
      `[${params.projectId}] Failed to generate confirm-time preview voiceover handoff: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return undefined
  }
}

export function resolvePreviewVoiceoverHandoff(params: {
  script: string
  sessionState: UipSessionState
  voiceId?: null | string
  voiceOverJson?: unknown
}): PreviewVoiceover | undefined {
  const preview = params.sessionState.preview_voiceover
  if (!preview?.audio_path || !preview.script_text) {
    return undefined
  }

  if (!isPreviewScriptMatch(preview.script_text, params.script)) {
    return undefined
  }

  const selectedVoiceId = params.voiceId?.trim()
  if (selectedVoiceId && preview.voice_id !== selectedVoiceId) {
    return undefined
  }

  const currentProvider = resolveProviderFromVoiceOverJson(params.voiceOverJson)
  if (currentProvider && preview.provider !== currentProvider) {
    return undefined
  }

  const currentSpeed = resolveCurrentPreviewSpeed(params.sessionState)
  if (currentSpeed !== undefined && normalizePreviewSpeed(preview.speed) !== currentSpeed) {
    return undefined
  }

  return preview
}

/**
 * A cached preview is stale when it was rendered by the wrong engine for this
 * script's language.
 *
 * The stored `provider` says `gemini` for both a real-Gemini take and a MiniMax-clone take, so
 * it cannot tell them apart. `content_type` can: only the Gemini branch returns WAV. Without
 * this, a Burmese session that cached a MiniMax preview before the gate turned on would keep
 * shipping that audio, because confirm returns the cached preview before regenerating.
 */
export function isPreviewStaleForLanguageRoute(
  preview: PreviewVoiceover,
  scriptLanguage: string | undefined,
): boolean {
  if (isMiniMaxSupportedScriptLanguage(scriptLanguage)) {
    return false
  }
  return preview.provider === 'gemini' && preview.content_type !== 'audio/wav'
}

export function resolvePreviewHandoffScript(params: {
  confirmedScript?: null | string
  fallbackScript: string
  sessionState: PreviewHandoffSessionState
}): string {
  const confirmedScript = params.confirmedScript?.trim()
  if (!confirmedScript) {
    return params.fallbackScript
  }

  // `confirmedScript` is written synchronously by the GUI transcript save. It can outlive a
  // later planner rewrite, so only trust it while the persisted working transcript still agrees.
  const workingScript = readWorkingScript(params.sessionState)
  if (!workingScript || !isSameScriptSource(confirmedScript, workingScript)) {
    return params.fallbackScript
  }

  return confirmedScript
}

export function scriptRequiresPreviewVoiceover(script: string): boolean {
  return INLINE_PRONUNCIATION_PATTERN.test(script) || INLINE_TTS_TAG_PATTERN.test(script)
}

// The extension must match the bytes. Story mode's normalizeVoiceOverToMp3 keys off
// it -- a WAV written under a .mp3 name is copied through as if it were already mp3.
function buildPreviewAudioPath(contentType: 'audio/mpeg' | 'audio/wav'): string {
  const extension = contentType === 'audio/wav' ? 'wav' : 'mp3'
  return `user-intent-planner/voice-preview/${Date.now()}-${randomUUID()}.${extension}`
}

async function generatePreviewVoiceoverHandoff(params: {
  projectId: string
  pronunciationDict?: string[]
  script: string
  scriptLanguage?: string
  sessionState: UipSessionState
  voiceId?: null | string
  voiceOverJson?: unknown
  voiceOverService: VoiceOverService
}): Promise<PreviewVoiceover> {
  const previousPreview = params.sessionState.preview_voiceover ?? null
  const currentProvider = resolveProviderFromVoiceOverJson(params.voiceOverJson)
  const provider = currentProvider ?? previousPreview?.provider
  const speed =
    resolveCurrentPreviewSpeed(params.sessionState) ?? normalizePreviewSpeed(previousPreview?.speed)
  const pronunciationDict = params.pronunciationDict?.length
    ? mergePronunciationDicts(params.pronunciationDict, previousPreview?.pronunciation_dict)
    : []
  // The confirm-time handoff never forwarded the script language, so the audio that
  // actually ships was synthesized with no language hint while the UI preview had one
  // (uip-transcript-voice-preview passes it). It also decides whether MiniMax can
  // serve this script at all.
  const scriptLanguage = params.scriptLanguage
  const result = await params.voiceOverService.generateTtsPreview(
    {
      elevenLabsPronunciationMode: 'replace-text',
      ...(scriptLanguage ? { scriptLanguage } : {}),
      ...(previousPreview?.model && previousPreview.provider === provider
        ? { model: previousPreview.model }
        : {}),
      ...(provider ? { provider } : {}),
      ...(pronunciationDict.length ? { pronunciationDict } : {}),
      speed,
      text: params.script,
      ...(params.voiceId?.trim() ? { voiceId: params.voiceId.trim() } : {}),
    },
    { costProjectId: params.projectId, fullScript: true },
  )

  // The worker imports this take through the uploaded-audio path, which rejects over-cap
  // audio before its fidelity fallback. Keep such takes on the existing TTS fallback here.
  if (result.audioDurationSeconds > EXPANDED_STORY_MODE_LIMITS.maxAudioUploadSeconds) {
    throw new Error('Confirm-time voiceover exceeds the audio duration limit')
  }

  const audioPath = buildPreviewAudioPath(result.contentType)
  const storage = await createStorage(params.projectId)
  await storage.ensureDir('user-intent-planner/voice-preview')
  await storage.writeFile(audioPath, Buffer.from(result.audioBase64, 'base64'))

  return {
    audio_duration_seconds: result.audioDurationSeconds,
    audio_path: audioPath,
    byte_length: result.byteLength,
    content_type: result.contentType,
    generated_at: new Date().toISOString(),
    model: result.model,
    normalized_text: result.normalizedText,
    pronunciation_dict: result.pronunciationDict,
    provider: result.provider,
    resolved_voice_id: result.resolvedVoiceId,
    script_text: params.script,
    speed,
    voice_id: result.voiceId,
  }
}

function hasCustomPreviewSpeed(sessionState: UipSessionState): boolean {
  const speed = resolveCurrentPreviewSpeed(sessionState)
  return speed !== undefined && speed !== 1
}

function hasRequestedPronunciationWords(
  existing: string[] | undefined,
  requested: string[] | undefined,
): boolean {
  if (!requested?.length) {
    return true
  }
  const existingWords = new Set((existing ?? []).map(readPronunciationWord).filter(Boolean))
  return requested.every((entry) => {
    const word = readPronunciationWord(entry)
    return Boolean(word && existingWords.has(word))
  })
}

function isPreviewScriptMatch(previewScript: string, confirmedScript: string): boolean {
  const preview = normalizePreviewScriptForMatch(previewScript)
  if (!preview) {
    return false
  }
  const rawScript = normalizePreviewScriptForMatch(confirmedScript)
  const displayScript = normalizePreviewScriptForMatch(
    stripInlineTtsMarkupForDisplay(confirmedScript),
  )
  return preview === rawScript || preview === displayScript
}

function isSameScriptSource(left: string, right: string): boolean {
  const normalizedLeft = normalizePreviewScriptForMatch(left)
  const normalizedRight = normalizePreviewScriptForMatch(right)
  if (!normalizedLeft || !normalizedRight) {
    return false
  }
  if (normalizedLeft === normalizedRight) {
    return true
  }
  return (
    normalizePreviewScriptForMatch(stripInlineTtsMarkupForDisplay(left)) ===
    normalizePreviewScriptForMatch(stripInlineTtsMarkupForDisplay(right))
  )
}

function normalizePreviewScriptForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizePreviewSpeed(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  return Number(Math.min(2, Math.max(0.5, value)).toFixed(2))
}

function readPronunciationWord(entry: string): string | undefined {
  const slashIndex = entry.indexOf('/')
  if (slashIndex <= 0) {
    return undefined
  }
  return entry.slice(0, slashIndex).trim().toLowerCase() || undefined
}

function readWorkingScript(sessionState: PreviewHandoffSessionState): string | undefined {
  return (
    sessionState.working_script?.script?.trim() ||
    sessionState.cached_artifacts?.working_script?.script?.trim() ||
    undefined
  )
}

function resolveCurrentPreviewSpeed(sessionState: UipSessionState): number | undefined {
  const speed = sessionState.voice_preview_speed
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return undefined
  }
  return normalizePreviewSpeed(speed)
}

function resolveProviderFromVoiceOverJson(value: unknown): PreviewProvider | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const provider = (value as { provider?: unknown }).provider
  return provider === 'byteplus' ||
    provider === 'elevenlabs' ||
    provider === 'gemini' ||
    provider === 'minimax'
    ? provider
    : undefined
}

function shouldGeneratePreviewVoiceoverHandoff(params: {
  pronunciationDict?: string[]
  script: string
  sessionState: UipSessionState
}): boolean {
  if (params.pronunciationDict?.length) {
    return true
  }
  if (scriptRequiresPreviewVoiceover(params.script)) {
    return true
  }
  if (params.sessionState.preview_voiceover?.audio_path) {
    return true
  }
  return hasCustomPreviewSpeed(params.sessionState)
}
