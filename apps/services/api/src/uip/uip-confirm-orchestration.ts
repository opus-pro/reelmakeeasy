import { createSubLogger } from '@reelmakeeasy/common/logger'
import { STORY_MODE_ADMISSION_TIER } from '@reelmakeeasy/common/long-take/queue-admission'
import type {
  LongTakeAnchorIndex,
  LongTakeVisualScriptItem,
} from '@reelmakeeasy/common/long-take/types'
import { runWithContext } from '@reelmakeeasy/common/utils/req-ctx'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import {
  type AnchorAssetPlanArtifact,
  brandStagedAssetsToUploads,
  classifyGenre,
  dedupeUploadedAssets,
  type PersistedSessionState,
  type PromptRouteArtifact,
  resolveEffectivePromptRoute,
  type Spec,
  UIP_PROMPT_ROUTES,
} from '@reelmakeeasy/uip-planner-runtime'
import { Client } from '@reelmakeeasy/workflow-engine/client'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { VoiceOverService } from '../voice-over/voice-over.service'

import { storeFinalSessionAnchorsToBrandLibrary } from './uip-brand-anchor-library.util'
import {
  buildAssetManifestEntry,
  buildUserAssetCatalogForTracking,
  buildUserUploadAnchorEntries,
  countAssetMentionsAcrossUserMessages,
  countGeneratedAnchorsByCategoryForTracking,
} from './uip-confirm-anchor-tracking'
import { UipEmptyPlanConfirmError } from './uip-confirm-errors'
import {
  buildLongTakeGlobalConstraintsJson,
  buildScopedStyleSourceJson,
  buildStyleSourceJson,
  isStylizableStyleRef,
} from './uip-confirm-handoff.util'
import { commitUipConfirmedLock, isWorkflowAlreadyStartedError } from './uip-confirm-lock'
import { getProjectKeyframeImageModel } from './uip-debug-settings'
import { resolveUipLongVideoAttemptSource } from './uip-long-video-attribution'
import { getPinnedUserInputFromTimeline } from './uip-original-user-input'
import {
  convertUipAnchorsToStoryModeIndex,
  convertUipSpecToStoryModeVisualScript,
  extractScriptFromSpec,
  stripInlineTtsMarkupForDisplay,
} from './uip-planner-utils'
import {
  resolveOrGeneratePreviewVoiceoverHandoff,
  resolvePreviewHandoffScript,
} from './uip-preview-voiceover-handoff'
import {
  extractPromptPronunciationDict,
  pronunciationDictOption,
} from './uip-pronunciation-instructions'
import { buildUipToStoryModeWorkflowArgs } from './uip-story-mode-workflow-args'
import type { UipSessionState } from './uip-timeline-types'

export {
  resolveOrGeneratePreviewVoiceoverHandoff,
  resolvePreviewVoiceoverHandoff,
} from './uip-preview-voiceover-handoff'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'
import { storeUri } from '@reelmakeeasy/common/storage/stored-files'
// Re-exported from their own module (kept here so existing importers -- the fast
// orchestration and the field-mapping regression test -- resolve unchanged).
export { buildLongTakeGlobalConstraintsJson, buildStyleSourceJson, isStylizableStyleRef }
// buildConfirmedProjectStyleUpdate moved to ./uip-confirm-lock (shared
// commit helper); re-exported so uip-style-fallback.util and tests resolve unchanged.
export { buildConfirmedProjectStyleUpdate } from './uip-confirm-lock'

const logger = createSubLogger('uip-service')

const UIP_TO_STORY_MODE_WORKFLOW_TYPE = 'UipToStoryModeWorkflow'
const UIP_TO_STORY_MODE_V3_WORKFLOW_TYPE = 'UipToStoryModeV3Workflow'
const STORY_MODE_BASE_TASK_QUEUE = 'ao-story-mode'

type ConfirmPreflightSession = {
  lockedAt?: Date | null
  phase?: null | string
}

