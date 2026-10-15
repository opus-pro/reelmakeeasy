/**
 * UIP-to-Story-Mode handoff, Story Mode 3.0 topology.
 *
 * Same inputs and same delivery as `UipToStoryModeWorkflow`, one difference that
 * changes everything downstream: **a clip is a whole shot**. V2 derives clips
 * center-to-center, so each one straddles two shots and contains neither
 * completely -- its keyframe is pinned mid-motion, which forces every clip to
 * decelerate into a fixed composition and accelerate out of it. Here the
 * keyframe is the shot's OPENING frame, the clip spans the shot's own time
 * range, and `transition_to_next` decides whether the clip is generated
 * i2v-only (a `cut`, made by timeline adjacency at render) or first-and-last
 * frame (`continuous`).
 *
 * A separate workflow type rather than a branch in the V2 one: new type, new
 * activities, no in-flight histories. Routing happens in the API layer, on
 * the pinned `spec.meta.story_mode_v3_enabled` snapshot.
 *
 * Stages: voiceover -> shot_plan (realign) -> keyframe_prompts -> keyframes ->
 * transitions (clip prompts + clips) -> render. Everything outside the visual
 * chain is reused verbatim from V2.
 */

import { resolveLongTakeGenerationPromptRoute } from '@reelmakeeasy/common/long-take/prompt-route-generation'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'
import { createWorkflowLogger } from '../../utilities/workflow-logger'
import { generateV3ClipPrompts, realignV3ShotTimes } from '../long-take/activity-proxies'
import {
  generateLongTakeKeyframePrompts,
  getLongTakeConcurrencyConfig,
  renderLongTakeVideo,
} from '../long-take/activity-proxies'
import { resolveMusicVideoRoute } from '../long-take/music-video-route'
import { buildRenderTransitionVideos } from '../long-take/render-transition-payload'
import { runPrepareInputsStage } from '../long-take/stages/prepare-inputs'
import { generateKeyframes } from '../long-take/stages/visual-sequence'
import { classifyWorkflowErrorDetail } from '../long-take/workflow-error-helpers'
import {
  buildAssetLibraryTrackingProperties,
  resolveEffectiveTransitionVideoModel,
} from '../long-take/workflow-helpers'
import type { LongTakeWorkflowLogFn } from '../long-take/workflow-runtime'
import { createLongTakeWorkflowRuntime } from '../long-take/workflow-runtime'
import type {
  UipToStoryModeWorkflowParams,
  UipToStoryModeWorkflowResult,
} from '../uip-to-story-mode/types'
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
} from '../uip-to-story-mode/workflow-helpers'

import { applyV3KeyframePrompts, runV3ClipsStage } from './stages/clips'

export async function UipToStoryModeV3Workflow(
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
    logInfo('uipToStoryModeV3: starting voiceover')

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

    logInfo('uipToStoryModeV3: prompt route resolved', {
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

    // Story Mode 3.0. Everything below replaces V2's
    // shot-plan -> keyframes -> center-to-center transitions chain. The
    // scaffolding around it -- voiceover, BGM, render,
    // notification -- is reused verbatim.
    //
    // Shot boundaries first: the planner's `time` is a 150-wpm estimate in text
    // mode (no audio existed when the spec was written), and here every clip IS
    // a shot, so its duration and its place on the render timeline both come
    // from the real transcript.
    await runtime.setStageInProgress({ stage: 'shot_plan' })

    const shotTimes = await realignV3ShotTimes({
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
      meta: {
        shotCount: shotTimes.shotCount,
        timingSource: shotTimes.timingSource,
        unalignedShotCount: shotTimes.unalignedShotCount,
      },
    })

    // The keyframe is this shot's OPENING frame, not a mid-shot peak: the clip
    // is animated away from it rather than made to pass through it.
    const keyframePromptResult = await generateLongTakeKeyframePrompts({
      openingInstantOnly: true,
      orgId,
      pipelineContext,
      projectId,
      promptRoute: generationPromptRoute,
      userId,
    })

    const shotPlan = applyV3KeyframePrompts(shotTimes.shotPlan, keyframePromptResult.promptByShotId)

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
      shotPlanResult: { shotCount: shotPlan.length, shotPlan },
      styleName,
      styleText: resolvedStyleText,
      stylizeKeyframes: keyframePromptResult.stylizeKeyframes,
      userId,
    })

    //
    await runtime.setStageInProgress({ stage: 'transitions' })

    // Runs AFTER keyframe generation on purpose: the model is shown the frame it
    // animates away from (and, for a `continuous` hand-off, the one it must land
    // on) instead of a description of them.
    const { clipPrompts, usedFallback: clipPromptsUsedFallback } = await generateV3ClipPrompts({
      keyframeUriByShotId: Object.fromEntries(
        keyframes.map((keyframe) => [keyframe.shotId, keyframe.keyframeUrl]),
      ),
      pipelineContext,
      projectId,
      shotPlan,
      styleText: resolvedStyleText,
      userId,
    })

    const { clipVideos: transitionVideos } = await runV3ClipsStage({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      clipPrompts,
      debugSettings,
      generationResolution,
      keyframes,
      logInfo,
      orgId,
      pipelineContext,
      projectId,
      shotPlan,
      styleText: resolvedStyleText,
      transitionVideoModel,
      userEmail,
      userId,
      videoConcurrency,
    })

    logInfo('uipToStoryModeV3: clips generated', {
      clipCount: transitionVideos.length,
      clipPromptsUsedFallback,
      shotCount: shotPlan.length,
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
      detail: renderResult.videoUri ? 'Render complete' : undefined,
      meta: buildCompletionStatusMeta({
        aspectRatio,
        assetLibraryTransitionsCount: assetLibraryTracking.assetLibraryTransitionsCount,
        longVideoAttemptSource,
        promptRouteClassified: trackedClassifiedPromptRoute,
        promptRouteEffective: promptRoute,
        promptRoute: trackedPromptRoute,
        promptUseCase: promptClassification?.use_case,
        shotPlanResult: { shotCount: shotPlan.length },
        transitionVideoModel: effectiveTransitionVideoModel,
        videoLength: outputVideoLength,
        voiceoverResult,
      }),
    })

    logInfo('uipToStoryModeV3: completed', { videoUri: renderResult.videoUri })
    return { status: 'completed', videoUri: renderResult.videoUri }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('uipToStoryModeV3: failed', { error: err.message })
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
  // route, so this stage only flips the status. It exists at all because the FE
  // progress UI expects a `visual_script` transition.
  await params.runtime.setStageCompleted({ stage: 'visual_script' })
  return params.promptRoute
}
