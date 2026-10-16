import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { Content } from '@reelmakeeasy/common/llm'
import {
  buildStyleReferenceContents,
  readLongTakeStyleReferenceUris,
} from '@reelmakeeasy/common/long-take/style-reference'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { z } from 'zod'

import type {
  FinalizeLongTakeAnchorAssetsActivityParams,
  FinalizeLongTakeAnchorAssetsActivityResult,
  GenerateLongTakeAnchorAssetFileBindingActivityParams,
  GenerateLongTakeAnchorAssetFileBindingActivityResult,
  GenerateLongTakeAnchorAssetsActivityParams,
  GenerateLongTakeAnchorAssetsActivityResult,
  GenerateLongTakeSingleRawAnchorAssetActivityParams,
  GenerateLongTakeSingleRawAnchorAssetActivityResult,
  LongTakeAnchorAssetTask,
  LongTakeRawAnchorAssetItem,
  LongTakeStyledAnchorAssetItem,
} from '../../workflows/long-take/types'
import { LONG_TAKE_EXPERTS_DIR } from '../long-take-experts-analysis'
import { runImageGenerationWithRecord } from '../long-take-generation-record'
import { runSelectedModelWithRecord } from '../long-take-selected-model-record'
import { buildLongTakeAnchorStyleConversionPrompt } from '../prompts/long-take-anchor-style-conversion-prompt'

import { getAnchorTaskReferenceImageUris } from './anchor-reference-uris'
import {
  formatError,
  formatLogFields,
  getImageConcurrency,
  getProjectsBasePath,
  logger,
  mapWithConcurrency,
  resolveLongTakeAnchorImageModel,
  resolveLongTakeOneShotAnchorImageModel,
  runLongTakeExpertStep,
  toLongTakeSafeFileName,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { resolveGenerationResolution } from './generation-resolution'
import { buildScriptLanguageContextDirective } from './keyframe-directives'
import {
  buildLongTakeAnchorAssetTasks,
  buildLongTakeEmptyAnchorIndex,
  buildLongTakeFallbackStyleConversionOutput,
  clearLongTakeAnchorLookupCache,
  createLongTakeStorage,
  LONG_TAKE_ANCHOR_ASSET_TASKS_PATH,
  LONG_TAKE_ANCHOR_ASSETS_DIR,
  LONG_TAKE_ANCHOR_RAW_DIR,
  LONG_TAKE_ANCHOR_RAW_INDEX_PATH,
  LONG_TAKE_ANCHOR_STYLE_CONVERSION_PATH,
  LONG_TAKE_ANCHOR_STYLED_DIR,
  LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
  LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH,
  LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
  type LongTakeAnchorIndex,
  type LongTakeStyleConversionOutput,
  readLongTakeAnchorIndex,
} from './storage'

export async function finalizeLongTakeAnchorAssets(
  params: FinalizeLongTakeAnchorAssetsActivityParams,
): Promise<FinalizeLongTakeAnchorAssetsActivityResult> {
  const { assetCount, projectId, rawAnchors, styledAnchors, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_ANCHOR_ASSETS_DIR)
      await storage.ensureDir(LONG_TAKE_ANCHOR_RAW_DIR)
      await storage.ensureDir(LONG_TAKE_ANCHOR_STYLED_DIR)

      const normalizedRaw: LongTakeRawAnchorAssetItem[] = rawAnchors || []
      const normalizedStyled: LongTakeStyledAnchorAssetItem[] = styledAnchors || []

      await Promise.all([
        storage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, { assets: normalizedRaw }),
        storage.writeJsonFile(LONG_TAKE_ANCHOR_STYLED_INDEX_PATH, { assets: normalizedStyled }),
      ])

      clearLongTakeAnchorLookupCache(projectId)

      const rawAnchorCount = normalizedRaw.filter((item) => Boolean(item.anchor_uri)).length
      const styledAnchorCount = normalizedStyled.filter((item) => item.status === 'styled').length
      const fallbackToRawCount = normalizedStyled.filter((item) =>
        ['fallback_raw', 'raw_only'].includes(item.status || ''),
      ).length

      return {
        assetCount,
        fallbackToRawCount,
        outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
        rawAnchorCount,
        styledAnchorCount,
      }
    }),
  )
}

