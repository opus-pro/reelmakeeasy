/**
 * UIP-to-Story-Mode Handoff Workflow (Architecture doc section 6.1-6.2)
 *
 * Independent workflow: takes UIP locked spec -> runs story-mode pipeline.
 * Reuses existing stage functions. Runs on STORY_MODE_TASK_QUEUE.
 *
 * Stages: voiceover -> [skip VS + anchors] -> shot_plan -> keyframes -> transitions -> render
 */

import { resolveLongTakeGenerationPromptRoute } from '@reelmakeeasy/common/long-take/prompt-route-generation'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { isSeedance25Model } from '@reelmakeeasy/common/veo3/model'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'
import { createWorkflowLogger } from '../../utilities/workflow-logger'
import {
  buildLongTakeShotPlan,
  generateLongTakeKeyframePrompts,
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

import type { UipToStoryModeWorkflowParams, UipToStoryModeWorkflowResult } from './types'
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

export async function UipToStoryModeWorkflow(
  params: UipToStoryModeWorkflowParams,
): Promise<UipToStoryModeWorkflowResult> {
  const {
    projectId,
    userId,
    userEmail,
    admissionTier = 'paid',
    script,
    visualScriptPath,
    styleName = 'Default',
    styleText = '',
    aspectRatio: aspectRatioStr = '16:9',
    voiceId,
    preVoiceover,
    generationResolution,
    imageModel,
    previewVoiceover,
    keyframeImageModel,
    orgId,
    transitionVideoModel,
    debugSettings,
    intentAnalysis,
    genreAnalysis,
    reusableStylePrompt,
    styleAnalysis,
    longVideoAttemptSource: handoffLongVideoAttemptSource,
    bgmEnabled,
    enableCaption,
    improvedVisualScriptEnabled: handoffImprovedVisualScriptEnabled,
    originalUserInput,
    promptRoute: handoffPromptRoute,
    uipMode,
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

  // Build pipelineContext from UIP planner outputs, plus the Style / Intent /
  // Genre Analysis entries that prompt-building activities (visual notes,
  // visual script, keyframe prompts) consume.
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
    //
    await runtime.setStageInProgress({ stage: 'voiceover' })
    logInfo('uipToStoryMode: starting voiceover')

    const { voiceoverResult, promptClassification } = await runPrepareInputsStage({
      logError,
      logInfo,
      preVoiceoverResult: preVoiceover
        ? {
            // ffprobe-measured full audio length (including trailing silence).
            // Threaded into runTransitionsStage so the final mp4 covers the
            // entire upload, not just up to the ASR last-word timestamp.
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
      uipMode,
    })

    // Music-video route: the audio is music when classified as music or when UIP confirmed music
    // intent (params.isMusic). Ads still stay on the text route even if the audio
    // classifier hears music. Mirrors the fast workflow.
    const audioIsMusic = params.isMusic === true || promptClassification?.is_music === true
    const isMusic = params.musicRouteIneligibleReason === undefined && audioIsMusic

    const musicRoute = await resolveMusicVideoRoute({ isMusic, textPromptRoute })
    let promptRoute = musicRoute.promptRoute

    logInfo('uipToStoryMode: prompt route resolved', {
      improvedVisualScriptEnabled: isImprovedVisualScriptEnabled,
      musicBeatCount: musicRoute.musicBeatCount,
      promptRouteSource,
      promptRoute,
      reason: promptRouteReason,
    })
    const promptRouteEntry = { name: 'Prompt Route', value: promptRoute }
    pipelineContext.push(promptRouteEntry)
    const trackedClassifiedPromptRoute = resolveUipTrackingPromptRouteClassified({
      classifiedPromptRoute,
      isMusic,
    })

    // Kick off BGM bed generation now that the voiceover duration and
    // music route are known. Best-effort floating promise that overlaps the
    // remaining generation stages (no serial latency) and is settled after
    // transitions. startUipBgmBed never rejects, so it can never fail the
    // project. promptRoute is read BEFORE any music->text demotion in
    // runUipVisualScriptStage: a demoted project still carries song audio, and
    // the locked product decision is no BGM over a song.
    // Captured here, for the same reason: the completion event's no_bgm_reason
    // must report the route BGM actually skipped on, not the demoted
    // one promptRoute holds by then.
    const bgmSongToVideo = promptRoute === 'music'
    const bgmBedPromise = startUipBgmBed({
      bgmEnabled,
      durationSec: voiceoverResult.audioDurationSeconds,
      isMusicRoute: bgmSongToVideo,
      logError,
      orgId,
      projectId,
      styleName,
      styleText: resolvedStyleText,
      userEmail,
      userId,
    })

    promptRoute = await runUipVisualScriptStage({
      promptRoute,
      runtime,
    })
    promptRouteEntry.value = promptRoute
    // Scene-writing route after any music-regen demotion. Drives the keyframe-prompt template below.
    const scenePromptRoute = promptRoute
    const generationPromptRoute = resolveLongTakeGenerationPromptRoute({
      promptRoute: scenePromptRoute,
      transitionVideoModel,
    })
    const trackedPromptRoute = isImprovedVisualScriptEnabled ? promptRoute : 'legacy'

    //
    await runtime.setStageCompleted({ stage: 'anchor_assets' })

    // Mirror LongTakeWorkflow visual-sequence.ts:104-111 ->
    // generateAndTrackKeyframePrompts. Reads long_take/visual_script.json
    // (already written by uip-confirm-orchestration at confirm time), runs
    // gemini-3.1-pro-preview with a route-aware prompt template, and writes
    // long_take/keyframe_prompts.json. buildLongTakeShotPlan reads that file
    // at shot-plan.ts:53 and overrides each shot's keyframe_prompt with the
    // polished version. Activity failures are non-fatal -- it writes a
    // fallback payload internally and shot-plan still works with the raw
    // keyframe_prompt fields.
    // Pass orgId and capture the single stylization decision so the
    // keyframe step reuses it -- baking here and suppressing the per-shot suffix
    // there used to check the gate independently (undefined vs real orgId) and
    // could disagree, applying the style twice.
    const keyframePromptResult = await generateLongTakeKeyframePrompts({
      orgId,
      pipelineContext,
      projectId,
      promptRoute: generationPromptRoute,
      userId,
    })

    //
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
    // adjacent bridges merge at generation time. One workflow-local key
    // drives both the keyframe and transition halves so they never disagree.
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

    // Enrich context; transitions always use the structured plan path
    // instead of the motion-design transition plan.
    await runContextEnrichmentStages({
      logError,
      logInfo,
      pipelineContext,
      projectId,
      userId,
    })

    //
    await runtime.setStageInProgress({ stage: 'transitions' })

    const { transitionVideos } = await runTransitionsStage({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      debugSettings,
      generationResolution,
      // Match prod: prefer the actual ASR-resolved voiceover script over the
      // raw UIP script. ASR text is what the user will hear; raw script may
      // diverge slightly. Mirrors `workflow.ts:resolveGlobalScript()` usage
      // in the prod LongTakeWorkflow transitions call.
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

    const renderTransitionVideos = buildRenderTransitionVideos(transitionVideos)
    // Resolved here (pure helper, no activity command); used for
    // trackCompleted.
    const effectiveTransitionVideoModel = resolveEffectiveTransitionVideoModel(
      transitionVideos,
      transitionVideoModel,
    )

    //
    await runtime.setStageInProgress({ stage: 'render' })

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
    const outputVideoLength = voiceoverResult.audioDurationSeconds ?? 0
    const { workflowId } = workflowInfo()
    const assetLibraryTracking = buildAssetLibraryTrackingProperties(transitionVideos)
    await runtime.releaseSlot({ admissionTier, projectId, workflowId })

    // Send completion notification (push / email) so users know the video
    // is ready, matching prod's `handleWorkflowCompletion`. Best-effort:
    // notification failure must not flip the workflow status.

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
        videoLength: outputVideoLength,
        voiceoverResult,
      }),
    })

    logInfo('uipToStoryMode: completed', { videoUri: renderResult.videoUri })
    return { status: 'completed', videoUri: renderResult.videoUri }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('uipToStoryMode: failed', { error: err.message })
    const { workflowId } = workflowInfo()
    await runtime.releaseSlot({ admissionTier, projectId, workflowId })
    await runtime.setWorkflowError(classifyWorkflowErrorDetail(error, err.message))
    return { status: 'failed' }
  }
}

// The visual_script stage; returns the prompt route downstream stages should use. Non-music
// (no music beat sheet): the visual script was pre-generated at confirm time by
// uip-confirm-orchestration (convertUipSpecToStoryModeVisualScript), so the stage is a no-op.
// New music path: the confirmed UIP storyboard is the source of truth for visuals, so do not
// regenerate/overwrite long_take/visual_script.json after confirm. The music beat sheet remains
// available to shot-plan as timing input; if its count does not match the confirmed visual script,
// shot-plan falls back to transcript timing instead of rewriting visuals. Pre-patch music route
// regenerated the visual script 1:1 against the music beat sheet.
async function runUipVisualScriptStage(params: {
  promptRoute: LongTakePromptRoute
  runtime: Awaited<ReturnType<typeof createLongTakeWorkflowRuntime>>
}): Promise<LongTakePromptRoute> {
  // The confirmed UIP storyboard is the source of truth for visuals on every
  // route, so this stage only flips the status.
  await params.runtime.setStageCompleted({ stage: 'visual_script' })
  return params.promptRoute
}
