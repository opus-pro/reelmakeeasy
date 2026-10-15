import { JobContext } from '@reelmakeeasy/common/job-context'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'

import type {
  GenerateLongTakeExpertsAssetManagerActivityParams,
  GenerateLongTakeExpertsAssetManagerActivityResult,
  GenerateLongTakeExpertsAssetManifestActivityParams,
  GenerateLongTakeExpertsAssetManifestActivityResult,
  GenerateLongTakeExpertsBeatSheetActivityParams,
  GenerateLongTakeExpertsBeatSheetActivityResult,
  GenerateLongTakeExpertsParallelActivityParams,
  GenerateLongTakeExpertsParallelActivityResult,
  GenerateLongTakeExpertsWorldBibleActivityParams,
  GenerateLongTakeExpertsWorldBibleActivityResult,
} from '../../workflows/long-take/types'
import {
  auditLongTakeBeatSheet,
  buildLongTakeAssetManagerFallback,
  buildLongTakeAssetManifestFallback,
  buildLongTakeBeatSheetFallback,
  buildLongTakeWorldBibleFallback,
  LONG_TAKE_ASSET_MANAGER_PATH,
  LONG_TAKE_ASSET_MANIFEST_PATH,
  LONG_TAKE_BEAT_SHEET_PATH,
  LONG_TAKE_EXPERTS_DIR,
  LONG_TAKE_WORLD_BIBLE_PATH,
  type LongTakeAssetManagerModelOutput,
  LongTakeAssetManagerModelOutputSchema,
  LongTakeAssetManifestModelOutputSchema,
  type LongTakeBeatSheetModelOutput,
  LongTakeBeatSheetModelOutputSchema,
  type LongTakeBeatSheetOutput,
  type LongTakeWorldBibleModelOutput,
  LongTakeWorldBibleModelOutputSchema,
  normalizeLongTakeAssetManagerOutput,
  normalizeLongTakeAssetManifestOutput,
  normalizeLongTakeBeatSheetOutput,
  normalizeLongTakeWorldBibleOutput,
} from '../long-take-experts-analysis'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeAssetManagerExpertPrompt } from '../prompts/long-take-asset-manager-expert-prompt'
import { buildLongTakeAssetManifestExpertPrompt } from '../prompts/long-take-asset-manifest-expert-prompt'
import { buildLongTakeBeatSheetExpertPrompt } from '../prompts/long-take-beat-sheet-expert-prompt'
import {
  buildLongTakeWorldBibleEnrichedExpertPrompt,
  buildLongTakeWorldBibleExpertPrompt,
} from '../prompts/long-take-world-bible-expert-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  runLongTakeExpertStep,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import {
  buildUserAssetImageContents,
  createLongTakeStorage,
  LONG_TAKE_VOICE_CHARACTER_PATH,
  readLongTakeAssetManifestOutput,
  readLongTakeExpertsScript,
  readLongTakeExpertsUserAssetContext,
  readLongTakeWorldBibleOutput,
} from './storage'

export async function generateLongTakeExpertsAssetManager(
  params: GenerateLongTakeExpertsAssetManagerActivityParams,
): Promise<GenerateLongTakeExpertsAssetManagerActivityResult> {
  const { pipelineContext, projectId, promptRoute, styleText, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_EXPERTS_DIR)

      const writeFallback = async () => {
        const fallback = buildLongTakeAssetManagerFallback()
        await storage.writeJsonFile(LONG_TAKE_ASSET_MANAGER_PATH, fallback)
        return {
          outputPath: LONG_TAKE_ASSET_MANAGER_PATH,
          promptCount: fallback.prompts.length,
          usedFallback: true,
        }
      }

      try {
        const manifest = await readLongTakeAssetManifestOutput(storage)
        if (!manifest.asset_manifest.length) {
          const empty = buildLongTakeAssetManagerFallback()
          await storage.writeJsonFile(LONG_TAKE_ASSET_MANAGER_PATH, empty)
          return {
            outputPath: LONG_TAKE_ASSET_MANAGER_PATH,
            promptCount: empty.prompts.length,
            usedFallback: false,
          }
        }

        const step = await runLongTakeExpertStep<
          LongTakeAssetManagerModelOutput,
          ReturnType<typeof normalizeLongTakeAssetManagerOutput>
        >({
          fallback: buildLongTakeAssetManagerFallback,
          normalize: (modelOutput) =>
            normalizeLongTakeAssetManagerOutput({
              manifest,
              modelOutput,
            }),
          projectId,
          prompt: await buildLongTakeAssetManagerExpertPrompt({
            assetManifestJson: JSON.stringify(manifest, null, 2),
            promptRoute,
            styleText,
          }),
          responseFormat: LongTakeAssetManagerModelOutputSchema,
          task: 'long-take-experts-asset-manager',
          userId,
        })
        await storage.writeJsonFile(LONG_TAKE_ASSET_MANAGER_PATH, step.output)
        return {
          outputPath: LONG_TAKE_ASSET_MANAGER_PATH,
          promptCount: step.output.prompts.length,
          usedFallback: step.usedFallback,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Asset manager expert failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return writeFallback()
      }
    }),
  )
}

