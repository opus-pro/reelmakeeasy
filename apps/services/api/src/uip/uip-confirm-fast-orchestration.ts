import { createSubLogger } from '@reelmakeeasy/common/logger'
import { STORY_MODE_ADMISSION_TIER } from '@reelmakeeasy/common/long-take/queue-admission'
import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import { runWithContext } from '@reelmakeeasy/common/utils/req-ctx'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import {
  brandStagedAssetsToUploads,
  dedupeUploadedAssets,
  type PersistedSessionState,
  resolvePromptRouteForSession,
  type Spec,
  type UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'
import type { Client } from '@reelmakeeasy/workflow-engine/client'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'
import type { VoiceOverService } from '../voice-over/voice-over.service'

import { resolveBrandAnchorLibraryKey } from './uip-brand-anchor-library.util'
import {
  buildUserAssetCatalogForTracking,
  countAssetMentionsAcrossUserMessages,
} from './uip-confirm-anchor-tracking'
import { commitUipConfirmedLock, isWorkflowAlreadyStartedError } from './uip-confirm-lock'
import {
  assertBrandExtractionSettled,
  buildCustomStyleAnalysisJson,
  buildLongTakeGlobalConstraintsJson,
  buildOptionalHandoffSaves,
  buildStyleAnalysisFromSpec,
  buildStyleSourceJson,
  fetchPreVoiceoverHandoff,
  isStylizableStyleRef,
  loadUipAssetPlanAsManifest,
  loadUipWorldBibleJson,
  resolveEffectivePromptRouteForHandoff,
  resolveNstWorkflowInputs,
  resolveOrGeneratePreviewVoiceoverHandoff,
  resolvePromptRouteArtifactForHandoff,
} from './uip-confirm-orchestration'
import { markSessionContinued } from './uip-continue-marker'
import { extractDebugModelSwitch } from './uip-debug-settings'
import { resolveUipLongVideoAttemptSource } from './uip-long-video-attribution'
import {
  resolveUipMusicIntent,
  resolveUipMusicRouteIneligibleReason,
  resolveUipMusicSignalSource,
} from './uip-music-intent.util'
import { getPinnedUserInputFromTimeline } from './uip-original-user-input'
import { extractScriptFromSpec, stripInlineTtsMarkupForDisplay } from './uip-planner-utils'
import { resolvePreviewHandoffScript } from './uip-preview-voiceover-handoff'
import {
  extractPromptPronunciationDict,
  pronunciationDictOption,
} from './uip-pronunciation-instructions'
import type { UipSessionState } from './uip-timeline-types'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'
import { isStoreUri, storeUri } from '@reelmakeeasy/common/storage/stored-files'

const logger = createSubLogger('uip-service')

const UIP_TO_STORY_MODE_FAST_WORKFLOW_TYPE = 'UipToStoryModeFastWorkflow'
const STORY_MODE_BASE_TASK_QUEUE = 'ao-story-mode'

// `firstStart` on the `started` result is true only when THIS call performed the
// real workflow start. The idempotent "already running" branch (a concurrent
// confirm / at-least-once retry that lost the deterministic-workflowId start race)
// returns false, so the caller fires the once-only uipVideoStarted /
// uipScriptConfirmed emit exactly once while `status: 'started'` still drives the
// uip-confirm-fast signal in both cases. Mirrors executeConfirmOrchestration's
// `confirmedLockStarted` boolean.
export type ConfirmFastOrchestrationResult =
  | { firstStart: boolean; status: 'started' }
  | { reason: 'word_cap_exceeded'; status: 'action_required' }
  | { status: 'already_confirmed' }

type ConfirmFastPreflightSession = {
  lockedAt?: Date | null
  phase?: null | string
  state?: unknown
}

// Mirrors UipFastPathUploadedAsset in story-mode-runtime. Duplicated to keep
// api free of story-mode-runtime imports.
interface UipFastPathUploadedAssetForHandoff {
  assetId: string
  contentType: string
  fileName?: null | string
  fileUri: string
}

export async function executeConfirmFastOrchestration(params: {
  getWorkflowClient: () => Promise<Client>
  prisma: PrismaService
  projectId: string
  voiceOverService?: VoiceOverService
}): Promise<ConfirmFastOrchestrationResult> {
  const { getWorkflowClient, prisma, projectId, voiceOverService } = params

  const uipSession = await prisma.uipSession.findUnique({ where: { projectId } })
  if (!uipSession) {
    throw new NotFoundException(`UIP session not found: ${projectId}`)
  }
  const preflightResult = checkConfirmFastPreflight(projectId, uipSession)
  if (preflightResult) {
    return preflightResult
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    throw new NotFoundException(`Project not found: ${projectId}`)
  }

  const projectUserId = project.owner ?? project.userId ?? ''
  const projectOrgId = project.orgId ?? ''
  const store = fileStore
  const uipPrefix = `projects/${projectId}/user-intent-planner`
  const projectPrefix = `projects/${projectId}`

  const [specFile, sessionStateFile] = await Promise.all([
    store.file(`${uipPrefix}/spec/current/spec.json`).read(),
    store.file(`${uipPrefix}/session-state.json`).read(),
  ])
  const spec: Spec = JSON.parse(specFile.toString())
  const sessionState: PersistedSessionState = JSON.parse(sessionStateFile.toString())

  // Refuse a pending-brand confirm BEFORE marking the session continued.
  assertBrandExtractionSettled(projectId, spec.global_constraints)

  await markSessionContinued(prisma, projectId)
  logger.info(`[${projectId}] Session continued, proceeding with confirm-fast orchestration`)

  const assetManifest = await loadUipAssetPlanAsManifest(store, projectId, uipPrefix)
  const worldBibleJson = await loadUipWorldBibleJson(store, projectId, uipPrefix)
  const globalConstraintsJson = buildLongTakeGlobalConstraintsJson(spec)
  // Hand off style_source.json (which drives keyframe stylization) for
  // every style except presets, so presets keep their legacy look.
  const styleSourceJson = isStylizableStyleRef(uipSession.selectedStyleRef)
    ? buildStyleSourceJson(spec)
    : null
  const { handoffScript, script } = resolveConfirmFastScriptHandoff({
    projectId,
    sessionState,
    spec,
    timeline: uipSession.timeline,
  })
  const previewHandoffScript = resolvePreviewHandoffScript({
    confirmedScript: uipSession.confirmedScript,
    fallbackScript: script,
    sessionState,
  })
  const dbSessionState = (uipSession.state ?? {}) as UipSessionState

  const storyModeWorkflowId = getWorkflowId(projectId, 'story-mode', 'uip-pipeline')
  // `true` only when THIS call performed the real workflow start -- drives the
  // once-only uipVideoStarted / uipScriptConfirmed emit. A
  // concurrent confirm or an at-least-once retry that finds the workflow already
  // running leaves it `false`, so the caller still signals but does not re-fire
  // tracking. Mirrors executeConfirmOrchestration's `confirmedLockStarted`.
  let fastStarted = false

  // The confirm-lock markers (lockedAt / stage / status) are committed only AFTER
  // the fast workflow is durably running -- writing them before
  // `workflow.start` let a mid-flight interruption (a pod SIGKILL during a
  // rollout) strand the session as permanently "confirmed" (checkConfirmFastPreflight
  // short-circuits every retry) with no workflow ever created. A pre-start failure
  // is rethrown (see the catch below), so the retried triggerNextActionActivity
  // self-heals.
  try {
    const seenAssetIds = new Set<string>()
    const sessionUploadedAssets: UploadedAsset[] = [
      ...(sessionState.uploaded_assets ?? []),
      ...(sessionState.cached_artifacts?.uploaded_assets ?? []),
    ].filter((a) => {
      if (!a.asset_id || seenAssetIds.has(a.asset_id)) {
        return false
      }
      seenAssetIds.add(a.asset_id)
      return true
    })

    // Surface brand_bank staged assets (crawled logos / product shots) to the
    // fast workflow so its anchor planning can source them, mirroring the
    // brand merge in executeConfirmOrchestration. Dedup collapses an image
    // present as both a real upload and its brand-staged synthetic; real
    // uploads win.
    const brandBankUploads = brandStagedAssetsToUploads(spec.global_constraints.brand_bank ?? null)
    const allUploadedAssets = dedupeUploadedAssets([...sessionUploadedAssets, ...brandBankUploads])

    // Build the uploadedAssets list for the fast workflow. The workflow uses
    // these to seed the anchor index with user-uploaded reference images,
    // equivalent to buildUserUploadAnchorEntries in executeConfirmOrchestration.
    const uploadedAssets: UipFastPathUploadedAssetForHandoff[] = allUploadedAssets
      .filter((a): a is UploadedAsset & { asset_id: string; file_path: string } =>
        Boolean(a.file_path && a.asset_id),
      )
      .map((a) => ({
        assetId: a.asset_id,
        contentType: a.content_type ?? '',
        fileName: a.file_name ?? null,
        // Brand-staged synthetics carry a full store:// staging URI; chat
        // uploads are relative to the planner prefix.
        fileUri: isStoreUri(a.file_path) ? a.file_path : storeUri(`${uipPrefix}/${a.file_path}`),
      }))

    // Tracking-only metadata for `project.long_take.completed` event parity.
    const userAssetCatalog = buildUserAssetCatalogForTracking(allUploadedAssets)
    const numAssetMentions = countAssetMentionsAcrossUserMessages(uipSession.timeline)
    const originalUserInput = getPinnedUserInputFromTimeline(uipSession.timeline)
    const promptPronunciationDict = extractPromptPronunciationDict(originalUserInput)
    const promptRouteArtifact =
      resolvePromptRouteArtifactForHandoff(sessionState) ??
      (await resolvePromptRouteForSession({
        originalUserInput,
        script: handoffScript,
        session: {
          cached_artifacts: {
            prompt_route:
              sessionState.cached_artifacts?.prompt_route ?? sessionState.prompt_route ?? null,
          },
          // This literal is hand-built, so the tier only reaches the
          // route classifier if it is named here. Same parse as the workflow
          // args below.
          modelSelectorTier: parseModelSelectorAnalyticsTier(uipSession.modelSelectorTier),
          sessionId: projectId,
          spec,
          transcript: [],
        },
      }))
    const effectivePromptRoute = resolveEffectivePromptRouteForHandoff(promptRouteArtifact)
    const promptRouteJson = promptRouteArtifact
      ? JSON.stringify(
          {
            effective_prompt_route: effectivePromptRoute,
            gate_enabled: promptRouteArtifact.gate_enabled,
            music_video_improvement_enabled: promptRouteArtifact.music_video_improvement_enabled,
            prompt_route: promptRouteArtifact.prompt_route,
            reasoning: promptRouteArtifact.reasoning,
          },
          null,
          2,
        )
      : null
    const promptRouteArtifactJson = promptRouteArtifact
      ? JSON.stringify(promptRouteArtifact, null, 2)
      : null

    // Persist a saved CUSTOM style's full V6 analysis for the project
    // (parity with the standard confirm path).
    const customStyleAnalysisJson = await buildCustomStyleAnalysisJson(
      prisma,
      uipSession.selectedStyleRef,
    )

    // Write only the optional handoff artifacts. visual_script.json and anchor
    // indexes are NOT written here -- the fast workflow generates them itself
    // from the spec + uploaded assets.
    await Promise.all(
      buildOptionalHandoffSaves(store, projectPrefix, {
        assetManifest,
        customStyleAnalysisJson,
        globalConstraintsJson,
        promptRouteArtifactJson,
        promptRouteJson,
        styleSourceJson,
        worldBibleJson,
      }),
    )

    const workflowClient = await getWorkflowClient()

    const preVoiceover =
      spec.meta?.audio_source === 'user_audio'
        ? await fetchPreVoiceoverHandoff(workflowClient, projectId)
        : undefined
    const previewVoiceover = preVoiceover
      ? undefined
      : await resolveOrGeneratePreviewVoiceoverHandoff({
          projectId,
          ...pronunciationDictOption(promptPronunciationDict),
          script: previewHandoffScript,
          sessionState: dbSessionState,
          transcriptVoicePreviewEnabled: spec.meta?.transcript_voice_preview_enabled === true,
          voiceId: uipSession.voiceId,
          voiceOverJson: project.voiceOverJson,
          voiceOverService,
        })

    const admissionTier = STORY_MODE_ADMISSION_TIER

    const taskQueue = await resolveTaskQueueForClient(STORY_MODE_BASE_TASK_QUEUE)
    const styleAnalysis = buildStyleAnalysisFromSpec(spec.global_constraints.style)
    const reusableStylePrompt = spec.global_constraints.style.reusable_prompt?.trim() || undefined
    const nstInputs = await resolveNstWorkflowInputs({
      originalUserInput,
      ownerEmail: project.ownerEmail,
      projectId,
      projectOrgId,
      projectUserId,
      script: handoffScript,
      sessionState,
      styleText: reusableStylePrompt || spec.global_constraints.style.style_text || undefined,
      uipPrefix,
    })

    try {
      // Wrap in runWithContext so the ReqCtxClientInterceptor injects org_id /
      // user_id into the workflow's header. Without this, sessions triggered by
      // internal callbacks start the workflow with an empty ReqContext.
      const requestedDurationSeconds = spec.meta?.mode_state?.duration_seconds
      const longVideoAttemptSource = resolveUipLongVideoAttemptSource({
        audioDurationSeconds: preVoiceover?.audioDurationSeconds,
        requestedDurationSeconds,
        script: handoffScript,
        timeline: uipSession.timeline,
      })
      // For a saved-brand session with an effective style, resolve the
      // brand anchor-library key so the fast-path render stores + reuses anchors
      // against the SAME (brief, style) storage key the standard path uses. Shared
      // resolution so the two confirm
      // paths can never derive different style hashes. Absent (non-brand, no
      // org, or no style) => render-side store/reuse no-op.
      const brandAnchorLibrary = resolveBrandAnchorLibraryKey({
        projectOrgId,
        projectStyleName: project.styleName,
        sessionState,
        spec,
      })
      const handle = await runWithContext(
        { org_id: projectOrgId, user_id: projectUserId, login_id: projectUserId },
        () =>
          workflowClient.workflow.start(UIP_TO_STORY_MODE_FAST_WORKFLOW_TYPE, {
            args: [
              {
                projectId,
                userId: project.owner ?? '',
                // Present only for a saved-brand session; omit otherwise
                // so non-brand fast renders serialize exactly as before.
                ...(brandAnchorLibrary ? { brandAnchorLibrary } : {}),
                userEmail: project.ownerEmail ?? undefined,
                script: handoffScript,
                styleName: spec.global_constraints.style.style_name || undefined,
                styleText: spec.global_constraints.style.style_text || undefined,
                // Auto Style Selection provenance (Task 2/6): fast-path
                // parity with the full confirm orchestration above, stamped on
                // `project.long_take.completed` for the guardrail metrics.
                // Same 'manual' default -- see the rationale there.
                styleSource: spec.global_constraints.style_source ?? 'manual',
                selectionMethod: spec.global_constraints.selection_method,
                // Ranked candidate set (top pick first) as style names; with the
                // shipped styleName it yields decision quality on completed.
                styleCandidates: spec.global_constraints.style_candidates?.map(
                  (candidate) => candidate.style_name,
                ),
                reusableStylePrompt,
                styleAnalysis,
                intentAnalysis: nstInputs.intentAnalysis,
                genreAnalysis: nstInputs.genreAnalysis,
                styleReferenceImageUrls: nstInputs.styleReferenceImageUrls,
                improvedVisualScriptEnabled: promptRouteArtifact?.gate_enabled,
                originalUserInput,
                promptRoute: effectivePromptRoute,
                promptRouteClassified: promptRouteArtifact?.prompt_route,
                // Strong music intent from either the song-to-video entry preset
                // or the UIP planner's audio_music classification. Lets the
                // workflow build a music beat sheet without depending solely on
                // the later audio-verdict classifier; gate + beat-sheet guards
                // still apply downstream.
                isMusic: resolveUipMusicIntent(spec),
                musicRouteIneligibleReason: resolveUipMusicRouteIneligibleReason(spec) ?? undefined,
                // Which signal carried the music intent (preset / planner /
                // content detector / none) -- tracking-only attribution for
                // the routing-quality panel.
                musicSignalSource: resolveUipMusicSignalSource(spec),
                preVoiceover,
                previewVoiceover: previewVoiceover
                  ? {
                      audioPath: previewVoiceover.audio_path,
                      scriptText:
                        stripInlineTtsMarkupForDisplay(previewVoiceover.script_text) ||
                        handoffScript,
                      source: 'tts_preview',
                    }
                  : undefined,
                requestedDurationSeconds:
                  typeof requestedDurationSeconds === 'number' &&
                  Number.isFinite(requestedDurationSeconds) &&
                  requestedDurationSeconds > 0
                    ? requestedDurationSeconds
                    : undefined,
                aspectRatio: uipSession.aspectRatio ?? undefined,
                voiceId: uipSession.voiceId ?? undefined,
                generationResolution: sanitizeGenerationResolution(uipSession.generationResolution),
                imageModel: uipSession.imageModel ?? undefined,
                // confirm_fast rebuilds SessionState from storage with no
                // event log to fold, so the tier only reaches the visual-script
                // tool if it is threaded explicitly from here.
                modelSelectorTier: parseModelSelectorAnalyticsTier(uipSession.modelSelectorTier),
                orgId: projectOrgId || undefined,
                transitionVideoModel: uipSession.transitionVideoModel ?? undefined,
                // Debug panel model switch persisted at session creation.
                // Threaded to the transition stage so getModelName
                // honors the `video-generate` override in the UIP path, matching
                // the classic create flow. undefined for normal users.
                debugSettings: extractDebugModelSwitch(project.debugSettings),
                admissionTier,
                // Brand metadata for downstream tracking (project.long_take.completed
                // parity with the full confirm path). The fast path never
                // populated these, so brand sessions confirmed via fast lost isBrandVideo.
                // In-session extraction OR a saved brief applied from the
                // brand library (which leaves brand_extraction_input null).
                isBrandVideo:
                  spec.global_constraints.brand_extraction_input != null ||
                  spec.global_constraints.brand_bank_source != null,
                uipUserWebsite:
                  spec.global_constraints.brand_extraction_input?.kind === 'url'
                    ? spec.global_constraints.brand_extraction_input.url
                    : null,
                uipUserBrandDescription:
                  spec.global_constraints.brand_extraction_input?.kind === 'freeform'
                    ? spec.global_constraints.brand_extraction_input.text
                    : null,
                numBrandfilesUploaded:
                  (
                    uipSession.state as null | {
                      brand_telemetry?: { files_uploaded_count?: number }
                    }
                  )?.brand_telemetry?.files_uploaded_count ?? 0,
                customStyle: uipSession.customStyle ?? false,
                userAssetCatalog,
                numAssetMentions,
                enableCaption: project.enableCaption ?? null,
                // Per-project BGM toggle persisted on the Project row
                // at creation. Omitted when null (projects predating
                // the toggle) so old-input replays schedule no BGM commands --
                // the same omit-when-null semantics as the classic route's
                // buildBgmFlagWorkflowArgs.
                ...(project.bgmEnabled == null ? {} : { bgmEnabled: project.bgmEnabled }),
                longVideoAttemptSource,
                uploadedAssets,
              },
            ],
            workflowId: storyModeWorkflowId,
            taskQueue,
          }),
      )
      logger.info(
        `[${projectId}] UIP confirm-fast orchestration started fast workflow workflowId=${storyModeWorkflowId} runId=${handle.firstExecutionRunId} taskQueue=${taskQueue}`,
      )
      // This call performed the real start -- gate the once-only tracking emit on it.
      fastStarted = true
    } catch (err) {
      // The workflow id is deterministic, so a concurrent confirm or a retry
      // after a mid-flight death may have already started it. Anything else is a
      // real pre-start failure -> rethrow to the keep-freeze handler below.
      if (!isWorkflowAlreadyStartedError(err)) {
        logger.error(
          `[${projectId}] UIP confirm-fast orchestration FAILED to start fast workflow workflowId=${storyModeWorkflowId} taskQueue=${taskQueue}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        throw err
      }
      // Already running (a concurrent confirm or an at-least-once retry lost the
      // deterministic-workflowId start race): fall through to commit the lock.
      // `fastStarted` stays false so the caller does NOT re-fire the once-only
      // uipVideoStarted / uipScriptConfirmed emit,
      // but the returned 'started' status still drives the uip-confirm-fast signal,
      // which the prior (dead) attempt may never have sent.
      logger.info(
        `[${projectId}] UIP confirm-fast orchestration found fast workflow already running workflowId=${storyModeWorkflowId}; treating as idempotent success`,
      )
    }
  } catch (err) {
    // Pre-start failure: rethrow so the retried triggerNextActionActivity
    // self-heals on the next attempt.
    logger.error(
      `[${projectId}] UIP confirm-fast orchestration failed before workflow start (will retry): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    throw err
  }

  // Point of no return: the fast workflow is durably running (freshly started
  // above, or already existed on an idempotent retry). Commit the confirm-lock
  // markers now -- NOT before `workflow.start`.
  await commitUipConfirmedLock({
    prisma,
    project,
    projectId,
    script: handoffScript,
    sessionState,
    spec,
    storyModeWorkflowId,
    uipSession,
  })

  return { firstStart: fastStarted, status: 'started' }
}

export function extractLatestScriptFromTimeline(timeline: unknown): string | undefined {
  const events = normalizeTimelineEvents(timeline)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event) || event.type !== 'session_changed') {
      continue
    }
    const script = event.script
    if (!isRecord(script) || typeof script.content !== 'string') {
      continue
    }
    const content = script.content.trim()
    if (content) {
      return content
    }
  }
  return undefined
}

function checkConfirmFastPreflight(
  projectId: string,
  uipSession: ConfirmFastPreflightSession,
): ConfirmFastOrchestrationResult | null {
  if (uipSession.lockedAt) {
    logger.info(`[${projectId}] Session already confirmed, skipping`)
    return { status: 'already_confirmed' }
  }
  // Phase guard: only script_review is allowed for the fast path. The
  // confirm-fast button renders in script_review (before HITL refinement);
  // the fast workflow generates visual_script + anchors itself.
  if (uipSession.phase !== 'script_review') {
    logger.warn(
      `[${projectId}] Refusing confirm-fast: phase=${uipSession.phase} (only script_review may confirm-fast)`,
    )
    throw new BadRequestException(
      `Cannot confirm-fast session in phase ${uipSession.phase}; must be in script_review`,
    )
  }

  const uipSessionState = (uipSession.state ?? {}) as UipSessionState
  if (uipSessionState.script_word_cap_exceeded === true) {
    logger.info(`[${projectId}] Refusing confirm-fast: script word cap exceeded`)
    return { reason: 'word_cap_exceeded', status: 'action_required' }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeTimelineEvents(timeline: unknown): unknown[] {
  if (Array.isArray(timeline)) {
    return timeline
  }
  if (isRecord(timeline) && Array.isArray(timeline.events)) {
    return timeline.events
  }
  return []
}

function resolveConfirmFastScriptHandoff({
  projectId,
  sessionState,
  spec,
  timeline,
}: {
  projectId: string
  sessionState: PersistedSessionState
  spec: Spec
  timeline: unknown
}): { handoffScript: string; script: string } {
  const artifactScript = spec?.visual_script?.shots?.length
    ? extractScriptFromSpec(spec)
    : (sessionState.cached_artifacts?.working_script?.script?.trim() ?? '')
  const latestTimelineScript = extractLatestScriptFromTimeline(timeline)
  const script = latestTimelineScript ?? artifactScript
  if (latestTimelineScript && latestTimelineScript !== artifactScript) {
    logger.info(
      `[${projectId}] Using latest timeline script for confirm-fast handoff artifactChars=${artifactScript.length} timelineChars=${latestTimelineScript.length}`,
    )
  }
  return { handoffScript: stripInlineTtsMarkupForDisplay(script) || script, script }
}
