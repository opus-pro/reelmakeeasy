import { randomUUID } from 'node:crypto'

import type { Prisma } from '@reelmakeeasy/api-db'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { BadRequestException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'
import { resolveLanguageBoostFromScriptLanguage } from '../voice-clones/voice-clones.language-config'
import type { TtsPreviewResponse, VoiceOverService } from '../voice-over/voice-over.service'

import type { TranscriptVoicePreviewDto } from './uip.dto'
import { getPinnedUserInputFromTimeline } from './uip-original-user-input'
import {
  extractPromptPronunciationDict,
  mergePronunciationDicts,
} from './uip-pronunciation-instructions'
import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type { UipSessionState } from './uip-timeline-types'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-transcript-voice-preview')

/**
 * Fail-closed read for the per-session `enable_transcript_voice_preview`
 * snapshot pinned onto the UIP spec at creation time.
 */
export async function readTranscriptVoicePreviewEnabledFromSpec(
  projectId: string,
): Promise<boolean> {
  try {
    const file = fileStore.file(`projects/${projectId}/user-intent-planner/spec/current/spec.json`)
    const exists = await file.exists()
    if (!exists) {
      return false
    }
    const buf = await file.read()
    const spec = JSON.parse(buf.toString()) as {
      meta?: { transcript_voice_preview_enabled?: boolean }
    }
    return spec?.meta?.transcript_voice_preview_enabled === true
  } catch (err) {
    logger.warn(`[${projectId}] Failed to read transcript voice preview gate from spec: ${err}`)
    return false
  }
}

/**
 * Reads the planner's detected `script_language` (a BCP-47 tag) from the session
 * spec's global constraints. Used to set MiniMax `language_boost` on the preview so
 * numbers are spoken in the script's language rather than auto-detected.
 * Fails open to undefined so a missing/unreadable spec never blocks the preview.
 */
export async function readScriptLanguageFromSpec(projectId: string): Promise<string | undefined> {
  try {
    const file = fileStore.file(`projects/${projectId}/user-intent-planner/spec/current/spec.json`)
    const exists = await file.exists()
    if (!exists) {
      return undefined
    }
    const buf = await file.read()
    const spec = JSON.parse(buf.toString()) as {
      global_constraints?: { script_language?: string }
    }
    return spec?.global_constraints?.script_language || undefined
  } catch (err) {
    logger.warn(`[${projectId}] Failed to read script_language from spec: ${err}`)
    return undefined
  }
}

const TRANSCRIPT_PREVIEW_SESSION_SELECT = {
  phase: true,
  projectId: true,
  state: true,
  status: true,
  stateVersion: true,
  timeline: true,
} satisfies Prisma.UipSessionSelect

export type TranscriptVoicePreviewResponse = TtsPreviewResponse & {
  persistedAudioPath?: string
}

type TranscriptPreviewSession = Prisma.UipSessionGetPayload<{
  select: typeof TRANSCRIPT_PREVIEW_SESSION_SELECT
}>

export function assertTranscriptPreviewSessionActive(session: {
  phase?: null | string
  status?: string
}): void {
  if (session.status !== 'active') {
    throw new BadRequestException(
      `Cannot generate transcript voice preview: session is ${session.status}.`,
    )
  }
  // Refinement re-voices the transcript card too (narration can change
  // there), so the preview is allowed in refinement in addition to the script
  // authoring phases.
  if (
    session.phase !== 'bootstrap_script' &&
    session.phase !== 'script_review' &&
    session.phase !== 'refinement'
  ) {
    throw new BadRequestException(
      `Cannot generate transcript voice preview: session is in phase "${session.phase}", expected "bootstrap_script", "script_review", or "refinement".`,
    )
  }
}

export async function generateTranscriptVoicePreviewFn({
  assertAccess,
  input,
  loadSession,
  prisma,
  projectId,
  readTranscriptVoicePreviewEnabledFromSpec,
  voiceOverService,
}: {
  assertAccess: (projectId: string, mode: 'write') => Promise<void>
  input: TranscriptVoicePreviewDto
  loadSession: (
    projectId: string,
    select: typeof TRANSCRIPT_PREVIEW_SESSION_SELECT,
  ) => Promise<TranscriptPreviewSession>
  prisma: PrismaService
  projectId: string
  readTranscriptVoicePreviewEnabledFromSpec: (projectId: string) => Promise<boolean>
  voiceOverService: VoiceOverService
}): Promise<TranscriptVoicePreviewResponse> {
  await assertAccess(projectId, 'write')
  const session = await loadSession(projectId, TRANSCRIPT_PREVIEW_SESSION_SELECT)
  assertTranscriptPreviewSessionActive(session)

  const transcriptVoicePreviewEnabled = await readTranscriptVoicePreviewEnabledFromSpec(projectId)
  if (!transcriptVoicePreviewEnabled) {
    throw new BadRequestException('Transcript voice preview is not enabled for this session.')
  }

  const { persist, ...previewInput } = input
  const normalizedSpeed = normalizeTranscriptPreviewSpeed(input.speed)
  const promptPronunciationDict = extractPromptPronunciationDict(
    getPinnedUserInputFromTimeline(session.timeline),
  )
  const pronunciationDict = mergePronunciationDicts(
    promptPronunciationDict,
    previewInput.pronunciationDict,
  )
  // Set MiniMax language_boost from the planner's detected script language so numbers
  // are spoken in-locale. Undefined when unknown -> MiniMax auto-detection.
  // Also forward the RAW tag. The boost alone is lossy -- an unsupported language
  // resolves to undefined, which is indistinguishable from "unknown", so the preview the user
  // hears (and which confirm then reuses verbatim) was still synthesized by MiniMax.
  const scriptLanguage = await readScriptLanguageFromSpec(projectId)
  const languageBoost = resolveLanguageBoostFromScriptLanguage(scriptLanguage)
  const result = await voiceOverService.generateTtsPreview({
    ...previewInput,
    ...(pronunciationDict.length ? { pronunciationDict } : {}),
    ...(input.speed === undefined ? {} : { speed: normalizedSpeed }),
    ...(languageBoost ? { languageBoost } : {}),
    ...(scriptLanguage ? { scriptLanguage } : {}),
    elevenLabsPronunciationMode: previewInput.elevenLabsPronunciationMode ?? 'replace-text',
  })
  if (persist === false) {
    return result
  }

  const audioBuffer = Buffer.from(result.audioBase64, 'base64')
  const audioPath = buildTranscriptPreviewAudioPath(result.contentType)
  const storage = await createStorage(projectId)
  await storage.ensureDir('user-intent-planner/voice-preview')
  await storage.writeFile(audioPath, audioBuffer)

  await withSessionLock(prisma, session, { state: true }, ({ state }) => {
    const nextState: UipSessionState = {
      ...state,
      preview_voiceover: {
        audio_path: audioPath,
        audio_duration_seconds: result.audioDurationSeconds,
        byte_length: result.byteLength,
        content_type: result.contentType,
        generated_at: new Date().toISOString(),
        model: result.model,
        normalized_text: result.normalizedText,
        pronunciation_dict: result.pronunciationDict,
        provider: result.provider,
        resolved_voice_id: result.resolvedVoiceId,
        script_text: input.text,
        speed: normalizedSpeed,
        voice_id: result.voiceId,
      },
    }
    return {
      write: { state: nextState },
      changes: [{ kind: 'state', state: buildStatePatch(state, nextState) }],
    }
  })

  return {
    ...result,
    persistedAudioPath: audioPath,
  }
}

// The extension must match the bytes -- story mode's normalizeVoiceOverToMp3 keys
// off it, so a Gemini WAV written under a .mp3 name is copied through as if already mp3.
function buildTranscriptPreviewAudioPath(
  contentType: 'audio/mpeg' | 'audio/wav' = 'audio/mpeg',
): string {
  const extension = contentType === 'audio/wav' ? 'wav' : 'mp3'
  return `user-intent-planner/voice-preview/${Date.now()}-${randomUUID()}.${extension}`
}

function normalizeTranscriptPreviewSpeed(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  return Number(Math.min(2, Math.max(0.5, value)).toFixed(2))
}
