import { JobContext } from '@reelmakeeasy/common/job-context'

import type {
  AnalyzeLongTakeUserAssetsActivityParams,
  AnalyzeLongTakeUserAssetsActivityResult,
  AnalyzeLongTakeUserAssetUnderstandingActivityParams,
  AnalyzeLongTakeUserAssetUnderstandingActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import {
  buildLongTakeUserAssetsAnalysisFallback,
  LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
  type LongTakeUserAssetsAnalysisModelOutput,
  LongTakeUserAssetsAnalysisModelOutputSchema,
  normalizeLongTakeUserAssetsAnalysisOutput,
} from '../long-take-user-assets-analysis'
import {
  buildLongTakeUserAssetUnderstandingFallback,
  LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
  type LongTakeUserAssetUnderstandingModelOutput,
  LongTakeUserAssetUnderstandingModelResponseSchema,
  type LongTakeUserAssetUnderstandingOutput,
  normalizeLongTakeUserAssetUnderstandingModelOutput,
} from '../long-take-user-assets-understanding'
import { buildLongTakeUserAssetUnderstandingPrompt } from '../prompts/long-take-user-asset-understanding-prompt'
import { buildLongTakeUserAssetsAnalysisPrompt } from '../prompts/long-take-user-assets-analysis-prompt'

import {
  formatError,
  formatLogFields,
  getImageConcurrency,
  logger,
  mapWithConcurrency,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import {
  createLongTakeStorage,
  readLongTakeExpertsScript,
  readLongTakeUserAssetUnderstandingCatalogForAnalysis,
} from './storage'
import { buildUserAssetUnderstandingImageContent } from './user-asset-image'
import {
  loadUipAssetDescriptionMap,
  uipDescriptionToModelOutput,
} from './user-asset-understanding-seed'

export async function analyzeLongTakeUserAssets(
  params: AnalyzeLongTakeUserAssetsActivityParams,
): Promise<AnalyzeLongTakeUserAssetsActivityResult> {
  const { pipelineContext, projectId, script, userAssetCatalog, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take')

      try {
        const resolvedScript = await readLongTakeExpertsScript(storage, script)
        const userAssetUnderstandingCatalog =
          await readLongTakeUserAssetUnderstandingCatalogForAnalysis(storage)
        const prompt = await buildLongTakeUserAssetsAnalysisPrompt({
          script: resolvedScript,
          userAssetUnderstandingCatalog,
          userAssetCatalog,
        })
        const modelOutput: LongTakeUserAssetsAnalysisModelOutput = await JobContext.run(
          { projectId, userId },
          async () =>
            runLongTakeCompletionWithRecord({
              projectId,
              userId,
              options: {
                models: ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'],
                prompt,
                responseFormat: LongTakeUserAssetsAnalysisModelOutputSchema,
                task: 'long-take-user-assets-analysis',
                temperature: 0,
              },
            }),
        )

        const normalized = normalizeLongTakeUserAssetsAnalysisOutput({
          catalog: userAssetCatalog,
          modelOutput,
        })

        await storage.writeJsonFile(LONG_TAKE_USER_ASSETS_ANALYSIS_PATH, normalized)

        logger.info(
          `[long-take] User assets analysis saved ${formatLogFields({
            projectId,
            fileCount: normalized.files.length,
            matched: normalized.summary.matched,
            unresolved: normalized.summary.unresolved,
            path: LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
            scriptLength: resolvedScript.length,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        const contextParts: string[] = []
        if (normalized.characters?.length) {
          const names = normalized.characters.map((c: { name: string }) => c.name).join(', ')
          contextParts.push(`Characters: ${names}`)
        }
        if (normalized.objects?.length) {
          const items = normalized.objects.map((o: { file_refs?: string[]; name: string }) => {
            const refs = o.file_refs?.length ? ` -> ${o.file_refs.join(', ')}` : ''
            return o.name + refs
          })
          contextParts.push(`Objects: ${items.join(', ')}`)
        }

        return {
          contextSummary: contextParts.join(' | ') || undefined,
          fileCount: normalized.files.length,
          matchedCount: normalized.summary.matched,
          outputPath: LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
          unresolvedCount: normalized.summary.unresolved,
        }
      } catch (error) {
        const fallback = buildLongTakeUserAssetsAnalysisFallback()
        await storage.writeJsonFile(LONG_TAKE_USER_ASSETS_ANALYSIS_PATH, fallback)
        logger.warn(
          `[long-take] User assets analysis failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
            path: LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
          })}`,
        )
        return {
          fileCount: 0,
          matchedCount: 0,
          outputPath: LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
          unresolvedCount: 0,
        }
      }
    }),
  )
}

export async function analyzeLongTakeUserAssetUnderstanding(
  params: AnalyzeLongTakeUserAssetUnderstandingActivityParams,
): Promise<AnalyzeLongTakeUserAssetUnderstandingActivityResult> {
  const { pipelineContext, projectId, userAssetCatalog, userId } = params
  return withLongTakeContext({ pipelineContext, projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take')

      if (!userAssetCatalog.length) {
        const fallback = buildLongTakeUserAssetUnderstandingFallback([])
        await storage.writeJsonFile(LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH, fallback)
        return {
          analyzedCount: 0,
          failedCount: 0,
          outputPath: LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
        }
      }

      try {
        // Reuse UIP-v2's per-image captions where present: on the UIP
        // fast path describe_uploaded_images already captioned these uploads, so
        // seeding from that artifact skips the redundant long-take vision call
        // (the one that tends to time out). Best-effort -- an
        // empty map (classic path / no uploads) means every asset uses the model.
        const uipDescriptions = await loadUipAssetDescriptionMap(storage)
        const seededCount = userAssetCatalog.filter((item) =>
          uipDescriptions.has(item.fileId),
        ).length
        const concurrency = getImageConcurrency(8)
        const files = await mapWithConcurrency(userAssetCatalog, concurrency, async (item) => {
          try {
            const seeded = uipDescriptions.get(item.fileId)
            if (seeded) {
              return normalizeLongTakeUserAssetUnderstandingModelOutput({
                catalogItem: item,
                modelOutput: uipDescriptionToModelOutput(seeded),
              })
            }
            const prompt = buildLongTakeUserAssetUnderstandingPrompt({
              mime: item.mime,
              shortname: item.shortname,
            })
            // Downscale before the vision call: raw full-res uploads (multi-MP
            // phone photos) can time out. Best-effort -- falls
            // back to the original URI on any failure.
            const imageContent = await buildUserAssetUnderstandingImageContent({
              mime: item.mime,
              storageUri: item.storageUri,
            })
            const modelOutput: LongTakeUserAssetUnderstandingModelOutput = await JobContext.run(
              { projectId, userId },
              async () =>
                runLongTakeCompletionWithRecord({
                  projectId,
                  userId,
                  options: {
                    // Restore the pre-2026-07-02 pair, which ran this task at
                    // ~26-36s with low fallback. Do NOT use: gemini-2.5-flash
                    // (429 RESOURCE_EXHAUSTED on ~every request of this task
                    // since 07-02 -> 3x100s retries then gpt-5,
                    // ~300s/request) or gemini-3-flash-preview (~199s + 5xx on
                    // captions; fast only on keyframe judges).
                    models: ['gemini-3.5-flash', 'gpt-5'],
                    contents: [imageContent],
                    prompt,
                    // The model-facing variant, which omits `setting`.
                    // The wider schema (with `setting`) is for the UIP seed
                    // bridge only -- see long-take-user-assets-understanding.ts.
                    responseFormat: LongTakeUserAssetUnderstandingModelResponseSchema,
                    task: 'long-take-user-asset-understanding',
                    temperature: 0,
                  },
                }),
            )
            return normalizeLongTakeUserAssetUnderstandingModelOutput({
              catalogItem: item,
              modelOutput,
            })
          } catch (error) {
            logger.warn(
              `[long-take] User asset understanding failed for file ${formatLogFields({
                projectId,
                fileId: item.fileId,
                shortname: item.shortname,
                err: formatError(error),
              })}`,
            )
            return {
              asset_id: item.shortname
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, ''),
              description: null,
              entities: {
                brands_or_text: [],
                characters: [],
                objects: [],
              },
              file_id: item.fileId,
              likely_role: 'conditional_visual_asset' as const,
              mime: item.mime,
              quality: {
                low_quality: false,
                text_heavy_infographic: false,
                watermark: 'none' as const,
              },
              shortname: item.shortname,
              source_type: 'user_uploaded' as const,
              status: 'failed' as const,
              storage_uri: item.storageUri,
              tags: [],
              usage_guidance: null,
            }
          }
        })

        const output: LongTakeUserAssetUnderstandingOutput = {
          files,
          generated_at: new Date().toISOString(),
          summary: {
            analyzed: files.filter((item) => item.status === 'success').length,
            failed: files.filter((item) => item.status === 'failed').length,
          },
          version: 1,
        }
        await storage.writeJsonFile(LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH, output)

        logger.info(
          `[long-take] User asset understanding saved ${formatLogFields({
            projectId,
            analyzed: output.summary.analyzed,
            failed: output.summary.failed,
            fileCount: output.files.length,
            seededFromUip: seededCount,
            path: LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        const contextSummary = output.files
          .filter((f) => f.status === 'success' && f.description)
          .map((f) => `${f.file_id} (${f.shortname}): ${f.description}`)
          .join(' | ')

        return {
          analyzedCount: output.summary.analyzed,
          contextSummary: contextSummary || undefined,
          failedCount: output.summary.failed,
          outputPath: LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
        }
      } catch (error) {
        const fallback = buildLongTakeUserAssetUnderstandingFallback(userAssetCatalog)
        await storage.writeJsonFile(LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH, fallback)
        logger.warn(
          `[long-take] User asset understanding failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
            path: LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
          })}`,
        )
        return {
          analyzedCount: fallback.summary.analyzed,
          failedCount: fallback.summary.failed,
          outputPath: LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
        }
      }
    }),
  )
}