export async function generateLongTakeExpertsAssetManifest(
  params: GenerateLongTakeExpertsAssetManifestActivityParams,
): Promise<GenerateLongTakeExpertsAssetManifestActivityResult> {
  const { pipelineContext, projectId, promptRoute, script, styleText, userEmail, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userEmail, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_EXPERTS_DIR)

      const writeFallback = async () => {
        const fallback = buildLongTakeAssetManifestFallback()
        await storage.writeJsonFile(LONG_TAKE_ASSET_MANIFEST_PATH, fallback)
        return {
          manifestCount: fallback.asset_manifest.length,
          outputPath: LONG_TAKE_ASSET_MANIFEST_PATH,
          usedFallback: true,
        }
      }

      try {
        const resolvedScript = await readLongTakeExpertsScript(storage, script)
        if (!resolvedScript) {
          return writeFallback()
        }
        const userAssetContext = await readLongTakeExpertsUserAssetContext(storage)

        let assetIntentNotes: string[] = []
        try {
          const notesPayload = await storage.readJsonFile<string[] | { notes?: string[] }>(
            'long_take/visual_notes.json',
          )
          const allNotes = Array.isArray(notesPayload) ? notesPayload : (notesPayload?.notes ?? [])
          assetIntentNotes = allNotes.filter(
            (note): note is string =>
              typeof note === 'string' && note.trim().startsWith('[ASSET INTENT]'),
          )
        } catch {
          // visual notes not available, proceed without them
        }

        const userSimulationParameters = styleText?.trim() || 'None'
        let worldBibleJson: string | undefined
        try {
          const worldBible = await readLongTakeWorldBibleOutput(storage)
          worldBibleJson = JSON.stringify(worldBible, null, 2)
        } catch {
          // world bible not available, proceed without it
        }
        let voiceCharacter: null | string = null
        try {
          const voiceCharacterData = await storage.readJsonFile<{ voice_character: string }>(
            LONG_TAKE_VOICE_CHARACTER_PATH,
          )
          voiceCharacter = voiceCharacterData?.voice_character || null
        } catch {
          // voice character not available, proceed without it
        }
        const prompt = await buildLongTakeAssetManifestExpertPrompt({
          assetIntentNotes,
          promptRoute,
          script: resolvedScript,
          userAssetContext,
          userSimulationParameters,
          voiceCharacter,
          worldBibleJson,
        })
        const userImageContents = buildUserAssetImageContents(userAssetContext.files)
        const modelOutput = await JobContext.run({ projectId, userEmail, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              ...(userImageContents.length > 0 && { contents: userImageContents }),
              models: ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'],
              prompt,
              responseFormat: LongTakeAssetManifestModelOutputSchema,
              task: 'long-take-experts-asset-manifest',
              temperature: 0,
            },
          }),
        )
        const normalizedOutput = normalizeLongTakeAssetManifestOutput({
          modelOutput,
          strictUserFileBinding: true,
          validFileIds: new Set(userAssetContext.files.map((file) => file.file_id)),
        })
        await storage.writeJsonFile(LONG_TAKE_ASSET_MANIFEST_PATH, normalizedOutput)
        const contextSummary = normalizedOutput.asset_manifest
          .map(
            (a: { asset_id: string; keyword: string; source?: null | string; type: string }) =>
              `${a.asset_id} (${a.type}${a.source === 'USER_FILE' ? ', USER_FILE' : ''})`,
          )
          .join(' | ')
        return {
          contextSummary: contextSummary || undefined,
          manifestCount: normalizedOutput.asset_manifest.length,
          outputPath: LONG_TAKE_ASSET_MANIFEST_PATH,
          usedFallback: false,
        }
      } catch (error) {
        logger.error(
          `[long-take] Asset manifest expert failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

export async function generateLongTakeExpertsBeatSheet(
  params: GenerateLongTakeExpertsBeatSheetActivityParams,
): Promise<GenerateLongTakeExpertsBeatSheetActivityResult> {
  const {
    cameraStyle,
    projectId,
    promptRoute = 'general',
    transitionVideoModel,
    transcriptPath,
    userId,
  } = params
  // Planning is model-agnostic: every model plans against the same
  // 10s max beat duration.
  const maxBeatDurationSeconds = 10
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_EXPERTS_DIR)

      const writeFallback = async () => {
        const fallback = buildLongTakeBeatSheetFallback()
        await storage.writeJsonFile(LONG_TAKE_BEAT_SHEET_PATH, fallback)
        return {
          beatCount: fallback.beat_sheet.length,
          outputPath: LONG_TAKE_BEAT_SHEET_PATH,
          usedFallback: true,
        }
      }

      try {
        if (!transcriptPath) {
          logger.warn(
            `[long-take] Beat sheet skipped: no transcript path ${formatLogFields({ projectId })}`,
          )
          return writeFallback()
        }

        const transcript = await storage.readJsonFile<TranscriptData>(transcriptPath)
        const transcriptWords = flattenTranscriptWordsForAudit(transcript)
        const timestampedTranscript = buildTimestampedTranscript(transcript)

        if (!timestampedTranscript) {
          logger.warn(
            `[long-take] Beat sheet skipped: empty transcript ${formatLogFields({
              projectId,
              reason: 'no word-level timestamps',
              segmentCount: transcript.segments?.length ?? 0,
              language: transcript.language,
            })}`,
          )
          throw ApplicationFailure.nonRetryable(
            'Story Mode requires audio with speech or lyrics. Instrumental or music-only audio is not supported.',
            'NON_SPEECH_AUDIO',
          )
        }

        const MAX_ATTEMPTS = 3
        let lastModelOutput: LongTakeBeatSheetModelOutput | null = null
        let lastAuditCorrectedTimeRanges: Array<null | { end: number; start: number }> | undefined
        let textAudited = false
        let timeAudited = false
        let auditPassed = false
        const auditFeedbackHistory: NonNullable<
          Parameters<typeof buildLongTakeBeatSheetExpertPrompt>[0]['auditFeedback']
        > = []

        logger.info(
          `[long-take] Beat sheet prompt route resolved ${formatLogFields({
            projectId,
            promptRoute,
          })}`,
        )

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const prompt = buildLongTakeBeatSheetExpertPrompt({
            cameraStyle,
            timestampedTranscript,
            promptRoute,
            transitionVideoModel,
            auditFeedback: auditFeedbackHistory.length > 0 ? auditFeedbackHistory : undefined,
          })
          const step = await runLongTakeExpertStep<
            LongTakeBeatSheetModelOutput,
            LongTakeBeatSheetModelOutput
          >({
            fallback: () => ({ beat_sheet: [] }),
            normalize: (m) => m,
            projectId,
            prompt,
            responseFormat: LongTakeBeatSheetModelOutputSchema,
            task: 'long-take-experts-beat-sheet',
            userId,
          })

          if (step.usedFallback) {
            break
          }

          lastModelOutput = step.output

          const forAudit = buildBeatSheetForAudit(step.output)
          const audit = auditLongTakeBeatSheet(forAudit, transcriptWords, {
            maxDurationSeconds: maxBeatDurationSeconds,
          })
          textAudited = audit.textOk
          timeAudited = audit.timeOk
          auditPassed = audit.textOk && audit.timeOk

          // textOk=true means correctedTimeRanges are accurate (derived from transcript).
          // Save them regardless of timeOk - timeOk only judges [2, 10s] constraint.
          if (audit.textOk) {
            lastAuditCorrectedTimeRanges = audit.correctedTimeRanges
          }

          if (auditPassed) {
            logger.info(
              `[long-take] Beat sheet audit passed ${formatLogFields({
                projectId,
                attempt: attempt + 1,
                beatCount: forAudit.beat_sheet.length,
              })}`,
            )
            break
          }

          if (attempt < MAX_ATTEMPTS - 1) {
            auditFeedbackHistory.push({
              attempt: attempt + 1,
              reasons: audit.reasons,
              previousOutput: step.output.beat_sheet.map((b) => ({
                beat_id: b.beat_id ?? undefined,
                segment_text: b.segment_text,
                duration: b.duration ?? undefined,
              })),
            })
            logger.warn(
              `[long-take] Beat sheet audit failed, retrying ${formatLogFields({
                projectId,
                attempt: attempt + 1,
                textOk: audit.textOk,
                timeOk: audit.timeOk,
                reasons: audit.reasons.slice(0, 3),
              })}`,
            )
          } else {
            logger.warn(
              `[long-take] Beat sheet audit failed after all attempts ${formatLogFields({
                projectId,
                attempts: MAX_ATTEMPTS,
                textAudited,
                timeAudited,
                reasons: audit.reasons.slice(0, 3),
              })}`,
            )
          }
        }

        if (!lastModelOutput) {
          return writeFallback()
        }

        const normalizedOutput = normalizeLongTakeBeatSheetOutput({
          modelOutput: lastModelOutput,
          auditPassed,
          // Pass correctedTimeRanges whenever textOk=true (accurate regardless of timeOk)
          correctedTimeRanges: textAudited ? lastAuditCorrectedTimeRanges : undefined,
          textAudited: !auditPassed && textAudited,
        })

        await storage.writeJsonFile(LONG_TAKE_BEAT_SHEET_PATH, normalizedOutput)
        return {
          beatCount: normalizedOutput.beat_sheet.length,
          outputPath: LONG_TAKE_BEAT_SHEET_PATH,
          textAudited,
          timeAudited,
          usedFallback: false,
        }
      } catch (error) {
        rethrowApplicationFailure(error)
        logger.warn(
          `[long-take] Beat sheet expert failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return writeFallback()
      }
    }),
  )
}