export async function executeConfirmOrchestration(params: {
  getWorkflowClient: () => Promise<Client>
  prisma: PrismaService
  projectId: string
  voiceOverService?: VoiceOverService
}): Promise<boolean> {
  const { getWorkflowClient, prisma, projectId, voiceOverService } = params

  const uipSession = await prisma.uipSession.findUnique({ where: { projectId } })
  if (!uipSession) {
    throw new NotFoundException(`UIP session not found: ${projectId}`)
  }
  // Returns false (no real start happened) when the preflight short-circuits --
  // chiefly when `lockedAt` is already set, i.e. this is an at-least-once retry
  // or a duplicate dispatch. Callers key the once-only `uipVideoStarted` emit on
  // the `true` return so only the call that performs the actual start fires it.
  if (!checkConfirmPreflight(projectId, uipSession)) {
    return false
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    throw new NotFoundException(`Project not found: ${projectId}`)
  }
  const store = fileStore
  const uipPrefix = `projects/${projectId}/user-intent-planner`
  const projectPrefix = `projects/${projectId}`

  const [specFile, sessionStateFile] = await Promise.all([
    store.file(`${uipPrefix}/spec/current/spec.json`).read(),
    store.file(`${uipPrefix}/session-state.json`).read(),
  ])
  const spec: Spec = JSON.parse(specFile.toString())
  const sessionState: PersistedSessionState = JSON.parse(sessionStateFile.toString())
  const dbSessionState = (uipSession.state ?? {}) as UipSessionState

  assertBrandExtractionSettled(projectId, spec.global_constraints)

  // One raw read; the manifest handoff and the prune's candidate ids both
  // derive from it (an EMPTY plan matters to the prune -- see loadUipAssetPlan).
  const assetPlan = await loadUipAssetPlan(store, projectId, uipPrefix)
  const assetManifest = uipAssetPlanAsManifest(assetPlan)
  // UIP-produced world bible. Hand off to story-mode at
  // `long_take/experts/world_bible.json` so downstream keyframe / transition
  // LLM stages (and future regenerate-* flows) can read the same world
  // continuity context UIP used when generating anchors and visual script.
  // Best-effort: missing file is tolerated (legacy sessions, no-anchor flows).
  const worldBibleJson = await loadUipWorldBibleJson(store, projectId, uipPrefix)
  // UIP-produced global constraints (video_type / topic / key_entities /
  // tone / etc.). Hand off to story-mode at `long_take/global_constraints.json`
  // so the downstream keyframe prompt builder's
  // `getLongTakeKeyframeGlobalContext` finds the same context the legacy
  // LongTakeWorkflow path would have produced via
  // `generateLongTakeVisualScript`. Without this bridge, UIP sessions get
  // `globalContext = null` -> the default-branch "Avoid incidental text"
  // directive does not fire, and infographic / abstract videos end up with
  // gemini-3-pro-image labelling every object in-frame.
  const globalConstraintsJson = buildLongTakeGlobalConstraintsJson(spec)
  // Hand off style_source.json (which drives keyframe stylization) for
  // every style except presets, so presets keep their legacy look.
  const styleSourceJson = buildScopedStyleSourceJson(uipSession.selectedStyleRef, spec)
  // Non-empty spec guard: an empty visual_script.shots means the planner
  // has not actually built a plan yet. Confirming this would start
  // story-mode with zero shots and waste compute.
  const shotCount = spec.visual_script?.shots?.length ?? 0
  if (shotCount === 0) {
    logger.warn(`[${projectId}] Refusing confirm: spec has 0 shots`)
    throw new UipEmptyPlanConfirmError()
  }
  const script = extractScriptFromSpec(spec)
  const displayScript = stripInlineTtsMarkupForDisplay(script)
  const previewHandoffScript = resolvePreviewHandoffScript({
    confirmedScript: uipSession.confirmedScript,
    fallbackScript: script,
    sessionState,
  })

  // Guard: the session must have continued ("Create video"). If not, it reached
  // confirm without committing the draft (should not happen -- continueUipDraft
  // and the auto-continue deadline path both mark it). Throw rather than start.
  if (uipSession.continuedAt == null) {
    throw new BadRequestException(
      `[${projectId}] Cannot confirm: the session never continued (continuedAt is null)`,
    )
  }
  const projectUserId = project.owner ?? project.userId ?? ''
  const projectOrgId = project.orgId ?? ''
  const keyframeImageModel = getProjectKeyframeImageModel(project.debugSettings)
  logger.info(`[${projectId}] Session continued, proceeding with orchestration`)

  const storyModeWorkflowId = getWorkflowId(projectId, 'story-mode', 'uip-pipeline')
  // `true` only when THIS call performed the real workflow start -- drives the
  // once-only `uipVideoStarted` emit. An idempotent retry that finds
  // the workflow already running leaves it `false`.
  let confirmedLockStarted = false

  // The confirm-lock markers (lockedAt / stage / status) are committed only AFTER
  // the story-mode workflow is durably running -- writing them before
  // `workflowClient.workflow.start` let a mid-flight interruption (a pod SIGKILL during
  // a rollout) strand the session as permanently "confirmed" (checkConfirmPreflight
  // short-circuits every retry) with no workflow ever created. A pre-start failure
  // is rethrown (see the catch below), so the retried triggerNextActionActivity
  // self-heals.
  try {
    const storyModeVisualScript = convertUipSpecToStoryModeVisualScript(
      spec,
    ) satisfies LongTakeVisualScriptItem[]
    const visualScriptStorePath = 'long_take/visual_script.json'
    const anchorsSummary = sessionState.anchor_assets_summary
    // Build anchor index from UIP anchor assets (character/prop images processed
    // through the anchor pipeline). Each entry's asset_id matches anchor_id
    // (e.g. "char_user_elf") and is keyed in story-mode's anchor lookup.
    const anchorIndexAssets = convertUipAnchorsToStoryModeIndex(anchorsSummary, (relativePath) =>
      storeUri(`${uipPrefix}/${relativePath}`),
    )

    // Inject raw user-upload assets that are directly assigned to shots via
    // pre_selected_assets with source="user_upload". These are NOT in the
    // anchor pipeline, so they're absent from the anchor index above -- which
    // means buildLongTakeAnchorContents silently skips them and keyframe
    // generation runs without the user's reference image.
    // Solution: add them to the index here using the store path from the
    // uploaded_assets catalog stored in session-state.json.
    //
    // brand_bank.staged_assets entries don't live in cached_artifacts.uploaded_assets;
    // synthesize them on-the-fly so script-writer-injected brand_<bucket>_<hash>
    // pre_selected_assets IDs (the force-bind) resolve here instead of
    // being silently dropped. The synthesized UploadedAsset's file_path is a
    // full `store://...` URI (matching StagedAssetRef.staging_uri), which the
    // entry-builder below detects and passes through verbatim.
    const brandBankUploads = brandStagedAssetsToUploads(spec.global_constraints.brand_bank ?? null)
    const mergedUploadedAssets = [
      ...(sessionState.uploaded_assets ?? []),
      ...(sessionState.cached_artifacts?.uploaded_assets ?? []),
      ...brandBankUploads,
    ]
    // Dedup so an image present as both a real upload and its brand-staged
    // synthetic (different asset_ids, same bytes) is not double-counted in the
    // tracking catalog.
    const allUploadedAssets = dedupeUploadedAssets(mergedUploadedAssets)
    // Resolve pre_selected_assets ids against the PRE-dedup pool: the script
    // writer force-binds brand_<bucket>_<hash> ids whose bytes can also exist
    // as a real upload, and dedup strips exactly those synthetic ids -- the
    // lookup would miss and every such shot binding would be silently dropped.
    buildUserUploadAnchorEntries(spec, mergedUploadedAssets, uipPrefix, projectId).forEach(
      (entry) => anchorIndexAssets.push(entry),
    )

    const anchorIndex = { assets: anchorIndexAssets } satisfies LongTakeAnchorIndex
    const anchorIndexJson = JSON.stringify(anchorIndex, null, 2)

    // Inputs for `project.long_take.completed` tracking. Computed
    // in api layer because UIP skips classic's video-consistency stage and
    // the source data (uploaded_assets, anchor index, timeline) lives here.
    const userAssetCatalog = buildUserAssetCatalogForTracking(allUploadedAssets)
    const generatedAnchorCounts = countGeneratedAnchorsByCategoryForTracking(
      anchorIndexAssets,
      userAssetCatalog,
    )
    // Classic counts `@img[...]` in single `userPrompt`; UIP has multi-turn
    // chat so we sum across every user_message timeline event.
    const numAssetMentions = countAssetMentionsAcrossUserMessages(uipSession.timeline)
    const originalUserInput = getPinnedUserInputFromTimeline(uipSession.timeline)
    const promptPronunciationDict = extractPromptPronunciationDict(originalUserInput)
    const promptRouteArtifact = resolvePromptRouteArtifactForHandoff(sessionState)
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

    // Sentinel marking the anchor indices as UIP-produced. Read by
    // `generateLongTakeAnchorAssets` to short-circuit raw/styled
    // regeneration on workflow re-runs. Path mirrors
    // `LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH` in story-mode-runtime; we
    // duplicate the literal here to keep the api layer free of
    // story-mode-runtime imports.
    const anchorUipSentinelPath = 'long_take/anchors/.uip_pre_generated.json'
    const anchorUipSentinelJson = JSON.stringify(
      { projectId, generatedAt: new Date().toISOString(), anchorCount: anchorIndexAssets.length },
      null,
      2,
    )

    // When the project's style is a saved CUSTOM style, persist its full
    // V6 analysis to long_take/custom_style_analysis.json (inspection / future
    // structured consumers; generation reads only style_text today).
    const customStyleAnalysisJson = await buildCustomStyleAnalysisJson(
      prisma,
      uipSession.selectedStyleRef,
    )

    await Promise.all([
      store
        .file(`${projectPrefix}/${visualScriptStorePath}`)
        .write(JSON.stringify(storyModeVisualScript, null, 2), { contentType: 'application/json' }),
      store
        .file(`${projectPrefix}/long_take/anchors/styled/index.json`)
        .write(anchorIndexJson, { contentType: 'application/json' }),
      store
        .file(`${projectPrefix}/long_take/anchors/raw/index.json`)
        .write(anchorIndexJson, { contentType: 'application/json' }),
      store
        .file(`${projectPrefix}/${anchorUipSentinelPath}`)
        .write(anchorUipSentinelJson, { contentType: 'application/json' }),
      ...buildOptionalHandoffSaves(store, projectPrefix, {
        assetManifest,
        customStyleAnalysisJson,
        globalConstraintsJson,
        promptRouteArtifactJson,
        promptRouteJson,
        styleSourceJson,
        worldBibleJson,
      }),
    ])

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
      script: displayScript || script,
      sessionState,
      styleText: reusableStylePrompt || spec.global_constraints.style.style_text || undefined,
      uipPrefix,
    })

    try {
      // Wrap the workflow.start in runWithContext so the ReqCtxClientInterceptor
      // can inject org_id / user_id into the workflow's x-reelmakeeasy-req-ctx header.
      // Without this, auto-confirm sessions (triggered via the internal
      // /deadline-expired callback) start the workflow with an empty ReqContext.
      const requestedDurationSeconds = spec.meta?.mode_state?.duration_seconds
      const longVideoAttemptSource = resolveUipLongVideoAttemptSource({
        audioDurationSeconds: preVoiceover?.audioDurationSeconds,
        requestedDurationSeconds,
        script: displayScript || script,
        timeline: uipSession.timeline,
      })
      // Story Mode 3.0 routing. Read from the SAME pinned snapshot the
      // UIP prompt side reads, never from a live gate here: a session that authored a
      // V3 visual script must not be rendered by the V2 topology, and vice versa.
      const storyModeWorkflowType =
        spec.meta?.story_mode_v3_enabled === true
          ? UIP_TO_STORY_MODE_V3_WORKFLOW_TYPE
          : UIP_TO_STORY_MODE_WORKFLOW_TYPE
      const handle = await runWithContext(
        { org_id: projectOrgId, user_id: projectUserId, login_id: projectUserId },
        () =>
          workflowClient.workflow.start(storyModeWorkflowType, {
            args: [
              buildUipToStoryModeWorkflowArgs({
                admissionTier,
                displayScript,
                effectivePromptRoute,
                generatedAnchorCounts,
                keyframeImageModel,
                longVideoAttemptSource,
                nstInputs,
                numAssetMentions,
                originalUserInput,
                preVoiceover,
                previewVoiceover,
                project,
                projectId,
                projectOrgId,
                promptRouteArtifact,
                requestedDurationSeconds,
                reusableStylePrompt,
                script,
                shotCount,
                spec,
                styleAnalysis,
                uipSession,
                userAssetCatalog,
                visualScriptStorePath,
              }),
            ],
            workflowId: storyModeWorkflowId,
            taskQueue,
          }),
      )
      logger.info(
        `[${projectId}] UIP confirm orchestration started story-mode workflow workflowId=${storyModeWorkflowId} runId=${handle.firstExecutionRunId} taskQueue=${taskQueue} shots=${shotCount}`,
      )
      // This call performed the real start. Signal exactly-once to the caller so
      // it emits `uipVideoStarted` here and nowhere else.
      confirmedLockStarted = true
    } catch (err) {
      // The workflow id is deterministic, so a concurrent confirm or a retry
      // after a mid-flight death may have already started it. Anything else is a
      // real pre-start failure -> rethrow to the keep-freeze handler below.
      if (!isWorkflowAlreadyStartedError(err)) {
        logger.error(
          `[${projectId}] UIP confirm orchestration FAILED to start story-mode workflow workflowId=${storyModeWorkflowId} taskQueue=${taskQueue} shots=${shotCount}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        throw err
      }
      // Already running: the workflow is durably started, so fall through to
      // commit the lock. `confirmedLockStarted` stays false so the once-only
      // uipVideoStarted emit does not re-fire.
      logger.info(
        `[${projectId}] UIP confirm orchestration found story-mode workflow already running workflowId=${storyModeWorkflowId}; treating as idempotent success`,
      )
    }
  } catch (err) {
    // Pre-start failure. Do NOT clear the continued marker here: this runs inside
    // the retried triggerNextActionActivity (maximumAttempts=10), so clearing it
    // would make every retry throw the continued guard. Leaving it intact lets a
    // transient failure (LLM / storage blip) self-heal on the next retry.
    logger.error(
      `[${projectId}] UIP confirm orchestration failed before workflow start (will retry): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    throw err
  }

  // Point of no return: the story-mode workflow is durably running (freshly
  // started above, or already existed on an idempotent retry). Commit the
  // confirm-lock markers now -- NOT before `workflow.start`.
  await commitUipConfirmedLock({
    prisma,
    project,
    projectId,
    script: displayScript || script,
    sessionState,
    spec,
    storyModeWorkflowId,
    uipSession,
  })

  // Freeze the session's FINAL anchor set into the durable brand
  // library, so a later video for the same (brand, style) reuses what the user
  // actually approved -- including every post-generation ANCHOR_IDS edit the
  // old planner-side FULL-scope store never saw. After the lock commit and
  // never-throwing by contract: a library write (for a FUTURE video) must not
  // fail this confirm nor eat the once-only uipVideoStarted emit. The plan's
  // candidate ids arm the session-final prune, so this session's own earlier
  // entries the user removed before confirming drop out of the manifest.
  await storeFinalSessionAnchorsToBrandLibrary({
    plannedAnchorIds: uipAssetPlanCandidateIds(assetPlan),
    projectId,
    projectOrgId,
    projectStyleName: project.styleName,
    sessionState,
    spec,
  })

  return confirmedLockStarted
}

function checkConfirmPreflight(projectId: string, uipSession: ConfirmPreflightSession): boolean {
  if (uipSession.lockedAt) {
    logger.info(`[${projectId}] Session already confirmed, skipping`)
    return false
  }
  // Phase guard: only refinement should be confirmable. The "Generate now"
  // button only renders in refinement and the workflow's auto-lock only fires in
  // refinement; if /confirm is somehow called from script_review or earlier
  // we'd ship an under-built spec into story-mode. Refuse loudly.
  if (uipSession.phase !== 'refinement') {
    logger.warn(
      `[${projectId}] Refusing confirm: phase=${uipSession.phase} (only refinement may confirm)`,
    )
    throw new BadRequestException(
      'Cannot confirm: the session is not ready to confirm right now. Finish refining, then try again.',
    )
  }
  return true
}

/**
 * Refuse confirm while a brand (re-)extraction is still in flight. A pending
 * extraction means brand_bank may be null or stale; handing off now ships a
 * session whose visual script invents a brand logo from the brand name with no
 * real asset to bind (observed: a user confirmed brand_review
 * mid-reextraction, brand_bank stayed null, and a logo was hallucinated).
 * Brand sessions reach confirm at status 'locked' / 'completed'; non-brand
 * sessions are null and pass through untouched.
 */
export function assertBrandExtractionSettled(
  projectId: string,
  gc: Spec['global_constraints'],
): void {
  if (gc.brand_extraction_status === 'pending' || gc.brand_reextraction_pending === true) {
    logger.warn(
      `[${projectId}] Refusing confirm: brand extraction in flight (status=${
        gc.brand_extraction_status ?? 'null'
      }, reextraction_pending=${gc.brand_reextraction_pending === true})`,
    )
    throw new BadRequestException(
      'Cannot confirm: brand extraction is still in progress. Wait for the brand profile to finish, then try again.',
    )
  }
}

/**
 * Best-effort lookup of the pre-voiceover child workflow's result. Returns
 * undefined when the result is unavailable (workflow not started, still
 * running past confirm, or failed) -- caller treats this as "no audio
 * handoff" and the downstream story-mode workflow falls back to TTS.
 */
// Exported solely for the regression test in `uip-confirm-orchestration.test.ts`
// that pins the audioDurationSeconds passthrough contract.
export async function fetchPreVoiceoverHandoff(
  workflowClient: Client,
  projectId: string,
): Promise<
  | undefined
  | {
      audioDurationSeconds?: number
      scriptText: string
      source: 'user_audio'
      transcriptPath: string
      voiceOverPath: string
    }
> {
  try {
    const handle = workflowClient.workflow.getHandle(`ao:${projectId}:pre-voiceover`)
    // Pre-voiceover child returns `audioDurationSeconds` measured by
    // ffprobe on the uploaded mp3 (full file length, including any
    // trailing silence). The downstream story-mode `buildTransitionPlan`
    // uses this value to extend the last transition past the ASR last-
    // word timestamp so the rendered video covers the entire audio
    // track. Without this field, `buildTransitionPlan`'s
    // `Math.max(maxShotEnd, totalDurationSeconds ?? 0)` collapses to
    // just `maxShotEnd` (= ASR last-word end) and the final mp4 gets
    // clipped at the last spoken word, dropping trailing silence.
    const raw = (await handle.result()) as {
      audioDurationSeconds?: number
      scriptText?: string
      source?: 'user_audio'
      transcriptPath?: string
      voiceOverPath?: string
    }
    if (raw?.scriptText && raw?.voiceOverPath && raw?.transcriptPath) {
      return {
        audioDurationSeconds: raw.audioDurationSeconds,
        scriptText: raw.scriptText,
        source: 'user_audio',
        transcriptPath: raw.transcriptPath,
        voiceOverPath: raw.voiceOverPath,
      }
    }
    return undefined
  } catch (err) {
    logger.warn(
      `[${projectId}] pre-voiceover child result unavailable at confirm: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return undefined
  }
}

/**
 * Read UIP's `anchor_assets/asset_plan.json` and return it serialized in
 * story-mode's `asset_manifest.json` shape. Returns null when no plan
 * exists (legacy / no-anchor sessions); caller should skip writing in
 * that case.
 *
 * Story-mode's keyframe stage reads the manifest via
 * `readLongTakeAssetManifestOutput()` to populate anchor reference labels
 * (e.g. `[Reference image -- character "Seal Pup": ...]`). Without this
 * file the lookup falls back to using `asset_id` as the keyword, which
 * produces ugly slugs like `char_seal_pup` in the model prompt and weakens
 * the reference signal. See `anchor-meta.ts:104-127` for the fallback.
 */
export type LongTakeAssetManifest = {
  asset_manifest: Array<ReturnType<typeof buildAssetManifestEntry>>
}

export interface NstWorkflowInputs {
  genreAnalysis:
    | undefined
    | {
        primaryGenre: string
        scriptwriterGuidance: string
        secondaryGenre: string
        styleApplication: string
      }
  intentAnalysis: string | undefined
  styleReferenceImageUrls: string[] | undefined
}

/**
 * Resolve the NST-related workflow inputs derived at confirm time:
 * gate read, genre classification (when gate on), intent analysis, and
 * single-element style reference URL array. Extracted so the main
 * orchestration body keeps a flat shape and stays under the sonarjs
 * cognitive-complexity threshold.
 */
export async function resolveNstWorkflowInputs(params: {
  originalUserInput?: string
  ownerEmail?: null | string
  projectId: string
  projectOrgId: string
  projectUserId: string
  script: string
  sessionState: {
    bootstrap?: {
      seed_style_instruction?: null | {
        style_image_uri?: string
      }
    }
    spec?: { global_constraints?: { directives?: string[] } }
  }
  styleText?: string
  uipPrefix: string
}): Promise<NstWorkflowInputs> {
  // The brief's positive directives stand in for the old user_directives
  // raw_summary as the NST `intentAnalysis` signal -- a plain newline-joined
  // string of what the user wants the video to do.
  const intentAnalysis =
    params.sessionState.spec?.global_constraints?.directives?.join('\n').trim() || undefined

  // classify_genre needs the user's script + intent + style to produce a
  // project-specific classification -- the NST prompt is a static
  // instruction template that relies on the caller injecting context
  // (NST does this via `formatPipelineContext()` inside
  // `runLongTakeCompletionWithRecord`; UIP doesn't have that layer).
  const genreClassification = await classifyGenre({
    intentAnalysis,
    originalUserInput: params.originalUserInput,
    projectId: params.projectId,
    script: params.script,
    styleText: params.styleText,
  })
  const genreAnalysis = genreClassification
    ? {
        primaryGenre: genreClassification.primary_genre,
        scriptwriterGuidance: JSON.stringify(genreClassification.scriptwriter_guidance),
        secondaryGenre: genreClassification.secondary_genre,
        styleApplication: JSON.stringify(genreClassification.style_application),
      }
    : undefined

  const styleImageStorePath =
    params.sessionState.bootstrap?.seed_style_instruction?.style_image_uri?.trim()
  const styleReferenceImageUrls = styleImageStorePath
    ? [storeUri(`${params.uipPrefix}/${styleImageStorePath}`)]
    : undefined

  return { genreAnalysis, intentAnalysis, styleReferenceImageUrls }
}

/**
 * Reshape the NST-derived style fields stored on `global_constraints.style`
 * into the `UipStyleAnalysis` shape that `UipToStoryModeWorkflow` consumes
 * (mirrors NST `IdentifyLongTakeStyleActivityResult`). Returns undefined
 * when `analyze_style` did not run (no style reference image, or the LLM
 * call failed) so the workflow short-circuits and falls back to the seed
 * `styleText`.
 */
export function buildStyleAnalysisFromSpec(style: Spec['global_constraints']['style']):
  | undefined
  | {
      colorPalette: Record<string, { hex: string; percentage: string }>
      keyStyleTags: string[]
      reproductionGuidance: null | string
      reusableStylePrompt: string
      styleDescription: string
    } {
  const reusable = style.reusable_prompt?.trim()
  if (!reusable) {
    return undefined
  }
  return {
    colorPalette: style.color_palette ?? {},
    keyStyleTags: style.key_style_tags ?? [],
    reproductionGuidance: style.reproduction_guidance ?? null,
    reusableStylePrompt: reusable,
    styleDescription: style.style_description ?? '',
  }
}

/**
 * Build the list of optional storage save promises for confirm-time handoff
 * artifacts. Extracted from the main orchestration body so the call site
 * stays flat (Promise.all of a fixed array) and the cognitive complexity
 * of `executeConfirmOrchestration` doesn't grow with each new optional
 * artifact added.
 */
/**
 * When a project's style is a saved CUSTOM style (selectedStyleRef.kind
 * === 'custom'), serialize that style's full V6 analysis (the styleMetadata
 * structured summary/analysis/palette/face logic + the composed
 * generationStyleText) so it can be handed off to the project at
 * long_take/custom_style_analysis.json. Inspection / future structured
 * consumers -- generation reads only style_text today. Best-effort: returns null
 * for non-custom styles or on any failure so confirm never blocks.
 */
export async function buildCustomStyleAnalysisJson(
  prisma: PrismaService,
  selectedStyleRef: unknown,
): Promise<null | string> {
  const ref = selectedStyleRef as null | { kind?: string; userSavedStyleId?: string }
  if (ref?.kind !== 'custom' || !ref.userSavedStyleId) {
    return null
  }
  try {
    const savedStyle = await prisma.userSavedStyle.findUnique({
      where: { id: ref.userSavedStyleId },
    })
    if (!savedStyle) {
      return null
    }
    const styleMeta =
      savedStyle.styleMetadata &&
      typeof savedStyle.styleMetadata === 'object' &&
      !Array.isArray(savedStyle.styleMetadata)
        ? (savedStyle.styleMetadata as Record<string, unknown>)
        : {}
    return JSON.stringify(
      {
        ...styleMeta,
        generationStyleText: savedStyle.generationStyleText ?? null,
        reusableStylePrompt: savedStyle.styleText,
        styleName: savedStyle.name,
      },
      null,
      2,
    )
  } catch (error) {
    logger.warn(`[uip-confirm] custom style analysis load failed: ${String(error)}`)
    return null
  }
}

export function buildOptionalHandoffSaves(
  store: typeof fileStore,
  projectPrefix: string,
  artifacts: {
    assetManifest: LongTakeAssetManifest | null
    customStyleAnalysisJson: null | string
    globalConstraintsJson: null | string
    promptRouteArtifactJson: null | string
    promptRouteJson: null | string
    styleSourceJson: null | string
    worldBibleJson: null | string
  },
): Array<Promise<unknown>> {
  const saves: Array<Promise<unknown>> = []
  if (artifacts.assetManifest) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/experts/asset_manifest.json`)
        .write(JSON.stringify(artifacts.assetManifest, null, 2), {
          contentType: 'application/json',
        }),
    )
  }
  if (artifacts.customStyleAnalysisJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/custom_style_analysis.json`)
        .write(artifacts.customStyleAnalysisJson, { contentType: 'application/json' }),
    )
  }
  if (artifacts.globalConstraintsJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/global_constraints.json`)
        .write(artifacts.globalConstraintsJson, { contentType: 'application/json' }),
    )
  }
  // Original full style description for the keyframe-prompt stylization filter.
  // Kept in its own file because the story-mode rewrite of
  // global_constraints.json (visual-script.ts) drops style, and the workflow's
  // resolvedStyleText is the re-derived/compressed restylizer output, not this.
  if (artifacts.styleSourceJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/style_source.json`)
        .write(artifacts.styleSourceJson, { contentType: 'application/json' }),
    )
  }
  if (artifacts.worldBibleJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/experts/world_bible.json`)
        .write(artifacts.worldBibleJson, { contentType: 'application/json' }),
    )
  }
  if (artifacts.promptRouteJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/prompt_route.json`)
        .write(artifacts.promptRouteJson, { contentType: 'application/json' }),
    )
  }
  if (artifacts.promptRouteArtifactJson) {
    saves.push(
      store
        .file(`${projectPrefix}/long_take/prompt_route_artifact.json`)
        .write(artifacts.promptRouteArtifactJson, { contentType: 'application/json' }),
    )
  }
  return saves
}

export function resolveEffectivePromptRouteForHandoff(
  artifact: null | PromptRouteArtifact,
): PromptRouteArtifact['prompt_route'] | undefined {
  if (!artifact) {
    return undefined
  }
  return resolveEffectivePromptRoute(artifact)
}

export function resolvePromptRouteArtifactForHandoff(sessionState: {
  cached_artifacts?: { prompt_route?: null | PromptRouteArtifact }
  prompt_route?: null | PromptRouteArtifact
}): null | PromptRouteArtifact {
  const artifact = sessionState.cached_artifacts?.prompt_route ?? sessionState.prompt_route ?? null
  if (!artifact) {
    return null
  }
  if (!UIP_PROMPT_ROUTES.includes(artifact.prompt_route)) {
    return null
  }
  return artifact
}

// Extract the brand input URL hostname for telemetry. Returns null on freeform
// input or unparsable URLs; eTLD+1 normalization is deferred to telemetry-side.
export function extractBrandDomain(
  input: Spec['global_constraints']['brand_extraction_input'],
): null | string {
  if (!input || input.kind !== 'url') {
    return null
  }
  try {
    return new URL(input.url).hostname || null
  } catch {
    return null
  }
}

/**
 * Read UIP's `internal_files/world_bible.json` if present and return the
 * raw JSON string for verbatim handoff to story-mode at
 * `long_take/experts/world_bible.json`. UIP writes this file as part of
 * `ensureWorldBible` inside `generate_anchor_assets` /
 * `generate_explainer_visual_script`. Missing file is tolerated (legacy
 * sessions, sessions that never reached the visual phase) -- caller skips
 * the handoff write in that case.
 */
/**
 * Read UIP's raw `anchor_assets/asset_plan.json`, or null when it is missing /
 * unreadable. Distinct from the manifest conversion below because an EMPTY plan
 * is meaningful on its own: a user who removed every anchor
 * before confirming leaves a present plan with zero candidates -- explicit
 * intent the session-final prune must see -- whereas a missing plan proves
 * nothing and must never arm a prune.
 */
export async function loadUipAssetPlan(
  store: typeof fileStore,
  projectId: string,
  uipPrefix: string,
): Promise<AnchorAssetPlanArtifact | null> {
  try {
    const planFile = await store.file(`${uipPrefix}/anchor_assets/asset_plan.json`).read()
    return JSON.parse(planFile.toString()) as AnchorAssetPlanArtifact
  } catch (err) {
    logger.info(
      `[${projectId}] No UIP asset_plan.json found, skipping asset_manifest handoff: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}