export async function generateLongTakeAnchorAssetFileBinding(
  params: GenerateLongTakeAnchorAssetFileBindingActivityParams,
): Promise<GenerateLongTakeAnchorAssetFileBindingActivityResult> {
  const { projectId, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_ANCHOR_ASSETS_DIR)

      try {
        const assetTasks = await buildLanguageAwareLongTakeAnchorAssetTasks(storage)
        await storage.writeJsonFile(LONG_TAKE_ANCHOR_ASSET_TASKS_PATH, {
          asset_tasks: assetTasks,
        })
        const userFileBoundAssetCount = assetTasks.filter(
          (task) => task.source_file_ids.length > 0,
        ).length

        return {
          assetCount: assetTasks.length,
          assetTasks,
          outputPath: LONG_TAKE_ANCHOR_ASSET_TASKS_PATH,
          userFileBoundAssetCount,
        }
      } catch (error) {
        logger.error(
          `[long-take] Anchor asset task preparation failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

export async function generateLongTakeAnchorAssets(
  params: GenerateLongTakeAnchorAssetsActivityParams,
): Promise<GenerateLongTakeAnchorAssetsActivityResult> {
  const { generationResolution, projectId, styleText, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      // Per-project image size tier: API value > default.
      const imageSize = resolveGenerationResolution({
        configured: generationResolution,
        projectId,
      }).imageSize
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_ANCHOR_ASSETS_DIR)
      await storage.ensureDir(LONG_TAKE_ANCHOR_RAW_DIR)
      await storage.ensureDir(LONG_TAKE_ANCHOR_STYLED_DIR)
      await storage.ensureDir(LONG_TAKE_EXPERTS_DIR)
      // The saved image style's picture, when the user picked one. Styled anchors (and raw
      // ones drawn straight in the style) get it so characters and props carry its look.
      const styleReferenceContents = buildStyleReferenceContents(
        await readLongTakeStyleReferenceUris(storage),
      )

      // Short-circuit when UIP has already produced the anchor indices at
      // confirm time. Re-running raw/styled generation here would overwrite
      // planner-decided styled URIs and drop the `source_passthrough`
      // markers UIP forwarded for logos / icons. The indices were written
      // by `convertUipAnchorsToStoryModeIndex` and the sentinel by the
      // confirm orchestration immediately after.
      if (await storage.exists(LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH)) {
        const [styledIndex, rawIndex] = await Promise.all([
          readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_STYLED_INDEX_PATH),
          readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_RAW_INDEX_PATH),
        ])
        clearLongTakeAnchorLookupCache(projectId)
        const styledAnchorCount = styledIndex.assets.filter(
          (item) => item.status === 'styled',
        ).length
        const fallbackToRawCount = styledIndex.assets.filter((item) =>
          ['fallback_raw', 'raw_only'].includes(item.status || ''),
        ).length
        const rawAnchorCount = rawIndex.assets.filter((item) => Boolean(item.anchor_uri)).length
        logger.info(
          `[long-take] UIP-pre-generated anchors detected, skipping regeneration ${formatLogFields({
            projectId,
            rawAnchorCount,
            styledAnchorCount,
            durationMs: Date.now() - startedAt,
          })}`,
        )
        return {
          assetCount: styledIndex.assets.length,
          fallbackToRawCount,
          outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
          rawAnchorCount,
          styledAnchorCount,
        }
      }

      try {
        const assetTasks = await buildLanguageAwareLongTakeAnchorAssetTasks(storage)

        if (!assetTasks.length) {
          await Promise.all([
            storage.writeJsonFile(LONG_TAKE_ANCHOR_ASSET_TASKS_PATH, { asset_tasks: [] }),
            storage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, buildLongTakeEmptyAnchorIndex()),
            storage.writeJsonFile(
              LONG_TAKE_ANCHOR_STYLE_CONVERSION_PATH,
              buildLongTakeFallbackStyleConversionOutput(styleText),
            ),
            storage.writeJsonFile(
              LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
              buildLongTakeEmptyAnchorIndex(),
            ),
          ])
          clearLongTakeAnchorLookupCache(projectId)
          return {
            assetCount: 0,
            fallbackToRawCount: 0,
            outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
            rawAnchorCount: 0,
            styledAnchorCount: 0,
          }
        }
        await storage.writeJsonFile(LONG_TAKE_ANCHOR_ASSET_TASKS_PATH, { asset_tasks: assetTasks })

        const projectsBasePath = getProjectsBasePath()
        await fs.promises.mkdir(projectsBasePath, { recursive: true })
        const rawLocalDir = path.join(projectsBasePath, projectId, LONG_TAKE_ANCHOR_RAW_DIR)
        const styledLocalDir = path.join(projectsBasePath, projectId, LONG_TAKE_ANCHOR_STYLED_DIR)
        await fs.promises.mkdir(rawLocalDir, { recursive: true })
        await fs.promises.mkdir(styledLocalDir, { recursive: true })

        const customModel = resolveLongTakeAnchorImageModel()
        const imageConcurrency = getImageConcurrency(4)
        const rawEntries = await mapWithConcurrency(
          assetTasks,
          imageConcurrency,
          async (assetTask) => {
            if (assetTask.source_passthrough && assetTask.source_image_uris.length > 0) {
              return {
                anchor_uri: assetTask.source_image_uris[0],
                asset_id: assetTask.asset_id,
                prompt_text: assetTask.prompt_text,
                source_file_ids: assetTask.source_file_ids,
                source_image_uris: assetTask.source_image_uris,
                source_passthrough: true,
                status: 'success',
              }
            }

            const contents: Content[] = [
              ...getAnchorTaskReferenceImageUris(assetTask, storage).map(
                (uri): Content => ({
                  type: 'image_url',
                  imageUrl: uri,
                }),
              ),
              ...(styleText?.trim() ? styleReferenceContents : []),
            ]
            const safeFileName = toLongTakeSafeFileName(assetTask.asset_id)
            const outputPath = path.join(rawLocalDir, `${safeFileName}.png`)
            const anchorPath = `${LONG_TAKE_ANCHOR_RAW_DIR}/${safeFileName}.png`
            const anchorUri = storage.getFullPath(anchorPath)

            try {
              await runImageGenerationWithRecord({
                aspectRatio: '2:3' as AspectRatio,
                contents,
                customModel,
                imageOptions: {
                  grounding: {
                    enableImageGrounding: true,
                    enableTextGrounding: true,
                  },
                },
                imageSize,
                outputPath,
                outputUri: anchorUri,
                projectId,
                prompt: buildAnchorRawPrompt(assetTask),
                shotId: `anchor_raw_${safeFileName}`,
                task: 'long-take-anchor-raw',
                userId,
              })
              await storage.uploadFile(outputPath, anchorPath)
              return {
                anchor_uri: anchorUri,
                asset_id: assetTask.asset_id,
                prompt_text: assetTask.prompt_text,
                source_file_ids: assetTask.source_file_ids,
                source_image_uris: assetTask.source_image_uris,
                status: 'success',
              }
            } catch (error) {
              logger.warn(
                `[long-take] Raw anchor generation failed ${formatLogFields({
                  projectId,
                  assetId: assetTask.asset_id,
                  err: formatError(error),
                })}`,
              )
              return {
                anchor_uri: null,
                asset_id: assetTask.asset_id,
                prompt_text: assetTask.prompt_text,
                source_file_ids: assetTask.source_file_ids,
                source_image_uris: assetTask.source_image_uris,
                status: 'failed',
              }
            } finally {
              await fs.promises.rm(outputPath, { force: true })
            }
          },
        )

        const rawIndex: LongTakeAnchorIndex = { assets: rawEntries }
        await storage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, rawIndex)

        let styleConversionPrompt = 'none'
        if (styleText?.trim()) {
          const styleConversionRaw = await runLongTakeExpertStep<string, string>({
            fallback: () => 'none',
            normalize: (modelOutput) => modelOutput.trim() || 'none',
            projectId,
            prompt: await buildLongTakeAnchorStyleConversionPrompt(styleText),
            responseFormat: z.string(),
            task: 'long-take-anchor-style-conversion',
            userId,
          })
          styleConversionPrompt = styleConversionRaw.output
        }
        const styleConversionOutput: LongTakeStyleConversionOutput = {
          style_conversion_prompt: styleConversionPrompt,
          used_original_style_text: styleText?.trim() || '',
        }
        await storage.writeJsonFile(LONG_TAKE_ANCHOR_STYLE_CONVERSION_PATH, styleConversionOutput)

        const shouldRunStyleTransfer = styleConversionPrompt.trim().toLowerCase() !== 'none'
        const styledEntries = shouldRunStyleTransfer
          ? await mapWithConcurrency(rawEntries, imageConcurrency, async (item) => {
              if (!item.anchor_uri) {
                return {
                  ...item,
                  effective_anchor_uri: null,
                  raw_anchor_uri: item.anchor_uri,
                  status: 'failed',
                  styled_anchor_uri: null,
                }
              }

              if (item.source_passthrough) {
                return {
                  ...item,
                  effective_anchor_uri: item.anchor_uri,
                  raw_anchor_uri: item.anchor_uri,
                  status: 'raw_only',
                  styled_anchor_uri: null,
                }
              }

              const safeFileName = toLongTakeSafeFileName(item.asset_id)
              const outputPath = path.join(styledLocalDir, `${safeFileName}.png`)
              const styledPath = `${LONG_TAKE_ANCHOR_STYLED_DIR}/${safeFileName}.png`
              const styledUri = storage.getFullPath(styledPath)

              try {
                await runImageGenerationWithRecord({
                  aspectRatio: '2:3' as AspectRatio,
                  contents: [
                    { type: 'image_url', imageUrl: item.anchor_uri },
                    ...styleReferenceContents,
                  ],
                  customModel,
                  imageSize,
                  outputPath,
                  outputUri: styledUri,
                  projectId,
                  prompt: styleConversionPrompt,
                  shotId: `anchor_style_${safeFileName}`,
                  task: 'long-take-anchor-style-transfer',
                  userId,
                })
                await storage.uploadFile(outputPath, styledPath)
                return {
                  ...item,
                  effective_anchor_uri: styledUri,
                  raw_anchor_uri: item.anchor_uri,
                  status: 'styled',
                  styled_anchor_uri: styledUri,
                }
              } catch (error) {
                logger.warn(
                  `[long-take] Anchor style transfer failed, fallback to raw ${formatLogFields({
                    projectId,
                    assetId: item.asset_id,
                    err: formatError(error),
                  })}`,
                )
                return {
                  ...item,
                  effective_anchor_uri: item.anchor_uri,
                  raw_anchor_uri: item.anchor_uri,
                  status: 'fallback_raw',
                  styled_anchor_uri: null,
                }
              } finally {
                await fs.promises.rm(outputPath, { force: true })
              }
            })
          : rawEntries.map((item) => ({
              ...item,
              effective_anchor_uri: item.anchor_uri,
              raw_anchor_uri: item.anchor_uri,
              status: item.anchor_uri ? 'raw_only' : 'failed',
              styled_anchor_uri: null,
            }))

        await storage.writeJsonFile(LONG_TAKE_ANCHOR_STYLED_INDEX_PATH, { assets: styledEntries })
        clearLongTakeAnchorLookupCache(projectId)

        const rawAnchorCount = rawEntries.filter((item) => Boolean(item.anchor_uri)).length
        const styledAnchorCount = styledEntries.filter((item) => item.status === 'styled').length
        const fallbackToRawCount = styledEntries.filter((item) =>
          ['fallback_raw', 'raw_only'].includes(item.status || ''),
        ).length

        logger.info(
          `[long-take] Anchor assets generated ${formatLogFields({
            projectId,
            assetCount: assetTasks.length,
            fallbackToRawCount,
            outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
            rawAnchorCount,
            styledAnchorCount,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          assetCount: assetTasks.length,
          fallbackToRawCount,
          outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
          rawAnchorCount,
          styledAnchorCount,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Anchor assets generation failed, fallback applied ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        await Promise.all([
          storage.writeJsonFile(LONG_TAKE_ANCHOR_ASSET_TASKS_PATH, { asset_tasks: [] }),
          storage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, buildLongTakeEmptyAnchorIndex()),
          storage.writeJsonFile(
            LONG_TAKE_ANCHOR_STYLE_CONVERSION_PATH,
            buildLongTakeFallbackStyleConversionOutput(styleText),
          ),
          storage.writeJsonFile(
            LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
            buildLongTakeEmptyAnchorIndex(),
          ),
        ])
        clearLongTakeAnchorLookupCache(projectId)
        return {
          assetCount: 0,
          fallbackToRawCount: 0,
          outputDir: LONG_TAKE_ANCHOR_ASSETS_DIR,
          rawAnchorCount: 0,
          styledAnchorCount: 0,
        }
      }
    }),
  )
}