export async function generateLongTakeExpertsParallel(
  params: GenerateLongTakeExpertsParallelActivityParams,
): Promise<GenerateLongTakeExpertsParallelActivityResult> {
  const {
    cameraStyle,
    pipelineContext,
    projectId,
    promptRoute,
    script,
    skipBeatSheet = false,
    styleText,
    transitionVideoModel,
    transcriptPath,
    userEmail,
    userId,
  } = params

  const withSubSpan = <T>(_activityName: string, fn: () => Promise<T>): Promise<T> => fn()

  // Music-video route: the beat sheet is produced from the music grid (buildLongTakeMusicBeatSheet)
  // before this runs, so skip the text-driven beat sheet here. The placeholder result is ignored by
  // the caller in that path.
  const beatSheetTask: Promise<GenerateLongTakeExpertsBeatSheetActivityResult> = skipBeatSheet
    ? Promise.resolve({ beatCount: 0, outputPath: LONG_TAKE_BEAT_SHEET_PATH, usedFallback: false })
    : withSubSpan('generateLongTakeExpertsBeatSheet', () =>
        generateLongTakeExpertsBeatSheet({
          cameraStyle,
          projectId,
          promptRoute,
          script,
          transitionVideoModel,
          transcriptPath,
          userId,
        }),
      )

  const [beatSheet, worldBible, assetManifest] = await Promise.all([
    beatSheetTask,
    withSubSpan('generateLongTakeExpertsWorldBible', () =>
      generateLongTakeExpertsWorldBible({
        pipelineContext,
        projectId,
        promptRoute,
        script,
        styleText,
        userId,
      }),
    ),
    withSubSpan('generateLongTakeExpertsAssetManifest', () =>
      generateLongTakeExpertsAssetManifest({
        pipelineContext,
        projectId,
        promptRoute,
        script,
        styleText,
        userEmail,
        userId,
      }),
    ),
  ])
  return { assetManifest, beatSheet, worldBible }
}