/**
 * The plan's candidate anchor_ids as the session-final prune consumes them:
 * a Set (possibly empty -- every anchor removed) when a well-formed plan
 * exists, undefined when there is no plan to prove user intent. Pure.
 */
export async function loadUipAssetPlanAsManifest(
  store: typeof fileStore,
  projectId: string,
  uipPrefix: string,
): Promise<LongTakeAssetManifest | null> {
  const assetPlan = await loadUipAssetPlan(store, projectId, uipPrefix)
  return uipAssetPlanAsManifest(assetPlan)
}

export function uipAssetPlanCandidateIds(
  assetPlan: AnchorAssetPlanArtifact | null,
): ReadonlySet<string> | undefined {
  if (!Array.isArray(assetPlan?.candidates)) {
    return undefined
  }
  return new Set(assetPlan.candidates.map((candidate) => candidate.anchor_id))
}

/**
 * Convert a loaded asset plan into the story-mode `asset_manifest.json` shape,
 * or null when there is nothing to hand off (no plan, or no candidates). Pure
 * -- split from the loader so the confirm orchestration can read the plan once
 * and derive both this handoff and the prune's candidate ids.
 */
export async function loadUipWorldBibleJson(
  store: typeof fileStore,
  projectId: string,
  uipPrefix: string,
): Promise<null | string> {
  try {
    const file = await store.file(`${uipPrefix}/internal_files/world_bible.json`).read()
    return file.toString()
  } catch (err) {
    logger.info(
      `[${projectId}] No UIP world_bible.json found, skipping world_bible handoff: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}

export function uipAssetPlanAsManifest(
  assetPlan: AnchorAssetPlanArtifact | null,
): LongTakeAssetManifest | null {
  if (!assetPlan?.candidates?.length) {
    return null
  }
  // Field mapping:
  //   anchor_id          -> asset_id          (matches anchor index.json's asset_id)
  //   keyword            -> keyword           (1:1)
  //   proper_name        -> proper_name       (1:1)
  //   type CHARACTER     -> Character         (case fix)
  //   type OBJECT        -> Prop              (rename to story-mode vocab)
  //   visual_reference   -> visual_reference  (1:1)
  //   visual_tag         -> visual_tag        (1:1)
  //   is_multi_angle     -> is_multi_angle    (1:1)
  //   source_asset_id    -> source: 'USER_FILE' if any, else null
  //                      -> source_file_id (the primary id) if any, else null
  // See `LongTakeAssetManifestOutput` in long-take-experts-analysis.ts:131.
  return {
    asset_manifest: assetPlan.candidates.map(buildAssetManifestEntry),
  } satisfies LongTakeAssetManifest
}
