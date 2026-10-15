/**
 * UIP-to-Story-Mode Fast Path Workflow
 *
 * Variant of UipToStoryModeWorkflow that skips the HITL phases
 * (bootstrap_visual + refinement). Instead of consuming pre-generated
 * visual script and anchor assets from UIP, it generates them itself
 * using the UIP context available at script_review completion.
 *
 * Stages: voiceover -> anchor_assets -> visual_script -> shot_plan -> keyframes -> transitions -> render
 */

import { resolveLongTakeGenerationPromptRoute } from '@reelmakeeasy/common/long-take/prompt-route-generation'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { isSeedance25Model } from '@reelmakeeasy/common/veo3/model'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import { createWorkflowLogger } from '../../utilities/workflow-logger'
import {
  buildLongTakeShotPlan,
  convertUipFastToLongTakeArtifactsActivity,
  generateLongTakeKeyframePrompts,
  generateUipFastAnchorVsBatchActivity,
  getLongTakeConcurrencyConfig,
  renderLongTakeVideo,
} from '../long-take/activity-proxies'
import { resolveMusicVideoRoute } from '../long-take/music-video-route'
import { buildRenderTransitionVideos } from '../long-take/render-transition-payload'
import {
  appendShotPlanFallbackStatusDetail,
  getShotPlanFallbackStatusDetail,
  getShotPlanFallbackStatusMeta,
} from '../long-take/shot-plan-fallback-status'
import { runPrepareInputsStage } from '../long-take/stages/prepare-inputs'
import { runTransitionsStage } from '../long-take/stages/transitions'
import { generateKeyframes } from '../long-take/stages/visual-sequence'
import { classifyWorkflowErrorDetail } from '../long-take/workflow-error-helpers'
import {
  buildAssetLibraryTrackingProperties,
  resolveEffectiveTransitionVideoModel,
  resolveGlobalScript,
  runContextEnrichmentStages,
} from '../long-take/workflow-helpers'
import type { LongTakeWorkflowLogFn } from '../long-take/workflow-runtime'
import { createLongTakeWorkflowRuntime } from '../long-take/workflow-runtime'

import type { UipToStoryModeFastWorkflowParams, UipToStoryModeWorkflowResult } from './types'
import {
  applyUipStyleContext,
  buildCompletionStatusMeta,
  buildPipelineContextFromUipParams,
  resolveUipPromptRoute,
  resolveUipStoryModeUserPrompt,
  resolveUipTrackingPromptRouteClassified,
  resolveUipWorkflowLongVideoAttemptSource,
  settleUipBgmBed,
  startUipBgmBed,
} from './workflow-helpers'

