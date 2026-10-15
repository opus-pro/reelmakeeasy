import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { type CameraStyle, retimeMaxSpeedFor } from '@reelmakeeasy/common/long-take/camera-craft'
import { probeVideoDimensions } from '@reelmakeeasy/common/long-take/probe-video-dimensions'
import type { VideoResolution } from '@reelmakeeasy/common/media/types'
import { withTimeout } from '@reelmakeeasy/common/timer/timer'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { extractLastFrame, retimeTransitionVideoIfNeeded } from '@reelmakeeasy/common/utils/media'
import { isMinimaxModel, isSeedance25Model } from '@reelmakeeasy/common/veo3/model'
import { clampVideoResolution } from '@reelmakeeasy/common/video-models/registry'
import { v4 as uuidV4 } from 'uuid'
import { z } from 'zod'

import {
  buildLongTakeRoutedPromptTemplate,
  resolveLongTakeTransitionPromptRoute,
} from '../../long-take-prompt-router'
import { buildSeedance2TransitionPrompt } from '../../workflows/long-take/transition-planning'
import type {
  LongTakeTextSeverity,
  LongTakeTransitionAttemptRecord,
} from '../../workflows/long-take/transition-types'
import type {
  GenerateLongTakeTransitionVideoActivityParams,
  GenerateLongTakeTransitionVideoActivityResult,
  SelectLongTakeTransitionTypesActivityParams,
  SelectLongTakeTransitionTypesActivityResult,
} from '../../workflows/long-take/types'
import {
  type BeatLoopClipMeta,
  type BeatLoopTransitionOptions,
  generateBeatLoopClipVideo,
  isBeatLoopTransition,
  lastFrameName,
  lockBeatLoopClip,
} from '../beat-loop/clip-video'
import {
  generateTransitionVideoClipWithRecord,
  runLongTakeCompletionWithRecord,
} from '../long-take-generation-record'
import {
  isValidTransitionVideoModel,
  resolveDefaultTransitionVideoModel,
} from '../long-take-generation-record-staging'

