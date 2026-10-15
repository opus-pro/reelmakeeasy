import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { hashFileContent, isCacheEnabled } from '@reelmakeeasy/common/llm/llm-cache'
import { audioLlmRoute } from '@reelmakeeasy/llm'
import {
  buildVoiceProfileFromAnalysis,
  VoiceProfileAnalysisSchema,
} from '@shared/types/api/voice-profile'
import { z } from 'zod'

import type {
  AnalyzeLongTakeVoiceCharacterActivityParams,
  AnalyzeLongTakeVoiceCharacterActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'

import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  getVideoDurationSeconds,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_VOICE_CHARACTER_PATH } from './storage'

const VoiceCharacterSchema = z.object({
  voice_character: z
    .string()
    .describe(
      'A concise description of the voice characteristics for matching visual character generation',
    ),
  voice_profile: VoiceProfileAnalysisSchema.describe(
    'Structured voice metadata derived from the uploaded audio.',
  ),
})

export async function analyzeLongTakeVoiceCharacter(
  params: AnalyzeLongTakeVoiceCharacterActivityParams,
): Promise<AnalyzeLongTakeVoiceCharacterActivityResult> {
  const { agentHarnessRun, projectId, userId } = params
  // Codex and Claude Code can't hear audio. With either chosen in Setup, or running this
  // agent-mode video, pin the analysis to Gemini when its key is set, else skip it (no audio
  // download, no failing retries). This also covers the pre-voiceover workflow's Stage 3.
  const route = voiceCharacterRoute(agentHarnessRun)
  if (route === 'skip') {
    logger.info(
      `[long-take] Voice character analysis skipped ${formatLogFields({
        projectId,
        reason: "the AI writing this video can't hear audio and no Gemini key is set",
      })}`,
    )
    return { outputPath: '', voiceCharacter: '' }
  }
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      try {
        const { audioStoreUri, contentHash } = await prepareAudioSample({ projectId, storage })

        const pin = route === 'gemini' ? { llmProvider: 'gemini' as const } : {}
        const result = await JobContext.run({ projectId, userId, ...pin }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: [
                'gemini-2.5-flash-lite',
                'gemini-2.5-flash',
                'gemini-3.1-flash-lite',
                'gemini-3.5-flash',
              ],
              ignoreFallbackModel: true,
              prompt: buildVoiceCharacterAnalysisPrompt(),
              contents: [{ type: 'audio_url', audioUrl: audioStoreUri }],
              // Use audio content hash for cache key so different store addresses
              // with identical audio content produce the same cache key.
              ...(contentHash && {
                _devCacheContents: [{ type: 'audio_hash', hash: contentHash }],
              }),
              responseFormat: VoiceCharacterSchema,
              task: 'long-take-voice-character-analysis',
              temperature: 0,
            },
          }),
        )

        const voiceProfile = buildVoiceProfileFromAnalysis({
          analysis: result.voice_profile,
          sourceKind: 'uploaded_audio',
        })
        const output = {
          voice_character: result.voice_character,
          voice_profile: voiceProfile,
        }

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_VOICE_CHARACTER_PATH, output)

        logger.info(
          `[long-take] Voice character analysis completed ${formatLogFields({
            projectId,
            voiceCharacter: result.voice_character,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          outputPath: LONG_TAKE_VOICE_CHARACTER_PATH,
          voiceCharacter: result.voice_character,
          voiceProfile,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Voice character analysis failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

function buildVoiceCharacterAnalysisPrompt(): string {
  return `Analyze the voice in this audio. Describe the speaker's voice characteristics that would help generate a matching visual character for video production.

Include relevant traits such as:
- Gender (male/female)
- Estimated age range
- Voice qualities (e.g., deep, warm, energetic, husky, authoritative, gentle, magnetic)

Return both:
- voice_character: a concise single-string summary for downstream visual prompts
- voice_profile: structured metadata with perceivedGender, ageRange, tags, and rawDescription

Rules:
- If any trait is uncertain, use unknown or omit it rather than guessing.
- Base perceivedGender on vocal presentation only, not identity.
- Focus only on what is clearly perceivable from the voice.
- Keep tags short, lower-case, and non-redundant.`
}

/**
 * Download the voiceover audio to derive a stable content hash while sending the
 * full track to Gemini. Mixed music tracks can have misleading intros or
 * ambiguous short windows; full-song analysis is more stable for singer gender.
 */
async function prepareAudioSample(params: {
  projectId: string
  storage: ReturnType<typeof createLongTakeStorage>
}): Promise<{ audioStoreUri: string; contentHash: string | undefined }> {
  const { projectId, storage } = params
  const voiceOverUri = storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath)

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `long-take-voice-char-${projectId}-`),
  )

  try {
    const localFullPath = path.join(tempDir, 'voice_over.mp3')
    await downloadAssetToLocal(voiceOverUri, localFullPath)
    await getVideoDurationSeconds(localFullPath)

    const contentHash = isCacheEnabled() ? await hashFileContent(localFullPath) : undefined
    return { audioStoreUri: voiceOverUri, contentHash }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

/**
 * Where the analysis goes (see `audioLlmRoute`). An agent-mode run's calls go to its Codex or
 * Claude Code chat whatever AI is chosen in Setup, so it takes their route: Gemini when its key
 * is set, else skip.
 */
function voiceCharacterRoute(agentHarnessRun: boolean | undefined): 'default' | 'gemini' | 'skip' {
  if (!agentHarnessRun) return audioLlmRoute()
  return process.env['GEMINI_API_KEY']?.trim() ? 'gemini' : 'skip'
}