export async function UipToStoryModeFastWorkflow(
  params: UipToStoryModeFastWorkflowParams,
): Promise<UipToStoryModeWorkflowResult> {
  const {
    projectId,
    userId,
    userEmail,
    admissionTier = 'paid',
    script,
    styleName = 'Default',
    styleText = '',
    aspectRatio: aspectRatioStr = '16:9',
    voiceId,
    preVoiceover,
    previewVoiceover,
    generationResolution,
    transitionVideoModel,
    debugSettings,
    intentAnalysis,
    genreAnalysis,
    reusableStylePrompt,
    styleAnalysis,
    bgmEnabled,
    enableCaption,
    imageModel,
    improvedVisualScriptEnabled: handoffImprovedVisualScriptEnabled,
    keyframeImageModel,
    longVideoAttemptSource: handoffLongVideoAttemptSource,
    orgId,
    originalUserInput,
    promptRoute: handoffPromptRoute,
    promptRouteClassified: handoffPromptRouteClassified,
  } = params

  const aspectRatio = aspectRatioStr as AspectRatio
  const longVideoAttemptSource = resolveUipWorkflowLongVideoAttemptSource({
    handoffLongVideoAttemptSource,
    preVoiceoverAudioDurationSeconds: preVoiceover?.audioDurationSeconds,
    script,
  })

  // When UIP produced a `reusable_style_prompt`, use it as the styleText
  // threaded into keyframes / transitions. Mirrors prod LongTakeWorkflow
  // behavior at workflow.ts:621-623 where `styleAnalysis.reusableStylePrompt`
  // supersedes the raw user style text once style analysis has run. Falls
  // back to the seed `styleText` when there is none.
  const resolvedStyleText = reusableStylePrompt || styleText
  const storyModeUserPrompt = resolveUipStoryModeUserPrompt({ originalUserInput, script })

  // Build pipelineContext from UIP planner outputs. UIP context
  // (intentAnalysis, genreAnalysis, styleAnalysis) enriches visual script
  // generation and downstream stages in the same way as the full UIP flow.
  const pipelineContext = buildPipelineContextFromUipParams({
    aspectRatio: aspectRatioStr,
    keyframeImageModel,
    originalUserInput,
    script,
    styleName,
    styleText: resolvedStyleText,
    transitionVideoModel,
    voiceId,
  })
  applyUipStyleContext({
    genreAnalysis,
    intentAnalysis,
    pipelineContext,
    styleAnalysis,
  })

  setWorkflowScopedContext({
    projectId,
    storyModeAdmissionTier: admissionTier,
    userId,
    userEmail,
  })

  const logger = createWorkflowLogger({ projectId, userId })
  const logInfo: LongTakeWorkflowLogFn = (msg, fields = {}) => logger.info(msg, fields)
  const logError: LongTakeWorkflowLogFn = (msg, fields = {}) => logger.error(msg, fields)

  const runtime = await createLongTakeWorkflowRuntime({
    projectId,
    userId,
    userEmail,
  })

  const { videoConcurrency, imageConcurrency } = await getLongTakeConcurrencyConfig({
    projectId,
    userId,
  })
  const isImprovedVisualScriptEnabled = handoffImprovedVisualScriptEnabled ?? false

  try {
    await runtime.setStageInProgress({ stage: 'voiceover' })
    logInfo('uipToStoryModeFast: starting voiceover')

    const { voiceoverResult, promptClassification } = await runPrepareInputsStage({
      logError,
      logInfo,
      preVoiceoverResult: preVoiceover
        ? {
            audioDurationSeconds: preVoiceover.audioDurationSeconds,
            scriptText: preVoiceover.scriptText,
            speed: preVoiceover.speed,
            transcriptPath: preVoiceover.transcriptPath,
            voiceOverPath: preVoiceover.voiceOverPath,
          }
        : undefined,
      audioPath: preVoiceover ? undefined : previewVoiceover?.audioPath,
      // Marks that audio as TTS output, so the voiceover activity holds its ASR
      // to the script via the fidelity gate. Genuine user recordings
      // arrive through `preVoiceover` instead and stay ungated.
      audioSource: preVoiceover ? undefined : previewVoiceover?.source,
      projectId,
      runtime,
      script: previewVoiceover?.scriptText || script,
      userEmail,
      userId,
      userPrompt: previewVoiceover?.scriptText || storyModeUserPrompt,
      voiceId,
    })

    await runtime.setStageCompleted({ stage: 'voiceover' })

    const {
      classifiedPromptRoute,
      promptRoute: textPromptRoute,
      promptRouteReason,
      promptRouteSource,
    } = await resolveUipPromptRoute({
      handoffClassifiedPromptRoute: handoffPromptRouteClassified,
      handoffPromptRoute,
    })

    // Music-video route: the song is music when classified as music or when UIP confirmed music
    // intent (params.isMusic). Ads still stay on the text route even if the audio
    // classifier hears music.
    // Mirrors UipToStoryModeWorkflow.
    const audioIsMusic = params.isMusic === true || promptClassification?.is_music === true
    const isMusic = params.musicRouteIneligibleReason === undefined && audioIsMusic

    const { promptRoute: resolvedPromptRoute } = await resolveMusicVideoRoute({
      isMusic,
      textPromptRoute,
    })
    const promptRoute = resolvedPromptRoute
    const generationPromptRoute = resolveLongTakeGenerationPromptRoute({
      promptRoute,
      transitionVideoModel,
    })

    logInfo('uipToStoryModeFast: prompt route resolved', {
      generationPromptRoute,
      improvedVisualScriptEnabled: isImprovedVisualScriptEnabled,
      promptRoute,
      promptRouteSource,
      reason: promptRouteReason,
    })
    const trackedClassifiedPromptRoute = resolveUipTrackingPromptRouteClassified({
      classifiedPromptRoute,
      isMusic,
    })
    const trackedPromptRoute = resolveTrackedPromptRoute(isImprovedVisualScriptEnabled, promptRoute)
    pipelineContext.push({ name: 'Prompt Route', value: promptRoute })

    // Anchor + visual-script generation. Reuses the SAME uip-planner-runtime
    // code as the normal `anchor_vs_batch` tool + the SAME spec->render
    // converters the normal confirm path runs, so a fix there benefits both
    // paths (zero drift). The drifted long-take fork this used to fall back to
    // is gone.
    // Reconstruct a SessionState from storage and run the shared anchor+VS batch
    // core (the exact code the normal `anchor_vs_batch` tool runs), committing
    // the shots into the spec and persisting it.
    await runtime.setStageInProgress({ stage: 'anchor_assets' })
    // generateUipFastAnchorVsBatchActivity already throws (nonRetryable,
    // uip_fast_empty_visual_script) when the batch commits zero shots, so
    // gen.shotCount is guaranteed >= 1 here.
    const gen = await generateUipFastAnchorVsBatchActivity({
      generationResolution,
      imageModel,
      modelSelectorTier: params.modelSelectorTier,
      orgId,
      projectId,
      script,
      transitionVideoModel,
    })
    await runtime.setStageCompleted({
      stage: 'anchor_assets',
      meta: { numAssetsGenerated: gen.anchorSummary?.ready_count ?? 0 },
    })

    // Convert the generated spec + anchors into the long-take render artifacts
    // (visual_script.json, styled/raw anchor indexes, the UIP sentinel,
    // asset_manifest, world_bible, global_constraints) using the SAME shared
    // converters the normal confirm path uses.
    await runtime.setStageInProgress({ stage: 'visual_script' })
    const converted = await convertUipFastToLongTakeArtifactsActivity({
      anchorPlan: gen.anchorPlan,
      anchorSummary: gen.anchorSummary,
      projectId,
    })
    await runtime.setStageCompleted({
      stage: 'visual_script',
      meta: { itemCount: converted.shotCount },
    })
    logInfo('uipToStoryModeFast: shared anchor+VS generation complete', {
      anchorCount: converted.anchorCount,
      itemCount: converted.shotCount,
    })

    const visualScriptPath = 'long_take/visual_script.json'
    // generateLongTakeBgmBed's first step reads world_bible.json (+
    // global_constraints.json) from storage, which convert just wrote, so the bed
    // starts only now. Floating best-effort promise, settled after transitions.
    const bgmBedPromise = startUipBgmBed({
      bgmEnabled,
      durationSec: voiceoverResult.audioDurationSeconds,
      isMusicRoute: promptRoute === 'music',
      logError,
      orgId,
      projectId,
      styleName,
      styleText: resolvedStyleText,
      userEmail,
      userId,
    })
    // Reads long_take/visual_script.json (written by convert) and writes
    // long_take/keyframe_prompts.json. Awaited sequentially (regular activity);
    // no user-upload anchor merge is needed -- the convert step already injected
    // user uploads into the anchor index via buildUserUploadAnchorEntries.
    const keyframePromptResult = await generateLongTakeKeyframePrompts({
      orgId,
      pipelineContext,
      projectId,
      promptRoute: generationPromptRoute,
      userId,
    })

    await runtime.setStageInProgress({ stage: 'shot_plan' })

    const shotPlanResult = await buildLongTakeShotPlan({
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      pipelineContext,
      projectId,
      promptRoute: generationPromptRoute,
      transitionVideoModel,
      userEmail,
      userId,
      visualScriptPath,
    })

    await runtime.setStageCompleted({
      stage: 'shot_plan',
      detail: getShotPlanFallbackStatusDetail(shotPlanResult),
      meta: {
        shotCount: shotPlanResult.shotCount,
        ...getShotPlanFallbackStatusMeta(shotPlanResult),
      },
    })

    // Seedance 2.5 merged transitions: planning stays legacy;
    // adjacent bridges merge at generation time. One workflow-local key drives
    // both the keyframe and transition halves so they never disagree.
    const useSeedance25MergedTransitions = isSeedance25Model(transitionVideoModel)

    const { keyframes } = await generateKeyframes({
      admissionTier,
      aspectRatio,
      generationResolution,
      imageModel,
      imageConcurrency,
      keyframeImageModel,
      logInfo,
      orgId,
      projectId,
      promptRoute: generationPromptRoute,
      runtime,
      shotPlanResult,
      styleName,
      styleText: resolvedStyleText,
      stylizeKeyframes: keyframePromptResult.stylizeKeyframes,
      userId,
    })

    await runContextEnrichmentStages({
      logError,
      logInfo,
      pipelineContext,
      projectId,
      userId,
    })

    await runtime.setStageInProgress({ stage: 'transitions' })

    const { transitionVideos } = await runTransitionsStage({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      debugSettings,
      generationResolution,
      globalScript: resolveGlobalScript(voiceoverResult.scriptText, script),
      improvedVisualScriptEnabled: isImprovedVisualScriptEnabled,
      keyframes,
      logInfo,
      orgId,
      pipelineContext,
      projectId,
      promptRoute: generationPromptRoute,
      runtime,
      seedance25MergedTransitions: useSeedance25MergedTransitions,
      seedance25SegmentTopology: false,
      shotPlan: shotPlanResult.shotPlan,
      styleText: resolvedStyleText,
      transitionVideoModel,
      userEmail,
      userId,
      videoConcurrency,
    })

    await runtime.setStageCompleted({ stage: 'transitions' })

    // Settle the bed generation started after the music-route
    // resolution, persist its metadata, and keep the bed so the render below
    // bakes it into the export. Fully fail-soft (see settleUipBgmBed).
    const bgmBed = await settleUipBgmBed({
      bgmBedPromise,
      logError,
      projectId,
      userEmail,
      userId,
    })

    await runtime.setStageInProgress({ stage: 'render' })

    const renderTransitionVideos = buildRenderTransitionVideos(transitionVideos)
    // Resolved here (pure helper, no activity command); used for
    // trackCompleted.
    const effectiveTransitionVideoModel = resolveEffectiveTransitionVideoModel(
      transitionVideos,
      transitionVideoModel,
    )

    const renderResult = await renderLongTakeVideo({
      aspectRatio,
      bgmBedUri: bgmBed?.fileUri,
      enableCaption,
      projectId,
      transitionVideos: renderTransitionVideos,
      userEmail,
      userId,
    })

    await runtime.setStageCompleted({ stage: 'render' })

    const { workflowId } = workflowInfo()
    const assetLibraryTracking = buildAssetLibraryTrackingProperties(transitionVideos)
    await runtime.releaseSlot({ admissionTier, projectId, workflowId })

    await runtime.setStageCompleted({
      stage: 'completed',
      detail: appendShotPlanFallbackStatusDetail(
        renderResult.videoUri ? 'Render complete' : undefined,
        shotPlanResult,
      ),
      meta: buildCompletionStatusMeta({
        aspectRatio,
        assetLibraryTransitionsCount: assetLibraryTracking.assetLibraryTransitionsCount,
        longVideoAttemptSource,
        promptRouteClassified: trackedClassifiedPromptRoute,
        promptRouteEffective: promptRoute,
        promptRoute: trackedPromptRoute,
        promptUseCase: promptClassification?.use_case,
        shotPlanResult,
        transitionVideoModel: effectiveTransitionVideoModel,
        videoLength: voiceoverResult.audioDurationSeconds ?? 0,
        voiceoverResult,
      }),
    })

    logInfo('uipToStoryModeFast: completed', { videoUri: renderResult.videoUri })
    return { status: 'completed', videoUri: renderResult.videoUri }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('uipToStoryModeFast: failed', { error: err.message })

    const { workflowId } = workflowInfo()
    await runtime.releaseSlot({ admissionTier, projectId, workflowId })
    await runtime.setWorkflowError(classifyWorkflowErrorDetail(error, err.message))
    return { status: 'failed' }
  }
}

function resolveTrackedPromptRoute(
  improvedVisualScriptEnabled: boolean,
  promptRoute: NonNullable<UipToStoryModeFastWorkflowParams['promptRoute']>,
): 'legacy' | NonNullable<UipToStoryModeFastWorkflowParams['promptRoute']> {
  return improvedVisualScriptEnabled ? promptRoute : 'legacy'
}
