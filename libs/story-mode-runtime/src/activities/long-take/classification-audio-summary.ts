import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { hashFileContent, isCacheEnabled } from '@reelmakeeasy/common/llm/llm-cache'
import { audioLlmRoute } from '@reelmakeeasy/llm'
import { z } from 'zod'

import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'

import { downloadAssetToLocal, formatError, formatLogFields, logger } from './common'
import { createLongTakeStorage } from './storage'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

/**
 * "Gemini hears the audio" signal for prompt classification.
 *
 * Background: classifyLongTakePrompt historically derives is_music /
 * music_genre from the transcript TEXT only. Lyrics text is a weak signal: a
 * rap acapella and a sung pop chorus can read identically on paper, and a
 * spoken poem can look like lyrics. The reworked classification prompt
 * (buildLongTakeClassificationPrompt(transcript, audioAnalysis?)) accepts an
 * authoritative "AUDIO TRACK ANALYSIS" section. This module produces the
 * string that fills that section by having Gemini LISTEN to the uploaded track.
 *
 * Why an LLM audio attachment (not the python gemini_audio.py): the
 * story-mode-runtime already attaches audio to a Gemini completion in
 * voice-character.ts via contents: [{ type: 'audio_url', audioUrl }] on
 * runLongTakeCompletionWithRecord. The python module is an OFFLINE/batch
 * analyzer with no activity binding and no call site in this runtime,
 * so reusing the in-process multimodal path is the lower-risk option.
 */
/** @internal exported for the strict structured-output guard test. */
export const AudioTrackVerdictSchema = z.object({
  // z.boolean() (NOT coerce): the model emits a JSON true/false literal, and
  // string coercion would read "false" as true.
  is_music: z.boolean(),
  // Free string on purpose: the classification prompt maps a heard genre onto
  // its own 10-value enum. We do not constrain it here.
  // `.nullable().optional()` (not bare `.optional()`): OpenAI strict structured
  // outputs reject an optional-only field, which throws client-side in
  // zodResponseFormat and kills the whole fallback chain. This is a
  // pre-voiceover activity UIP-v2 spawns, so keep it strict-safe even though its
  // model chain is Gemini-only today. All consumers here read these null-safely.
  music_genre: z.string().nullable().optional(),
  music_subgenre: z.string().nullable().optional(),
  mood: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).nullable().optional(),
})

type AudioTrackVerdict = z.infer<typeof AudioTrackVerdictSchema>

function buildAudioTrackAnalysisPrompt(): string {
  return `You are an audio classifier. LISTEN to the attached audio track and judge whether it is MUSIC (a song that is sung/performed) versus SPOKEN content (narration, voiceover, podcast, dialogue, a read ad, a spoken poem).

Return ONLY a JSON object with these keys (no prose, no markdown fences):
{"is_music": true or false, "music_genre": "<broad genre or empty>", "music_subgenre": "<short or empty>", "mood": "<short or empty>", "description": "<= 15 words on what it is>", "confidence": 0.0-1.0}

Rules:
- is_music = false for spoken narration / voiceover / podcast / dialogue / a read ad / spoken-word poetry. When false, set music_genre = "" and let confidence describe how sure you are about the music-vs-speech call.
- When is_music = true, music_genre should be a broad musical style heard in the track (e.g. Hip-Hop / Rap, Pop, R&B / Soul, Rock, Country, Gospel, Latin, Electronic, Folk / Acoustic, or another short label). Base it on the SOUND, not the lyrics topic.
- music_subgenre is a free short label (e.g. Trap, House, Gospel, Lullaby).
- confidence is your confidence in is_music.`
}

/**
 * Produce the audioAnalysis summary for prompt classification by having Gemini
 * listen to the project's voiceover/uploaded audio in storage.
 *
 * Returns undefined when there is no audio to analyze or the analysis fails, so
 * the classifier falls back to the existing text-only behavior. NEVER throws:
 * this is a best-effort enrichment, not a required step (mkdtemp and URI
 * resolution are inside the try so even those failures degrade to text-only).
 *
 * NOTE: this is a plain async helper that issues an LLM call via
 * runLongTakeCompletionWithRecord. It is intended to be invoked from INSIDE
 * the classifyLongTakePrompt activity body, not from workflow code.
 */