export async function generateLongTakeSingleRawAnchorAsset(
  params: GenerateLongTakeSingleRawAnchorAssetActivityParams,
): Promise<GenerateLongTakeSingleRawAnchorAssetActivityResult> {
  const { assetTask, generationResolution, imageModel, orgId, projectId, styleText, userId } =
    params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      if (assetTask.source_passthrough && assetTask.source_image_uris.length > 0) {
        return {
          anchor_uri: assetTask.source_image_uris[0],
          asset_id: assetTask.asset_id,
          prompt_text: assetTask.prompt_text,
          source_file_ids: assetTask.source_file_ids || [],
          source_image_uris: assetTask.source_image_uris || [],
          source_passthrough: true,
          status: 'success',
        }
      }

      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir(LONG_TAKE_ANCHOR_RAW_DIR)
      // Drawn straight in the style (styleText set): add the saved image style's picture too.
      const styleReferenceContents = styleText?.trim()
        ? buildStyleReferenceContents(await readLongTakeStyleReferenceUris(storage))
        : []

      const safeFileName = toLongTakeSafeFileName(assetTask.asset_id)
      const localDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `long-take-anchor-raw-${projectId}-`),
      )
      const outputPath = path.join(localDir, `${safeFileName}.png`)
      const anchorPath = `${LONG_TAKE_ANCHOR_RAW_DIR}/${safeFileName}.png`
      const anchorUri = storage.getFullPath(anchorPath)
      const contents: Content[] = [
        ...getAnchorTaskReferenceImageUris(assetTask, storage).map(
          (uri): Content => ({
            type: 'image_url',
            imageUrl: uri,
          }),
        ),
        ...styleReferenceContents,
      ]
      const prompt = buildAnchorRawPrompt(assetTask, styleText)
      // Per-project image size tier: API value > default.
      const imageSize = resolveGenerationResolution({
        configured: generationResolution,
        projectId,
      }).imageSize

      try {
        const carriedModel = imageModel?.trim()
        if (carriedModel) {
          // Gate-on: route through the selected-model orchestrator.
          // The wrapper also writes the generation records the story-mode
          // report reads and emits the provider metrics.
          await runSelectedModelWithRecord({
            aspectRatio: '2:3' as AspectRatio,
            contents,
            grounding: { enableImageGrounding: true, enableTextGrounding: true },
            orgId: orgId ?? null,
            resolutionTier: imageSize,
            outputPath,
            outputUri: anchorUri,
            projectId,
            prompt,
            selectedModel: carriedModel,
            shotId: `anchor_raw_${safeFileName}`,
            stage: 'anchor',
            task: 'long-take-anchor-raw',
            userId,
          })
        } else {
          // Gate-off: existing path, unchanged.
          const customModel = styleText?.trim()
            ? resolveLongTakeOneShotAnchorImageModel()
            : resolveLongTakeAnchorImageModel()
          await runImageGenerationWithRecord({
            aspectRatio: '2:3' as AspectRatio,
            contents,
            customModel,
            imageOptions: {
              grounding: {
                enableImageGrounding: true,
                enableTextGrounding: true,
              },
            },
            imageSize,
            outputPath,
            outputUri: anchorUri,
            projectId,
            prompt,
            shotId: `anchor_raw_${safeFileName}`,
            task: 'long-take-anchor-raw',
            userId,
          })
        }
        await storage.uploadFile(outputPath, anchorPath)
        return {
          anchor_uri: anchorUri,
          asset_id: assetTask.asset_id,
          prompt_text: assetTask.prompt_text,
          source_file_ids: assetTask.source_file_ids || [],
          source_image_uris: assetTask.source_image_uris || [],
          status: 'success',
        }
      } catch (error) {
        logger.warn(
          `[long-take] Raw anchor generation failed ${formatLogFields({
            projectId,
            assetId: assetTask.asset_id,
            err: formatError(error),
          })}`,
        )
        return {
          anchor_uri: null,
          asset_id: assetTask.asset_id,
          prompt_text: assetTask.prompt_text,
          source_file_ids: assetTask.source_file_ids || [],
          source_image_uris: assetTask.source_image_uris || [],
          status: 'failed',
        }
      } finally {
        await fs.promises.rm(localDir, { force: true, recursive: true })
      }
    }),
  )
}