import {
  DEFAULT_ASPECT_RATIO,
  detectBlackScreen,
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  isImageSensitiveError,
  isSeedance2Model,
  isSensitivePromptError,
  logger,
  rewritePromptForSafety,
  rewritePromptForSeedance2,
  validateTransitionTiming,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { resolveGenerationResolution } from './generation-resolution'
import { isSeedance15Model } from './seedance15'
import { prepareSeedance25IdentityReferenceContext } from './seedance25-identity-references'
import { createLongTakeStorage } from './storage'
import {
  ensureLongTakeTransitionArtifactsDir,
  persistTransitionArtifacts,
} from './transition-artifacts'
import { stripNativeAudioInPlace } from './transition-audio'
import { assertMergedTransitionDurationCompatible } from './transition-duration'
import {
  checkTransitionVideoTextQuality,
  evaluateQualityCheckResults,
  MAX_QUALITY_ATTEMPTS,
} from './transition-quality'
import { resolveTransitionQualityFallback } from './transition-quality-fallback'

// Re-exported so the activity registration surface is unchanged; the
// implementation moved next to refineSingleTransitionPrompt (max-lines).
export { refineLongTakeTransitionPrompts } from './transition-refinement'

const RETIME_TIMEOUT_MS = 60_000
const TEXT_QUALITY_CHECK_TIMEOUT_MS = 45_000
const BLACK_SCREEN_CHECK_TIMEOUT_MS = 15_000
const TransitionSelectionSchema = z.object({
  transitionId: z.string(),
  transitionType: z.enum(['vertical', 'horizontal']),
})
const LongTakeTransitionSelectionSchema = z.object({
  selections: z.array(TransitionSelectionSchema),
})

export async function ensureLongTakeTransitionsDir(params: { projectId: string; userId: string }) {
  return withLongTakeContext(params, async () => {
    const storage = createLongTakeStorage(params.projectId)
    await storage.ensureDir('long_take/transitions')
    await ensureLongTakeTransitionArtifactsDir(storage)
  })
}

/** A transition's params, plus the switch for a loop short's clips. */
export type TransitionVideoActivityParams = BeatLoopTransitionOptions &
  GenerateLongTakeTransitionVideoActivityParams

/** A finished transition; a loop clip also says how it was beat-locked and levelled. */
export type TransitionVideoActivityResult = GenerateLongTakeTransitionVideoActivityResult & {
  beatLoop?: BeatLoopClipMeta
}

export async function generateLongTakeTransitionVideo(
  params: TransitionVideoActivityParams,
): Promise<TransitionVideoActivityResult> {
  return (await runTransitionActivity(params, false)) as TransitionVideoActivityResult
}

/**
 * Only the prompt a transition would be generated with, from its planned
 * keyframes. Chained transitions run this for every clip in parallel up front,
 * so the one-after-another generation doesn't wait on an LLM rewrite per clip.
 */
export async function prepareLongTakeTransitionPrompt(
  params: GenerateLongTakeTransitionVideoActivityParams,
): Promise<{ prompt: string }> {
  return (await runTransitionActivity(params, true)) as { prompt: string }
}

export async function selectLongTakeTransitionTypes(
  params: SelectLongTakeTransitionTypesActivityParams,
): Promise<SelectLongTakeTransitionTypesActivityResult> {
  const { projectId, promptRoute, transitions, userId } = params
  const resolvedUserId = userId || 'long-take'
  return withLongTakeContext({ projectId, userId: resolvedUserId }, () =>
    withActivityHeartbeat(async () => {
      if (transitions.length === 0) {
        return { selections: [] }
      }

      logger.info(
        `[long-take] Transition selection started ${formatLogFields({
          projectId,
          transitionCount: transitions.length,
        })}`,
      )
      const promptLines = [
        'You are selecting camera pan transition types between consecutive shots.',
        'Choose either "vertical" or "horizontal" for each transition.',
        'Use visual cues from the two prompts to decide the best directional pan.',
        'Prefer vertical when scenes imply tall, stacked, upward/downward movement, or portrait composition.',
        'Prefer horizontal when scenes imply wide, lateral movement, landscapes, or left-right motion.',
        'Balance variety: avoid picking the same type for every transition unless clearly justified.',
        'Return JSON with the same transitionId values.',
        '',
        'Input transitions:',
        ...transitions.map(
          (transition, index) =>
            `#${index + 1} id=${transition.transitionId} duration=${transition.durationSeconds}s\nFROM: ${transition.fromPrompt}\nTO: ${transition.toPrompt}`,
        ),
      ]
      const prompt = buildLongTakeRoutedPromptTemplate({
        generalPrompt: promptLines.join('\n'),
        promptRoute,
        templateName: 'transition-selection',
      })

      try {
        const response = await JobContext.run({ projectId, userId: resolvedUserId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId: resolvedUserId,
            options: {
              models: 'pro',
              prompt,
              responseFormat: LongTakeTransitionSelectionSchema,
              task: 'long-take-transition-selection',
              temperature: 0.2,
            },
          }),
        )

        const selections = response.selections?.filter((selection) => selection.transitionId) || []
        if (!selections.length) {
          return {
            selections: transitions.map((transition) => ({
              transitionId: transition.transitionId,
              transitionType: 'horizontal',
            })),
          }
        }

        logger.info(
          `[long-take] Transition selection completed ${formatLogFields({
            projectId,
            selectionCount: selections.length,
          })}`,
        )
        return { selections }
      } catch (error) {
        logger.warn(
          `[long-take] Transition selection failed, defaulting to horizontal ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return {
          selections: transitions.map((transition) => ({
            transitionId: transition.transitionId,
            transitionType: 'horizontal',
          })),
        }
      }
    }),
  )
}

function clampOptionalVideoResolution(
  requested: undefined | VideoResolution,
  model: string,
): undefined | VideoResolution {
  return requested ? clampVideoResolution(requested, model) : undefined
}

async function prepareTransitionTempDir(params: {
  projectId: string
  transitionId: string
}): Promise<{ firstFramePath: string; lastFramePath: string; tempDir: string }> {
  const { projectId, transitionId } = params
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `long-take-${projectId}-`))
  return {
    tempDir,
    firstFramePath: path.join(tempDir, `first-${transitionId}.png`),
    lastFramePath: path.join(tempDir, `last-${transitionId}.png`),
  }
}

async function runTransitionActivity(
  params: TransitionVideoActivityParams,
  promptOnly: boolean,
): Promise<TransitionVideoActivityResult | { prompt: string }> {
  const resolvedUserId = params.userId || 'long-take'
  const ctx = {
    pipelineContext: params.pipelineContext,
    projectId: params.projectId,
    userEmail: params.userEmail,
    userId: resolvedUserId,
    sceneId: 'long_take_scene',
    shotId: params.transitionId,
    modelSwitch: params.debugSettings?.llm,
  }
  return withLongTakeContext(ctx, () =>
    withActivityHeartbeat(async () => {
      const {
        admissionTier,
        aspectRatio,
        beatBoundarySeconds,
        durationSeconds,
        endMs,
        firstFrameUri,
        fromAudio,
        fromKeyframePrompt,
        fromPrompt,
        fromShotId,
        generationResolution,
        globalScript,
        improvedVisualScriptEnabled,
        intermediateKeyframeUris,
        isNewStyleTransfer,
        lastFrameUri,
        projectId,
        prompt,
        promptRoute,
        referenceAssetIds,
        shouldLipSync,
        startMs,
        styleText,
        toAudio,
        toKeyframePrompt,
        toPrompt,
        toShotId,
        transitionId,
        userEmail,
        userId,
      } = params

      validateTransitionTiming({ endMs, fromShotId, startMs, toShotId })
      // Loop clips (a loop short's 4 s bars) send their template exactly as written.
      const beatLoop = isBeatLoopTransition(params)

      const storage = createLongTakeStorage(projectId)
      const startedAt = Date.now()
      // A regenerated clip gets its own file (`outputName`), never the original's.
      const transitionUri = storage.getFullPath(
        `long_take/transitions/${params.outputName ?? transitionId}.mp4`,
      )

      const safeDuration = Math.max(1, durationSeconds)
      const { tempDir, firstFramePath, lastFramePath } = await prepareTransitionTempDir({
        projectId,
        transitionId,
      })

      try {
        logger.info(
          `[long-take] Transition generation started ${formatLogFields({
            projectId,
            transitionId,
            fromShotId,
            toShotId,
            durationSeconds: safeDuration,
            aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
          })}`,
        )
        await downloadAssetToLocal(firstFrameUri, firstFramePath)
        const resolvedLastFramePath = await downloadOptionalLastFrame(lastFrameUri, lastFramePath)

        const configuredTransitionVideoModel =
          params.debugSettings?.transitionVideoModel || params.transitionVideoModel
        const resolvedTransitionVideoModel = resolveTransitionPromptModel(
          configuredTransitionVideoModel,
        )
        // Per-project video resolution: API value > default,
        // clamped at the PRIMARY model's cap. Fallback chains reuse this value;
        // gen-video re-clamps per actual model, so a fallback to a lower-capped
        // model (e.g. seedance-1.5 -> kling std) may produce a single
        // lower-resolution clip -- accepted rather than clamping the whole
        // project to the worst-case fallback cap.
        const resolvedGenerationResolution = resolveGenerationResolution({
          configured: generationResolution,
          projectId,
        })
        const videoResolution = clampOptionalVideoResolution(
          resolvedGenerationResolution.videoResolution,
          resolvedTransitionVideoModel,
        )
        const seedance25References = await prepareSeedance25IdentityReferenceContext({
          fallbackAnchorStartImageIndex: 3 + (intermediateKeyframeUris?.length ?? 0),
          firstFramePath,
          intermediateKeyframeUris,
          lastFramePath: resolvedLastFramePath,
          projectId,
          referenceAssetIds,
          storage,
          tempDir,
          transitionId,
          transitionVideoModel: resolvedTransitionVideoModel,
        })
        const seedance25ReferenceImageUrls = seedance25References.referenceImageUrls
        // Seedance 2.0 is tuned for its own prompt format (`buildSeedance2TransitionPrompt`);
        // when the resolved model is Seedance 2.0 we always run its rewrite, even when the
        // motion-design pipeline sets `skipPromptRewrite: true` -- feeding Seedance the raw
        // markdown-rule motion prompt was producing visibly poor outputs.
        // This shared classic/UIP activity runs the native 1.5 adapter so
        // route and anchor adherence stay aligned.
        const isSeedance15TransitionModel = isSeedance15Model(resolvedTransitionVideoModel)
        const shouldUseSeedance15TransitionPrompt = isSeedance15TransitionModel
        const shouldUseSeedance2TransitionPrompt = resolveShouldUseSeedance2TransitionPrompt({
          isNewStyleTransfer,
          isSeedance15TransitionModel,
          resolvedTransitionVideoModel,
        })

        logger.info(
          `[long-take] Transition prompt strategy resolved ${formatLogFields({
            projectId,
            isSeedance15TransitionModel,
            resolvedTransitionVideoModel,
            shouldUseSeedance15TransitionPrompt,
            videoResolution: videoResolution ?? null,
            videoResolutionSource: resolvedGenerationResolution.videoResolutionSource,
            shouldUseSeedance2TransitionPrompt,
            transitionId,
          })}`,
        )

        const failedAttempts: LongTakeTransitionAttemptRecord[] = []
        let bestVideoPath: null | string = null
        let finalQualityCheck: { hasGibberish: boolean; severity: LongTakeTextSeverity } = {
          hasGibberish: false,
          severity: 'none',
        }
        let finalBlackScreen = false
        let finalBytesPerFrame: number | undefined
        const transitionPromptRoute = resolveTransitionPromptRouteForModel({
          promptRoute,
          transitionVideoModel: resolvedTransitionVideoModel,
        })
        const seedance2TransitionPrompt = isSeedance25Model(resolvedTransitionVideoModel)
          ? prompt
          : buildSeedance2TransitionPrompt({
              beatBoundarySeconds,
              fromAudio,
              fromKeyframePrompt: fromKeyframePrompt || '',
              fromPrompt: fromPrompt || '',
              globalScript,
              promptRoute: transitionPromptRoute,
              styleText,
              toAudio,
              toKeyframePrompt: toKeyframePrompt || '',
              toPrompt: toPrompt || '',
            })
        // Chained transitions arrive with the prompt already rewritten from the
        // planned keyframes (prepareLongTakeTransitionPrompt).
        const resolvedTransitionPrompt = params.preparedPrompt
          ? { keepPromptUnchanged: beatLoop, prompt: params.preparedPrompt }
          : await resolveTransitionPromptForModel({
              beatBoundarySeconds,
              cameraStyle: params.cameraStyle,
              clipIndex: params.clipIndex,
              durationSeconds: safeDuration,
              firstFramePath,
              firstFrameUri,
              fromAudio,
              fromKeyframePrompt,
              fromPrompt,
              globalScript,
              improvedVisualScriptEnabled,
              intermediateReferenceCount: intermediateKeyframeUris?.length,
              isNewStyleTransfer,
              lastFramePath: resolvedLastFramePath,
              lastFrameUri,
              projectId,
              prompt,
              promptRoute: transitionPromptRoute,
              seedance2TransitionPrompt,
              shouldUseSeedance2TransitionPrompt,
              shouldUseSeedance15TransitionPrompt,
              styleText,
              toAudio,
              toKeyframePrompt,
              toPrompt,
              transitionVideoModel: resolvedTransitionVideoModel,
              userId: userId || resolvedUserId,
            })
        // Hailuo sees the character in both frames; a text binding block only
        // adds noise to its short prompt.
        const resolvedPrompt = params.preparedPrompt
          ? params.preparedPrompt
          : isMinimaxModel(resolvedTransitionVideoModel)
            ? resolvedTransitionPrompt.prompt
            : seedance25References.bindPrompt(resolvedTransitionPrompt.prompt)
        if (promptOnly) return { prompt: resolvedPrompt }
        let currentPrompt = resolvedPrompt
        let promptUsedForBestAttempt = resolvedPrompt
        // The model that truly produced the clip. `resolvedTransitionVideoModel`
        // is only the REQUESTED model: gen-video's getModelName may swap it (debug
        // modelSwitch, dynamic config, Omni guard) and the record layer may fall
        // back mid-flight. Seeded with the request so the early failure paths
        // keep today's value.
        let modelUsedForBestAttempt: string = resolvedTransitionVideoModel
        let beatLoopMeta: BeatLoopClipMeta | undefined

        for (let attempt = 1; attempt <= MAX_QUALITY_ATTEMPTS; attempt++) {
          const attemptTaskId = uuidV4()
          promptUsedForBestAttempt = currentPrompt
          const clipRequest = {
            firstFramePath,
            firstFrameUri,
            lastFramePath: resolvedLastFramePath,
            lastFrameUri,
            projectId,
            prompt: currentPrompt,
            taskId: attemptTaskId,
            tempDir,
            transitionId,
            transitionUri,
            userId: userId || resolvedUserId,
          }
          const clipResult = beatLoop
            ? await generateBeatLoopClipVideo({
                ...clipRequest,
                model: resolvedTransitionVideoModel,
                onPaid: params.onBeatLoopClipPaid,
                outputName: params.outputName ?? transitionId,
                paidClip: params.beatLoopPaidClip,
              })
            : await generateTransitionVideoClipWithRecord({
                ...clipRequest,
                aspectRatio,
                resolution: videoResolution,
                defaultAspectRatio: DEFAULT_ASPECT_RATIO,
                isImageSensitiveError,
                isSensitivePromptError,
                orgId: params.orgId,
                referenceImageUrls: seedance25ReferenceImageUrls,
                rewritePromptForSafety,
                safeDuration,
                seedance2PromptAlreadyRewritten:
                  shouldUseSeedance15TransitionPrompt || shouldUseSeedance2TransitionPrompt,
                tier: admissionTier,
                transitionVideoModel: resolvedTransitionVideoModel,
                userEmail,
              })
          const generatedPath = clipResult.path
          modelUsedForBestAttempt = clipResult.actualModel
          promptUsedForBestAttempt = clipResult.prompt ?? promptUsedForBestAttempt

          assertMergedTransitionDurationCompatible({
            actualModel: clipResult.actualModel,
            seedance25MergedSegment: params.seedance25MergedSegment,
            targetDuration: safeDuration,
            transitionId,
          })

          // Models that emit a native audio track (Gemini Omni, Hailuo 3)
          // invent speech/soundtrack from the prompt, and the render
          // mixes each clip's own audio under the voiceover -- so strip it before
          // downstream quality checks / lip-sync. Gate on the model that ACTUALLY
          // produced the clip (clipResult.actualModel), not the requested model: a
          // fallback chain may swap the model mid-flight, so an H3 request that
          // fell back to Kling must keep its (silent) clip untouched, and only a
          // genuinely audio-emitting clip is stripped. Silent-model clips
          // (Seedance/Veo/Kling/Vidu) stay byte-for-byte. Loop clips keep theirs:
          // their hits and whooshes are the loop's sound.
          await stripNativeAudioInPlace({
            generatedPath,
            keepNativeAudio: beatLoop,
            model: clipResult.actualModel,
            tempDir,
            transitionId,
          })

          await persistTransitionArtifacts({
            attempt,
            generatedPath,
            projectId,
            storage,
            tempDir,
            transitionId,
          })

          // A loop clip is beat-locked instead (its first frame kept); the loop's own QA
          // judges it, and re-rolls are the loop workflow's call.
          if (beatLoop) {
            beatLoopMeta = await lockBeatLoopClip({ clip: clipResult, transitionId })
            bestVideoPath = generatedPath
            break
          }

          await withTimeout(
            retimeTransitionVideoIfNeeded({
              filePath: generatedPath,
              maxSpeedMultiplier: retimeMaxSpeedFor(params.cameraStyle),
              shouldDropFirstFrame: Boolean(params.dropFirstFrame),
              targetDuration: safeDuration,
              transitionId,
            }),
            RETIME_TIMEOUT_MS,
            () =>
              Promise.reject(
                new Error(
                  `[long-take] retime timed out after ${RETIME_TIMEOUT_MS}ms for transition ${transitionId}`,
                ),
              ),
          )

          // Run quality checks in parallel: gibberish text + black screen
          const [textResult, blackScreenResult] = await Promise.allSettled([
            withTimeout(
              checkTransitionVideoTextQuality(generatedPath, tempDir),
              TEXT_QUALITY_CHECK_TIMEOUT_MS,
              () =>
                Promise.reject(
                  new Error(
                    `[long-take] text quality check timed out after ${TEXT_QUALITY_CHECK_TIMEOUT_MS}ms for transition ${transitionId}`,
                  ),
                ),
            ),
            withTimeout(detectBlackScreen(generatedPath), BLACK_SCREEN_CHECK_TIMEOUT_MS, () =>
              Promise.reject(
                new Error(
                  `[long-take] black screen check timed out after ${BLACK_SCREEN_CHECK_TIMEOUT_MS}ms for transition ${transitionId}`,
                ),
              ),
            ),
          ])

          const qualityResult = evaluateQualityCheckResults({
            attempt,
            blackScreenResult,
            currentPrompt,
            projectId,
            resolvedPrompt,
            keepPromptUnchanged: resolvedTransitionPrompt.keepPromptUnchanged,
            textResult,
            transitionId,
          })
          const { qualityPassed, severity, isBlackScreen, bytesPerFrame } = qualityResult
          currentPrompt = qualityResult.currentPrompt

          if (qualityPassed) {
            bestVideoPath = generatedPath
            finalBytesPerFrame = bytesPerFrame
            break
          }

          const attemptSavePath = path.join(tempDir, `attempt-${attempt}-${transitionId}.mp4`)
          await fs.promises.copyFile(generatedPath, attemptSavePath)
          failedAttempts.push({
            actualModel: clipResult.actualModel,
            bytesPerFrame,
            isBlackScreen,
            path: attemptSavePath,
            prompt: promptUsedForBestAttempt,
            severity,
          })

          if (attempt < MAX_QUALITY_ATTEMPTS) {
            logger.warn(
              `[long-take] Retrying transition generation ${formatLogFields({
                projectId,
                transitionId,
                attempt,
                maxAttempts: MAX_QUALITY_ATTEMPTS,
                isBlackScreen,
              })}`,
            )
          }
        }

        if (!bestVideoPath) {
          const fallback = await resolveTransitionQualityFallback({
            failedAttempts,
            projectId,
            transitionId,
            transitionParams: params,
          })
          if (fallback.kind === 'static-hold') {
            return fallback.result
          }
          bestVideoPath = fallback.videoPath
          finalQualityCheck = fallback.qualityCheck
          finalBlackScreen = fallback.isBlackScreen
          finalBytesPerFrame = fallback.bytesPerFrame
          // The resolver sorts by quality, so the chosen clip may come from an
          // earlier attempt than the last one -- attribute it to ITS model/prompt.
          modelUsedForBestAttempt = fallback.actualModel
          promptUsedForBestAttempt = fallback.prompt
        }

        await uploadToStore(bestVideoPath, transitionUri)

        // Probe the ACTUAL composited clip dims (the model snaps off-9:16
        // at 480p, e.g. 496x864; the requested/nominal dims do not match). Render
        // crops-to-fill off-9:16 clips; probe failure -> {} -> full-frame fallback.
        const clipDims: { height?: number; width?: number } =
          (await probeVideoDimensions(bestVideoPath, logger, projectId)) ?? {}

        // Chained transitions start the next clip from this clip's real last
        // frame, so the join is seamless. A loop clip's takes each keep their own.
        let capturedLastFrameUri: string | undefined
        if (params.captureLastFrame) {
          const lastFramePng = path.join(tempDir, 'final_last_frame.png')
          await extractLastFrame(bestVideoPath, lastFramePng)
          capturedLastFrameUri = storage.getFullPath(
            `long_take/transitions/${lastFrameName(params)}_last.png`,
          )
          await uploadToStore(lastFramePng, capturedLastFrameUri)
        }

        logger.info(
          `[long-take] Transition generation completed ${formatLogFields({
            projectId,
            transitionId,
            videoUri: transitionUri,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          beatLoop: beatLoopMeta,
          bytesPerFrame: finalBytesPerFrame,
          endMs,
          fromShotId,
          isBlackScreen: finalBlackScreen || undefined,
          lastFrameUri: capturedLastFrameUri,
          prompt: promptUsedForBestAttempt,
          qualityCheck: finalQualityCheck,
          shouldLipSync: shouldLipSync === true,
          startMs,
          toShotId,
          transitionId,
          transitionVideoModel: modelUsedForBestAttempt,
          // Actual probed clip dims; undefined on probe failure (JSON
          // drops the key) -> render falls back to full-frame.
          videoHeight: clipDims.height,
          videoUri: transitionUri,
          videoWidth: clipDims.width,
        }
      } catch (error) {
        logger.error(
          `[long-take] Transition generation failed ${formatLogFields({
            projectId,
            transitionId,
            err: formatError(error),
          })}`,
        )
        throw error
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      }
    }),
  )
}

/** @internal Exported for testing */
export function resolveShouldUseSeedance2TransitionPrompt(params: {
  isNewStyleTransfer?: boolean
  isSeedance15TransitionModel: boolean
  resolvedTransitionVideoModel: string
}): boolean {
  if (params.isSeedance15TransitionModel) {
    return false
  }
  // Hailuo 3 ALWAYS takes the rewrite path: the no-rewrite path
  // hands the model the plan's raw prompt, which carries the hardcoded legacy
  // pan-splice ("as if scanning a continuous mural") -- a measured root cause
  // of H3's glitchy transitions (the H3 prompt handoff). Unconditional like
  // the Seedance 2.x branches (deliberately regardless of skipPromptRewrite):
  // rewrite-off must not silently re-admit the splice to H3.
  if (isMinimaxModel(params.resolvedTransitionVideoModel)) {
    return true
  }
  // Seedance 2.5 uses the Seedance prompt adapter for every clip; merged clips
  // keep the deterministic merged prompt as input, while singleton clips still
  // need the model-specific rewrite.
  if (isSeedance25Model(params.resolvedTransitionVideoModel)) {
    return true
  }
  return Boolean(params.isNewStyleTransfer || isSeedance2Model(params.resolvedTransitionVideoModel))
}

/**
 * A Story Mode 3.0 `cut` clip has no last frame: it is generated
 * i2v-only from its opening frame, and the cut itself is made by timeline
 * adjacency at render. Returns undefined then, so nothing downstream points at
 * a file that was never written. Every V2 path supplies a URI, so this is inert
 * there.
 */
async function downloadOptionalLastFrame(
  lastFrameUri: string | undefined,
  lastFramePath: string,
): Promise<string | undefined> {
  if (!lastFrameUri) {
    return undefined
  }
  await downloadAssetToLocal(lastFrameUri, lastFramePath)
  return lastFramePath
}

async function resolveTransitionPromptForModel(params: {
  beatBoundarySeconds?: number
  cameraStyle?: CameraStyle
  clipIndex?: number
  durationSeconds: number
  firstFramePath: string
  firstFrameUri: string
  fromAudio?: string
  fromKeyframePrompt?: string
  fromPrompt?: string
  globalScript?: string
  improvedVisualScriptEnabled?: boolean
  intermediateReferenceCount?: number
  isNewStyleTransfer?: boolean
  /** Absent for a Story Mode 3.0 `cut` clip, generated i2v-only. */
  lastFramePath?: string
  lastFrameUri?: string
  projectId: string
  prompt: string
  promptRoute?: GenerateLongTakeTransitionVideoActivityParams['promptRoute']
  seedance2TransitionPrompt: string
  shouldUseSeedance2TransitionPrompt: boolean
  shouldUseSeedance15TransitionPrompt: boolean
  styleText?: string
  toAudio?: string
  toKeyframePrompt?: string
  toPrompt?: string
  transitionVideoModel: string
  userId: string
}): Promise<{ keepPromptUnchanged: boolean; prompt: string }> {
  const hailuo = isMinimaxModel(params.transitionVideoModel)
  if (
    !hailuo &&
    !params.shouldUseSeedance15TransitionPrompt &&
    !params.shouldUseSeedance2TransitionPrompt
  ) {
    return { keepPromptUnchanged: false, prompt: params.prompt }
  }

  return {
    keepPromptUnchanged: false,
    prompt: await rewritePromptForSeedance2({
      beatBoundarySeconds: params.beatBoundarySeconds,
      cameraStyle: params.cameraStyle,
      clipIndex: params.clipIndex,
      durationSeconds: params.durationSeconds,
      firstFramePath: params.firstFramePath,
      firstFrameUri: params.firstFrameUri,
      fromAudio: params.fromAudio,
      fromKeyframePrompt: params.fromKeyframePrompt,
      fromPrompt: params.fromPrompt,
      intermediateReferenceCount: params.intermediateReferenceCount,
      isNewStyleTransfer: params.isNewStyleTransfer,
      lastFramePath: params.lastFramePath,
      lastFrameUri: params.lastFrameUri,
      projectId: params.projectId,
      prompt: params.seedance2TransitionPrompt,
      promptRoute: params.promptRoute,
      styleText: params.styleText,
      toAudio: params.toAudio,
      toKeyframePrompt: params.toKeyframePrompt,
      toPrompt: params.toPrompt,
      transitionVideoModel: params.transitionVideoModel,
      userId: params.userId,
    }),
  }
}

// The requested id as-is: prompt routing still keys legacy model families off
// it. The generation record resolves it to a registry key before generating.
function resolveTransitionPromptModel(configuredTransitionVideoModel?: string): string {
  if (
    configuredTransitionVideoModel &&
    isValidTransitionVideoModel(configuredTransitionVideoModel)
  ) {
    return configuredTransitionVideoModel
  }

  return resolveDefaultTransitionVideoModel().model
}

function resolveTransitionPromptRouteForModel(params: {
  promptRoute?: GenerateLongTakeTransitionVideoActivityParams['promptRoute']
  transitionVideoModel: string
}): GenerateLongTakeTransitionVideoActivityParams['promptRoute'] {
  return isSeedance25Model(params.transitionVideoModel)
    ? 'general'
    : resolveLongTakeTransitionPromptRoute(params.promptRoute)
}