export async function buildClassificationAudioAnalysis(params: {
  /**
   * Optional explicit audio location. Defaults to the canonical voiceover mp3
   * (story_loader/audio/voice_over.mp3), which exists after the voiceover stage
   * has run. When the file is absent the helper returns undefined.
   */
  audioStoreUri?: string
  projectId: string
  userId?: string
}): Promise<string | undefined> {
  const { audioStoreUri, projectId, userId } = params
  // Codex and Claude Code can't hear audio: with either chosen in Setup, pin the call to Gemini
  // when its key is set, else classify from the text alone without downloading anything.
  const route = audioLlmRoute()
  if (route === 'skip') {
    logger.info(
      `[long-take] Classification audio analysis skipped, using text-only ${formatLogFields({
        projectId,
        reason: "the AI chosen in Setup can't hear audio",
      })}`,
    )
    return undefined
  }
  let tempDir: string | undefined
  let resolvedUri: string | undefined
  try {
    const storage = createLongTakeStorage(projectId)
    const audioUri = resolveAudioUri(storage, audioStoreUri)
    resolvedUri = audioUri
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `long-take-class-audio-${projectId}-`),
    )
    // Existence + cache-key probe: download a local copy. If the voiceover mp3
    // has not been written yet, the download throws and we fall back to
    // text-only below.
    const localPath = path.join(tempDir, 'classification_audio.mp3')
    await downloadAssetToLocal(audioUri, localPath)
    const contentHash = isCacheEnabled() ? await hashFileContent(localPath) : undefined

    const pin = route === 'gemini' ? { llmProvider: 'gemini' as const } : {}
    const verdict = await JobContext.run({ projectId, userId, ...pin }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId,
        options: {
          // gemini-3.1-pro-preview kept 504ing on full-track audio (~120s
          // DEADLINE_EXCEEDED x3 SDK retries, ~6 min total), blowing the parent
          // UIP session's 5-min script-ready deadline; flash answers in seconds.
          models: ['gemini-3.5-flash', 'gemini-2.5-pro'],
          ignoreFallbackModel: true,
          prompt: buildAudioTrackAnalysisPrompt(),
          contents: [{ type: 'audio_url', audioUrl: audioUri }],
          ...(contentHash && {
            _devCacheContents: [{ type: 'audio_hash', hash: contentHash }],
          }),
          responseFormat: AudioTrackVerdictSchema,
          task: 'long-take-prompt-classification-audio',
          temperature: 0,
          timeout: 120_000,
        },
      }),
    )

    const summary = formatAudioAnalysisSummary(verdict)
    logger.info(
      `[long-take] Classification audio analysis ready ${formatLogFields({
        projectId,
        isMusic: verdict.is_music,
        heardGenre: verdict.music_genre,
        hasSummary: Boolean(summary),
      })}`,
    )
    return summary
  } catch (error) {
    // Best-effort: any failure (missing audio, model error) falls back to
    // text-only classification with no behavior change.
    logger.info(
      `[long-take] Classification audio analysis unavailable, using text-only ${formatLogFields({
        projectId,
        audioUri: resolvedUri,
        err: formatError(error),
      })}`,
    )
    return undefined
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

// Smaller models occasionally fall into token repetition loops and emit a
// multi-thousand-word value for a "short label" field (observed with
// gemini-3.5-flash on music_subgenre). The summary feeds LLM prompts and, on
// the uploaded-music path, the user-visible planning script, so clamp each
// field instead of trusting the prompt's length instructions.
const MAX_LABEL_FIELD_CHARS = 80
const MAX_DESCRIPTION_FIELD_CHARS = 200

function clampField(value: string, maxChars: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars).trimEnd()
}

/**
 * Render the verdict into the compact string the classification prompt expects
 * in its audioAnalysis param. Returns undefined when the verdict carries no
 * usable signal so the caller passes undefined (text-only, unchanged behavior).
 */
export function formatAudioAnalysisSummary(verdict: AudioTrackVerdict): string | undefined {
  const lines: string[] = []
  lines.push(`is_music: ${verdict.is_music ? 'true' : 'false'}`)
  if (verdict.is_music) {
    if (verdict.music_genre?.trim()) {
      lines.push(`heard_genre: ${clampField(verdict.music_genre, MAX_LABEL_FIELD_CHARS)}`)
    }
    if (verdict.music_subgenre?.trim()) {
      lines.push(`heard_subgenre: ${clampField(verdict.music_subgenre, MAX_LABEL_FIELD_CHARS)}`)
    }
  }
  if (verdict.mood?.trim()) {
    lines.push(`mood: ${clampField(verdict.mood, MAX_LABEL_FIELD_CHARS)}`)
  }
  if (verdict.description?.trim()) {
    lines.push(`heard_description: ${clampField(verdict.description, MAX_DESCRIPTION_FIELD_CHARS)}`)
  }
  if (typeof verdict.confidence === 'number') {
    lines.push(`audio_confidence: ${verdict.confidence.toFixed(2)}`)
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}

function resolveAudioUri(
  storage: ReturnType<typeof createLongTakeStorage>,
  audioStoreUri?: string,
): string {
  const candidate = audioStoreUri?.trim()
  if (!candidate) {
    return storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath)
  }
  if (
    isStoreUri(candidate) ||
    candidate.startsWith('http://') ||
    candidate.startsWith('https://')
  ) {
    return candidate
  }
  // Storage-relative path (e.g. 'story_loader/audio/voice_over.mp3').
  return storage.getFullPath(candidate)
}