const ANCHOR_REFERENCE_FIDELITY_SUFFIX =
  '\nStrictly preserve the exact appearance from the reference image: clothing, hairstyle, skin tone, accessories, and all distinctive visual features must match the reference precisely across all views. Preserve all printed text, typography, logos, and graphic marks from the reference image exactly as shown, including spelling, capitalization, and minor labels.'

// Mirror of the UIP Invented-Text Protocol
// (`anchor-prompt-spec-builder.ts`). An asset with no reference image has
// no source for the copy printed on it, and the fidelity / printed-text
// directives above are both gated on having one, so before this guard a
// generated prop got no text instruction at all and the model filled blank
// surfaces with whatever that prop usually carries.
const ANCHOR_NO_REFERENCE_TEXT_GUARD_SUFFIX =
  '\nNo reference image is supplied for this asset, so any legible mark on it would be invented. Do not invent a brand name, wordmark, logo, or company identity, and do not borrow a real-world brand, product, or establishment unrelated to this project. Render legible text only where the description above supplies the exact wording; otherwise keep any lettering indistinct and non-legible rather than filling the surface with plausible-looking copy.'

const ANCHOR_PRINTED_TEXT_ESCAPE_REPLACEMENT = String.raw`\"`

function buildAnchorPrintedTextDirective(printedText: string[] | undefined): string {
  const strings = (printedText ?? []).map((s) => s.trim()).filter((s) => s.length > 0)
  if (strings.length === 0) {
    return ''
  }
  const quoted = strings
    .map((value) => `"${value.replace(/"/g, ANCHOR_PRINTED_TEXT_ESCAPE_REPLACEMENT)}"`)
    .join(', ')
  return `\nRequired text on the asset, render verbatim with these exact strings (preserve spelling and capitalization): ${quoted}.`
}

