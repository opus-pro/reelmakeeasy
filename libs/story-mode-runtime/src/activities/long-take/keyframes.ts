import * as fs from 'node:fs'
import * as path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import type { Content } from '@reelmakeeasy/common/llm'
import { readLongTakeStyleReferenceUris } from '@reelmakeeasy/common/long-take/style-reference'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { ImageSizeTier } from '@reelmakeeasy/common/media/types'
import type { JudgeContext } from '@reelmakeeasy/story-mode-judges'
import sharp from 'sharp'
import { v4 as uuidV4 } from 'uuid'

import {
  isRealisticStyleText,
  PHOTO_PASSTHROUGH_IMAGE_MODEL,
} from '../../workflows/long-take/photo-passthrough'
import type {
  GenerateLongTakeKeyframeActivityParams,
  GenerateLongTakeKeyframeActivityResult,
  SaveLongTakeKeyframesActivityParams,
  SaveLongTakeKeyframesActivityResult,
} from '../../workflows/long-take/types'
import { runImageGenerationWithRecord } from '../long-take-generation-record'
import { resolveKeyframeImageModel } from '../long-take-generation-record-staging'
import { runSelectedModelWithRecord } from '../long-take-selected-model-record'

import { getLongTakeAnchorMetaLookup } from './anchor-meta'
import {
  DEFAULT_ASPECT_RATIO,
  formatError,
  formatLogFields,
  getProjectsBasePath,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { resolveGenerationResolution } from './generation-resolution'
import { compositeLogoKeyframe, resolveLogoPassthroughUri } from './keyframe-logo-passthrough'
import {
  LOGO_PASSTHROUGH_IMAGE_MODEL,
  resolveCleanCandidate,
  resolvePrimaryModel,
  selectFinalCandidate,
} from './keyframe-model-fallback'
import {
  compositePhotoKeyframe,
  resolveArticlePhotoPassthroughUri,
} from './keyframe-photo-passthrough'
import { checkKeyframeQuality } from './keyframe-quality'
import { checkKeyframeText } from './keyframe-text-check'
import { buildLongTakeKeyframeShotInputs } from './keyframes-prompt-helpers'
import { emitFinalKeyframeMetrics, hasDetectedIssue } from './keyframes-recovery'
import {
  createLongTakeStorage,
  getLongTakeKeyframeGlobalContext,
  LONG_TAKE_KEYFRAME_FINAL_PROMPTS_PATH,
} from './storage'
import { analyzeTextQuality, type TextQualityAnalysis } from './text-quality'

const KEYFRAME_RERUN_ATTEMPTS = [2, 3, 4, 5] as const
interface GenerateKeyframeCandidateParams {
  aspectRatio?: GenerateLongTakeKeyframeActivityParams['aspectRatio']
  attempt: number
  customModel: string
  imageSize?: ImageSizeTier
  keyframesDir: string
  logoPassthroughUri?: null | string
  orgId?: string
  photoPassthroughUri?: null | string
  projectId: string
  prompt: string
  selectedModel?: string
  shotContents: Content[]
  shotId: string
  storage: LongTakeStorage
  storagePath: string
  styleText?: string
  textJudgeContext?: JudgeContext
  tier?: LongTakeAdmissionTier
  usedAssetIds?: string[]
  userId: string
  useSelectedModel: boolean
}

interface GenerateSelectedKeyframeParams {
  aspectRatio?: GenerateLongTakeKeyframeActivityParams['aspectRatio']
  customModel: string
  imageSize?: ImageSizeTier
  keyframesDir: string
  logoPassthroughUri?: null | string
  orgId?: string
  photoPassthroughUri?: null | string
  projectId: string
  prompt: string
  selectedModel?: string
  shotContents: Content[]
  shotId: string
  storage: LongTakeStorage
  styleText?: string
  textJudgeContext?: JudgeContext
  tier?: LongTakeAdmissionTier
  usedAssetIds?: string[]
  userId: string
  useSelectedModel: boolean
}

type KeyframeCandidate = GenerateLongTakeKeyframeActivityResult & {
  attempt: number
  gibberishAnalysis?: null | TextQualityAnalysis
  storagePath: string
  /** undefined: check not run (gate off or passthrough); null: judge errored. */
  textIssue?: boolean | null
  textIssueReason?: string
}

type KeyframeRetryStrategy = {
  applies: (candidate: KeyframeCandidate) => boolean
  refine: (basePrompt: string, candidate: KeyframeCandidate) => string
}
type LongTakeStorage = ReturnType<typeof createLongTakeStorage>

export async function generateLongTakeKeyframe(
  params: GenerateLongTakeKeyframeActivityParams,
): Promise<GenerateLongTakeKeyframeActivityResult> {
  const {
    admissionTier,
    humanPresence,
    keyframeImageModel,
    orgId,
    projectId,
    prompt,
    promptRoute,
    shotId,
    styleName,
    styleText,
    stylizeKeyframes,
    usedAssetIds,
    userId,
    aspectRatio,
  } = params
  // Precedence: debug keyframeImageModel (admin) wins via the
  // existing resolveKeyframeImageModel path; otherwise a carried user
  // imageModel routes through the selected-model orchestrator;
  // otherwise the existing path is unchanged.
  const debugModel = keyframeImageModel?.trim()
  const carriedModel = params.imageModel?.trim()
  const useSelectedModel = !debugModel && !!carriedModel
  const resolvedUserId = userId || 'long-take'
  const ctx = {
    projectId,
    userId: resolvedUserId,
    sceneId: 'long_take_scene',
    shotId,
  }
  return withLongTakeContext(ctx, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      await storage.ensureDir('long_take')

      const projectsBasePath = getProjectsBasePath()
      await fs.promises.mkdir(projectsBasePath, { recursive: true })
      const keyframesDir = path.join(projectsBasePath, projectId, 'long_take', 'keyframes')
      await fs.promises.mkdir(path.join(keyframesDir, 'attempts'), { recursive: true })

      const customModel = resolveKeyframeImageModel({ configuredModel: keyframeImageModel })
      // Per-project image size tier: API value > default.
      const imageSize = resolveGenerationResolution({
        configured: params.generationResolution,
        projectId,
      }).imageSize
      const anchorLookup = await getLongTakeAnchorMetaLookup(storage, projectId)
      // When the shot depicts only the real brand logo, pass the raw logo
      // through verbatim instead of regenerating it.
      const logoPassthroughUri = resolveLogoPassthroughUri(usedAssetIds, anchorLookup)
      // When a REALISTIC-style news shot depicts only the article's real
      // photograph(s), composite the raw photo verbatim instead of
      // regenerating it. Stylized looks keep normal generation so
      // the photo is restyled to match.
      const photoPassthroughUri = isRealisticStyleText(styleText)
        ? resolveArticlePhotoPassthroughUri(usedAssetIds, anchorLookup)
        : null
      const globalContext = await getLongTakeKeyframeGlobalContext(storage, projectId)
      // The saved image style's picture, when the user picked one: the model copies its look.
      const styleReferenceUris = await readLongTakeStyleReferenceUris(storage)
      const { promptPayload, shotContents } = buildLongTakeKeyframeShotInputs({
        anchorLookup,
        basePrompt: prompt,
        globalContext,
        humanPresence,
        improvedVisualScriptEnabled: false,
        promptRoute,
        styleName,
        // When the keyframe-prompts step baked the full style into the
        // keyframe prompt, null the per-shot styleText so the "Stylize with ..."
        // suffix and the routed "Visual style:" no-op -- avoids double-applying style.
        styleText: stylizeKeyframes ? undefined : styleText,
        styleReferenceUris,
        usedAssetIds,
      })

      logger.info(
        `[long-take] Keyframe generation started ${formatLogFields({
          projectId,
          userId: resolvedUserId,
          shotId,
          aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
          // Report the model that will actually be used: when a carried user /
          // PT-routed imageModel routes through the selected-model orchestrator
          // it supersedes customModel. Mirrors the "attempt started"
          // log below so the two are not self-contradicting (e.g. a PT divert to
          // gpt-image-2 no longer logs the source gemini model here).
          model: useSelectedModel ? carriedModel : customModel,
          hasGlobalContext: Boolean(globalContext),
          globalContextFieldsUsed: promptPayload.fieldsUsed,
          keyEntitiesCount: promptPayload.keyEntitiesCount,
          anchorRefCount: shotContents.length,
          styleReferenceCount: styleReferenceUris.length,
          crowdScene: promptPayload.crowdScene,
          withTitle: promptPayload.withTitle,
        })}`,
      )

      try {
        const result = await generateSelectedKeyframe({
          aspectRatio,
          customModel,
          imageSize,
          keyframesDir,
          logoPassthroughUri,
          orgId,
          photoPassthroughUri,
          projectId,
          prompt: promptPayload.prompt,
          selectedModel: carriedModel,
          shotContents,
          shotId,
          storage,
          styleText,
          tier: admissionTier,
          useSelectedModel,
          usedAssetIds,
          userId: resolvedUserId,
        })

        logger.info(
          `[long-take] Keyframe generation completed ${formatLogFields({
            projectId,
            shotId,
            keyframePath: buildFinalStoragePath(shotId),
            durationMs: Date.now() - startedAt,
            reframe: result.reframe,
            upsideDown: result.upsideDown,
          })}`,
        )

        return result
      } catch (error) {
        logger.error(
          `[long-take] Keyframe generation failed ${formatLogFields({
            projectId,
            shotId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

export { selectFinalCandidate } from './keyframe-model-fallback'
export type { MetricTagValue, RecoveryIssueType, RecoveryOutcome } from './keyframes-recovery'
export {
  getMetricTagValue,
  getRecoveryIssueType,
  getRecoveryOutcome,
  hasDetectedIssue,
  isCleanCandidate,
} from './keyframes-recovery'

export async function saveLongTakeKeyframes(
  params: SaveLongTakeKeyframesActivityParams,
): Promise<SaveLongTakeKeyframesActivityResult> {
  const { projectId, keyframes } = params
  return withLongTakeContext({ projectId }, async () => {
    const storage = createLongTakeStorage(projectId)
    await storage.ensureDir('long_take')

    const keyframesPath = 'long_take/keyframes.json'
    const thumbnailsPath = 'long_take/keyframe_thumbnails.json'
    const thumbnails = keyframes
      .filter((kf) => kf.thumbnailUrl)
      .map((kf) => ({ shotId: kf.shotId, thumbnailUrl: kf.thumbnailUrl }))

    const finalPrompts = keyframes.flatMap((kf) =>
      kf.finalPrompt ? [{ prompt: kf.finalPrompt, shot_id: kf.shotId }] : [],
    )
    await Promise.all([
      storage.writeJsonFile(keyframesPath, keyframes),
      storage.writeJsonFile(thumbnailsPath, thumbnails),
      ...(finalPrompts.length
        ? [storage.writeJsonFile(LONG_TAKE_KEYFRAME_FINAL_PROMPTS_PATH, finalPrompts)]
        : []),
    ])

    logger.info(
      `[long-take] Keyframes saved ${formatLogFields({
        projectId,
        frameCount: keyframes.length,
        finalPromptCount: finalPrompts.length,
        keyframesPath,
      })}`,
    )

    return {
      frameCount: keyframes.length,
      keyframesPath,
    }
  })
}

function buildAttemptLocalPath(keyframesDir: string, shotId: string, attempt: number): string {
  return path.join(keyframesDir, 'attempts', `${shotId}-attempt-${attempt}.png`)
}

function buildAttemptStoragePath(shotId: string, attempt: number): string {
  return `long_take/keyframes/attempts/${shotId}-attempt-${attempt}.png`
}

function buildFinalStoragePath(shotId: string): string {
  return `long_take/keyframes/${shotId}.png`
}

const KEYFRAME_RETRY_STRATEGIES: KeyframeRetryStrategy[] = [
  {
    applies: (candidate) =>
      candidate.hasGibberish === true &&
      candidate.gibberishAnalysis != null &&
      candidate.textIssue !== true,
    refine: (basePrompt, candidate) => {
      const analysis = candidate.gibberishAnalysis ?? { distortionTypes: [], description: '' }
      const issues =
        analysis.distortionTypes.length > 0
          ? analysis.distortionTypes.join(', ')
          : analysis.description
      return `${basePrompt}\n\nIMPORTANT: The previous attempt had text rendering issues (${issues}). Avoid generating any prominent text, headline overlays, or title cards, render them as abstract design elements or omit text entirely.`
    },
  },
  {
    applies: (candidate) => candidate.textIssue === true,
    refine: (basePrompt, candidate) =>
      `${basePrompt}\n\nIMPORTANT: The previous attempt rendered on-image text incorrectly (${candidate.textIssueReason || 'unreadable or wrong text'}). Any text the shot calls for must be spelled exactly as written in the shot description, and no other text, brand names, or signage may appear.`,
  },
]

function buildKeyframeRerunPrompt(basePrompt: string, candidate: KeyframeCandidate): string {
  return KEYFRAME_RETRY_STRATEGIES.reduce(
    (currentPrompt, strategy) =>
      strategy.applies(candidate) ? strategy.refine(currentPrompt, candidate) : currentPrompt,
    basePrompt,
  )
}

// Exported so the thumbnail integration test reads back the exact path.
export function buildThumbnailStoragePath(shotId: string): string {
  return `long_take/keyframes/thumbnails/${shotId}.webp`
}

const THUMBNAIL_MAX_DIMENSION = 256

async function cleanupAttemptArtifacts(params: {
  candidates: KeyframeCandidate[]
  projectId: string
  storage: LongTakeStorage
}): Promise<void> {
  const { candidates, projectId, storage } = params
  const cleanupResults = await Promise.allSettled(
    candidates.map((candidate) => storage.deleteFile(candidate.storagePath)),
  )

  cleanupResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return
    }
    const candidate = candidates[index]
    logger.warn(
      `[long-take] Failed to clean up keyframe attempt artifact ${formatLogFields({
        projectId,
        shotId: candidate.shotId,
        attempt: candidate.attempt,
        storagePath: candidate.storagePath,
        err: formatError(result.reason),
      })}`,
    )
  })
}

async function finalizeSelectedKeyframeCandidate(params: {
  candidates: KeyframeCandidate[]
  projectId: string
  selectedCandidate: KeyframeCandidate
  shotId: string
  storage: LongTakeStorage
}): Promise<GenerateLongTakeKeyframeActivityResult> {
  const { candidates, projectId, selectedCandidate, shotId, storage } = params
  const finalStoragePath = buildFinalStoragePath(shotId)
  const finalKeyframeUrl = storage.getFullPath(finalStoragePath)

  await storage.deleteFile(finalStoragePath)
  await storage.moveFile(selectedCandidate.storagePath, finalStoragePath)

  const thumbnailUrl = await generateThumbnail({ finalStoragePath, projectId, shotId, storage })

  const loserCandidates = candidates.filter(
    (candidate) => candidate.storagePath !== selectedCandidate.storagePath,
  )
  await cleanupAttemptArtifacts({ candidates: loserCandidates, projectId, storage })

  logger.info(
    `[long-take] Keyframe selection completed ${formatLogFields({
      projectId,
      shotId,
      selectedAttempt: selectedCandidate.attempt,
      rerunTriggered: candidates.length > 1,
      finalKeyframePath: finalStoragePath,
      reframe: selectedCandidate.reframe,
      upsideDown: selectedCandidate.upsideDown,
    })}`,
  )

  return {
    imageModel: selectedCandidate.imageModel,
    keyframeUrl: finalKeyframeUrl,
    reframe: selectedCandidate.reframe,
    shotId,
    thumbnailUrl,
    upsideDown: selectedCandidate.upsideDown,
  }
}

async function generateKeyframeCandidate(
  params: GenerateKeyframeCandidateParams,
): Promise<KeyframeCandidate> {
  const {
    aspectRatio,
    attempt,
    customModel,
    imageSize,
    keyframesDir,
    orgId,
    projectId,
    prompt,
    selectedModel,
    shotContents,
    shotId,
    storage,
    storagePath,
    styleText,
    textJudgeContext,
    tier,
    useSelectedModel,
    userId,
  } = params
  const outputPath = buildAttemptLocalPath(keyframesDir, shotId, attempt)
  const generationTaskId = uuidV4()
  const startedAt = Date.now()
  // Belt-and-suspenders: only treat this as the selected-model path when a
  // concrete selectedModel is present, so a missing value safely falls back to
  // the existing path instead of dispatching the literal 'undefined'.
  const routeSelectedModel = useSelectedModel && Boolean(selectedModel)
  // Tracking only (E26-safe): this telemetry field never reaches a client.
  let imageModel = String(customModel)
  let logoPassthroughDone = false
  let photoPassthroughDone = false

  logger.info(
    `[long-take] Keyframe generation attempt started ${formatLogFields({
      projectId,
      userId,
      shotId,
      attempt,
      aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
      model: routeSelectedModel && selectedModel ? selectedModel : customModel,
      anchorRefCount: shotContents.length,
    })}`,
  )

  try {
    await JobContext.run({ projectId, userId, sceneId: 'long_take_scene', shotId }, async () => {
      // Article photo passthrough: under a realistic style the
      // story's real photograph IS the shot -- composite it verbatim instead
      // of regenerating it. Checked BEFORE the selected-model route because
      // compositing needs no model and must win over a carried imageModel.
      // Falls through to generation if compositing fails.
      if (params.photoPassthroughUri) {
        try {
          await compositePhotoKeyframe({
            aspectRatio,
            outputPath,
            photoUri: params.photoPassthroughUri,
          })
          imageModel = PHOTO_PASSTHROUGH_IMAGE_MODEL
          photoPassthroughDone = true
          return
        } catch (error) {
          logger.warn(
            `[long-take] photo passthrough failed, falling back to generation ${formatLogFields({
              projectId,
              shotId,
              attempt,
              err: formatError(error),
            })}`,
          )
        }
      }
      if (routeSelectedModel && selectedModel) {
        // Initialize tracking from the selected model only on this guarded path.
        imageModel = selectedModel
        // Gate-on: route through the selected-model orchestrator.
        // The breaker handles per-provider accounting across each attempt, so
        // every candidate (initial + reruns) routes independently here. The
        // wrapper also writes the generation records the story-mode report
        // reads and emits the provider metrics.
        await runSelectedModelWithRecord({
          aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
          contents: shotContents,
          resolutionTier: imageSize,
          // Grounding intentionally omitted to match the legacy keyframe path
          // (parity: only the model changes, not other generation params).
          onModelUsed: (model) => {
            imageModel = model
          },
          orgId: orgId ?? null,
          outputPath,
          outputUri: storage.getFullPath(storagePath),
          projectId,
          prompt,
          selectedModel,
          shotId,
          stage: 'keyframe',
          task: 'long-take-keyframe',
          taskId: generationTaskId,
          tier,
          userId,
        })
        return
      }
      // Logo passthrough: composite the raw brand logo onto the
      // frame rather than regenerating it, so it is never recolored or
      // restyled. Falls through to generation if compositing fails.
      if (params.logoPassthroughUri) {
        try {
          await compositeLogoKeyframe({
            aspectRatio,
            logoUri: params.logoPassthroughUri,
            outputPath,
          })
          imageModel = LOGO_PASSTHROUGH_IMAGE_MODEL
          logoPassthroughDone = true
          return
        } catch (error) {
          logger.warn(
            `[long-take] logo passthrough failed, falling back to generation ${formatLogFields({
              projectId,
              shotId,
              attempt,
              err: formatError(error),
            })}`,
          )
        }
      }
      // Gate-off / debug path: existing generation, unchanged.
      await runImageGenerationWithRecord({
        aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
        contents: shotContents,
        customModel,
        imageSize,
        onModelSucceeded: (model) => {
          imageModel = model
        },
        outputPath,
        outputUri: storage.getFullPath(storagePath),
        projectId,
        prompt,
        shotId,
        task: 'long-take-keyframe',
        taskId: generationTaskId,
        tier,
        userId,
      })
    })

    await storage.uploadFile(outputPath, storagePath)
    const keyframeUrl = storage.getFullPath(storagePath)

    // A passed-through real logo or article photo is authoritative: never
    // quality-gate, gibberish check (stylized wordmarks / photo captions read
    // as gibberish), or rerun it.
    if (logoPassthroughDone || photoPassthroughDone) {
      logger.info(
        `[long-take] Keyframe ${photoPassthroughDone ? 'photo' : 'logo'} passthrough completed ${formatLogFields(
          {
            projectId,
            shotId,
            attempt,
            storagePath,
            durationMs: Date.now() - startedAt,
          },
        )}`,
      )
      return {
        attempt,
        gibberishAnalysis: null,
        hasGibberish: false,
        imageModel,
        keyframeUrl,
        reframe: false,
        shotId,
        storagePath,
        upsideDown: false,
      }
    }

    const [qualityResult, gibberishAnalysis, textCheck] = await Promise.all([
      checkKeyframeQuality({ keyframeUrl, projectId, shotId, styleText }),
      analyzeTextQuality(keyframeUrl).catch((error) => {
        logger.warn(
          `[long-take] Keyframe gibberish check failed ${formatLogFields({
            projectId,
            shotId,
            attempt,
            err: formatError(error),
          })}`,
        )
        return null
      }),
      textJudgeContext
        ? checkKeyframeText({ context: textJudgeContext, keyframeUrl, projectId, shotId })
        : Promise.resolve(undefined),
    ])

    const hasGibberish = gibberishAnalysis?.hasGibberish ?? false
    const textIssue = textCheck === undefined ? undefined : (textCheck?.textIssue ?? null)

    logger.info(
      `[long-take] Keyframe generation attempt completed ${formatLogFields({
        projectId,
        shotId,
        attempt,
        imageModel,
        storagePath,
        durationMs: Date.now() - startedAt,
        reframe: qualityResult.reframe,
        upsideDown: qualityResult.upsideDown,
        hasGibberish,
        textIssue,
        detectedIssue: hasDetectedIssue({ ...qualityResult, hasGibberish, textIssue }),
      })}`,
    )

    return {
      attempt,
      gibberishAnalysis,
      hasGibberish,
      imageModel,
      keyframeUrl,
      reframe: qualityResult.reframe,
      shotId,
      storagePath,
      textIssue,
      textIssueReason: textCheck?.reason,
      upsideDown: qualityResult.upsideDown,
    }
  } finally {
    await fs.promises.rm(outputPath, { force: true })
  }
}

async function generateSelectedKeyframe(
  params: GenerateSelectedKeyframeParams,
): Promise<GenerateLongTakeKeyframeActivityResult> {
  const {
    aspectRatio,
    customModel,
    imageSize,
    keyframesDir,
    logoPassthroughUri,
    orgId,
    photoPassthroughUri,
    projectId,
    prompt,
    selectedModel,
    shotContents,
    shotId,
    storage,
    styleText,
    textJudgeContext,
    tier,
    useSelectedModel,
    usedAssetIds,
    userId,
  } = params
  const firstCandidate = await generateKeyframeCandidate({
    aspectRatio,
    attempt: 1,
    customModel,
    imageSize,
    keyframesDir,
    logoPassthroughUri,
    orgId,
    photoPassthroughUri,
    projectId,
    prompt,
    selectedModel,
    shotContents,
    shotId,
    storage,
    storagePath: buildAttemptStoragePath(shotId, 1),
    styleText,
    textJudgeContext,
    tier,
    useSelectedModel,
    usedAssetIds,
    userId,
  })

  const primaryModel = resolvePrimaryModel(useSelectedModel, selectedModel)

  if (!hasDetectedIssue(firstCandidate)) {
    const { candidates, selectedCandidate } = await resolveCleanCandidate({
      firstCandidate,
      generateCandidate: (attempt) =>
        generateKeyframeCandidate({
          aspectRatio,
          attempt,
          customModel,
          imageSize,
          keyframesDir,
          orgId,
          projectId,
          prompt,
          selectedModel,
          shotContents,
          shotId,
          storage,
          storagePath: buildAttemptStoragePath(shotId, attempt),
          styleText,
          textJudgeContext,
          tier,
          useSelectedModel,
          usedAssetIds,
          userId,
        }),
      primaryModel,
      projectId,
      shotId,
    })
    const finalResult = await finalizeSelectedKeyframeCandidate({
      candidates,
      projectId,
      selectedCandidate,
      shotId,
      storage,
    })
    emitFinalKeyframeMetrics({
      finalCandidate: selectedCandidate,
      initialCandidate: firstCandidate,
      styleText,
    })
    return { ...finalResult, finalPrompt: prompt }
  }

  const rerunPrompt = buildKeyframeRerunPrompt(prompt, firstCandidate)

  logger.info(
    `[long-take] Keyframe reruns triggered ${formatLogFields({
      projectId,
      shotId,
      rerunTriggered: true,
      initialAttempt: firstCandidate.attempt,
      initialReframe: firstCandidate.reframe,
      initialUpsideDown: firstCandidate.upsideDown,
      initialHasGibberish: firstCandidate.hasGibberish,
      initialTextIssue: firstCandidate.textIssue,
      promptModified: rerunPrompt !== prompt,
    })}`,
  )

  const rerunResults = await Promise.allSettled(
    KEYFRAME_RERUN_ATTEMPTS.map(async (attempt) =>
      generateKeyframeCandidate({
        aspectRatio,
        attempt,
        customModel,
        imageSize,
        keyframesDir,
        orgId,
        projectId,
        prompt: rerunPrompt,
        selectedModel,
        shotContents,
        shotId,
        storage,
        storagePath: buildAttemptStoragePath(shotId, attempt),
        styleText,
        textJudgeContext,
        tier,
        useSelectedModel,
        usedAssetIds,
        userId,
      }),
    ),
  )
  const rerunCandidates = rerunResults.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return [result.value]
    }
    const attempt = KEYFRAME_RERUN_ATTEMPTS[index]
    logger.warn(
      `[long-take] Keyframe rerun attempt failed ${formatLogFields({
        projectId,
        shotId,
        attempt,
        err: formatError(result.reason),
      })}`,
    )
    return []
  })
  const selectedCandidate = selectFinalCandidate(firstCandidate, rerunCandidates, primaryModel)
  const finalResult = await finalizeSelectedKeyframeCandidate({
    candidates: [firstCandidate, ...rerunCandidates],
    projectId,
    selectedCandidate,
    shotId,
    storage,
  })
  emitFinalKeyframeMetrics({
    finalCandidate: selectedCandidate,
    initialCandidate: firstCandidate,
    styleText,
  })
  return { ...finalResult, finalPrompt: selectedCandidate.attempt === 1 ? prompt : rerunPrompt }
}

// Exported for the real-sharp keyframe thumbnail integration test.
export async function generateThumbnail(params: {
  finalStoragePath: string
  projectId: string
  shotId: string
  storage: LongTakeStorage
}): Promise<null | string> {
  const { finalStoragePath, projectId, shotId, storage } = params
  try {
    const imageBuffer = await storage.readFile(finalStoragePath)
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize({
        width: THUMBNAIL_MAX_DIMENSION,
        height: THUMBNAIL_MAX_DIMENSION,
        fit: 'inside',
      })
      .webp()
      .toBuffer()
    const thumbnailPath = buildThumbnailStoragePath(shotId)
    await storage.writeFile(thumbnailPath, thumbnailBuffer)
    return storage.getFullPath(thumbnailPath)
  } catch (error) {
    logger.warn(
      `[long-take] Thumbnail generation failed ${formatLogFields({
        projectId,
        shotId,
        err: formatError(error),
      })}`,
    )
    return null
  }
}