export async function generateLongTakeExpertsWorldBible(
  params: GenerateLongTakeExpertsWorldBibleActivityParams,
): Promise<GenerateLongTakeExpertsWorldBibleActivityResult> {
  const {
    pipelineContext,
    projectId,
    promptRoute,
    script,
    styleText,
    transitionVideoModel,
    userId,
  } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_EXPERTS_DIR)

      const writeFallback = async () => {
        await storage.writeJsonFile(LONG_TAKE_WORLD_BIBLE_PATH, buildLongTakeWorldBibleFallback())
        return {
          outputPath: LONG_TAKE_WORLD_BIBLE_PATH,
          usedFallback: true,
        }
      }

      try {
        const resolvedScript = await readLongTakeExpertsScript(storage, script)
        if (!resolvedScript) {
          return writeFallback()
        }
        const userAssetContext = await readLongTakeExpertsUserAssetContext(storage)
        const hasEnrichedContext =
          pipelineContext?.some((c) => c.name === 'Intent Analysis') &&
          pipelineContext?.some((c) => c.name === 'Genre Analysis')

        const worldBiblePrompt = hasEnrichedContext
          ? buildLongTakeWorldBibleEnrichedExpertPrompt({
              promptRoute,
              script: resolvedScript,
              transitionVideoModel,
              userAssetContext,
            })
          : buildLongTakeWorldBibleExpertPrompt({
              promptRoute,
              script: resolvedScript,
              transitionVideoModel,
              userAssetContext,
              userSimulationParameters: styleText?.trim() || 'None',
            })

        const step = await runLongTakeExpertStep<
          LongTakeWorldBibleModelOutput,
          ReturnType<typeof normalizeLongTakeWorldBibleOutput>
        >({
          fallback: buildLongTakeWorldBibleFallback,
          normalize: (modelOutput) => normalizeLongTakeWorldBibleOutput({ modelOutput }),
          projectId,
          prompt: worldBiblePrompt,
          responseFormat: LongTakeWorldBibleModelOutputSchema,
          task: 'long-take-experts-world-bible',
          userId,
        })
        await storage.writeJsonFile(LONG_TAKE_WORLD_BIBLE_PATH, step.output)
        const wb = step.output as {
          thematic_core?: string
          visual_strategy?: { cinematic_sandbox?: string }
        }
        const contextParts = [
          wb.visual_strategy?.cinematic_sandbox
            ? `Sandbox: ${wb.visual_strategy.cinematic_sandbox}`
            : '',
          wb.thematic_core ? `Theme: ${wb.thematic_core}` : '',
        ].filter(Boolean)
        return {
          contextSummary: contextParts.join(' | ') || undefined,
          outputPath: LONG_TAKE_WORLD_BIBLE_PATH,
          usedFallback: step.usedFallback,
        }
      } catch (error) {
        logger.warn(
          `[long-take] World bible expert failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return writeFallback()
      }
    }),
  )
}

function buildBeatSheetForAudit(
  modelOutput: LongTakeBeatSheetModelOutput,
): LongTakeBeatSheetOutput {
  return {
    beat_sheet: modelOutput.beat_sheet
      .filter((item) => item.segment_text?.trim())
      .map((item, i) => ({
        beat_id: i + 1,
        segment_text: item.segment_text.trim(),
        time_range: item.time_range
          ? { start: item.time_range.start, end: item.time_range.end }
          : undefined,
      })),
  }
}

function buildTimestampedTranscript(transcript: TranscriptData): string {
  const lines: string[] = []
  for (const segment of transcript.segments || []) {
    const words = segment.words || []
    if (words.length === 0) {
      continue
    }
    const parts = words.map((w) => `${w.word}(${w.end.toFixed(1)}s)`)
    lines.push(parts.join(' '))
  }
  return lines.join('\n')
}

function flattenTranscriptWordsForAudit(transcript: TranscriptData): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const segment of transcript.segments || []) {
    for (const word of segment.words || []) {
      words.push(word)
    }
  }
  return words
}

function rethrowApplicationFailure(error: unknown): void {
  if (error instanceof ApplicationFailure) {
    throw error
  }
}