function buildAnchorRawPrompt(assetTask: LongTakeAnchorAssetTask, styleText?: string): string {
  let prompt = styleText?.trim() ? `${assetTask.prompt_text}\n${styleText}` : assetTask.prompt_text
  if (assetTask.source_image_uris.length > 0 && !assetTask.source_passthrough) {
    prompt = `${prompt}${ANCHOR_REFERENCE_FIDELITY_SUFFIX}`
    prompt = `${prompt}${buildAnchorPrintedTextDirective(assetTask.printed_text)}`
  } else if (assetTask.source_image_uris.length === 0) {
    prompt = `${prompt}${ANCHOR_NO_REFERENCE_TEXT_GUARD_SUFFIX}`
  }
  return prompt
}

async function buildLanguageAwareLongTakeAnchorAssetTasks(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<LongTakeAnchorAssetTask[]> {
  const [assetTasks, scriptLanguageContextDirective] = await Promise.all([
    buildLongTakeAnchorAssetTasks(storage),
    readScriptLanguageContextDirective(storage),
  ])
  if (!scriptLanguageContextDirective) {
    return assetTasks
  }
  return assetTasks.map((task) => {
    if (
      task.type !== 'Character' ||
      task.asset_id.trim().toLowerCase() !== 'char_singer' ||
      task.prompt_text.includes('Language context:')
    ) {
      return task
    }
    return {
      ...task,
      prompt_text: `${task.prompt_text}\n${scriptLanguageContextDirective}`,
    }
  })
}

async function readScriptLanguageContextDirective(
  storage: ReturnType<typeof createLongTakeStorage>,
): Promise<string> {
  try {
    const payload = await storage.readJsonFile<unknown>(LONG_TAKE_GLOBAL_CONSTRAINTS_PATH)
    if (!payload || typeof payload !== 'object') {
      return ''
    }
    const scriptLanguage = (payload as { script_language?: unknown }).script_language
    return typeof scriptLanguage === 'string'
      ? buildScriptLanguageContextDirective(scriptLanguage)
      : ''
  } catch {
    return ''
  }
}
