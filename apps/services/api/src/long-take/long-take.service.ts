import { createHash } from 'node:crypto'

import type { InputJsonValue } from '@reelmakeeasy/api-db'
import { readCaptionStyleSettings } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { readInpaintState } from '@reelmakeeasy/common/inpaint/state-store'
import { InpaintHistory } from '@reelmakeeasy/common/inpaint/history'
import { countInFlightGenerations } from '@reelmakeeasy/common/inpaint/selectors'
import type { InpaintGlobalState } from '@reelmakeeasy/common/inpaint/state'
import type { InpaintHistoryData } from '@reelmakeeasy/common/inpaint/types'
import { KvStore } from '@reelmakeeasy/common/kv/store'
import { Logger } from '@reelmakeeasy/common/logger'
import { BEAT_CLIP_SECONDS } from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  resolveBgmVersionHistory,
  resolveBgmVersionId,
  resolveBgmVersionList,
} from '@reelmakeeasy/common/long-take/bgm-versions'
import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import { type CameraStyle, sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import { buildLongTakeEditorRevision } from '@reelmakeeasy/common/long-take/editor-state'
import type { MusicSource } from '@reelmakeeasy/common/long-take/music-craft'
import { regenerateOutputName } from '@reelmakeeasy/common/long-take/regenerate-output'
import type { AssetWorkflowProgress } from '@reelmakeeasy/common/media'
import { ASSET_PROGRESS_QUERY_NAME, getAssetSSEChannelKey } from '@reelmakeeasy/common/media'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import { sanitizeGenerationResolution } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { getStoryModeUserLimits } from '@reelmakeeasy/common/story-mode/user-limits'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { asStoreUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { storedFileUrl, storeKeyOf } from '@reelmakeeasy/common/storage/stored-files'
import { hexToUuidV4 } from '@reelmakeeasy/common/utils/uuid'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import { getWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import { generationNotReadyMessage, generationProviderReady } from '@reelmakeeasy/llm/registry'
import { WorkflowIdConflictPolicy } from '@reelmakeeasy/workflow-engine/client'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type {
  BgmRemuxOutcome,
  LongTakeBgmVersion,
  LongTakeEditorState,
  LongTakeEditorStateResponse,
  LongTakeRenderRequest,
  LongTakeScriptGeneratorPath,
  LongTakeScriptPreviewResponse,
  LongTakeStatus,
  LongTakeTransition,
} from '@shared/types/api/long-take'
import type { MusicTrackArg } from '@shared/types/api/music'
import type { BgmRunState, BgmVersion } from '@shared/types/api/project'
import { DebugSettings } from '@shared/types/project/debug-settings'

import { MediaService } from '../media/media.service'
import { MusicService } from '../music/music.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectService } from '../projects/projects.service'
import { resolveTransitionVideoModel } from '../uip/transition-video-model.util'
import {
  getStoryModeAudioDurationLimitMessage,
  isVideoExtension,
} from '../util/extract-audio-from-video'
import { extractVideoAudioToMp3InStore } from '../util/persist-voiceover-audio'

import { startStandaloneAdmissionWorkflow } from './admission-helpers'
import {
  type BeatLoopClipChanges,
  type BeatLoopLinesCheck,
  BeatLoopService,
  isBeatLoopUseCase,
  type LoopKeyframeSwapPlan,
  type RegenerateLoopClipResult,
  type StartBeatLoopInput,
} from './beat-loop.service'
import { migrateLegacyDraftToInpaintHistory } from './inpaint-draft-migration.util'
import { generateAudioScriptPreview as generateAudioScriptPreviewUtil } from './long-take-audio-script-preview.util'
import {
  parseBgmSettingsBody,
  parseBgmVersionCreateBody,
  resolveBgmRemuxOutcome,
  resolveEffectiveBgm,
} from './long-take-bgm-settings.util'
import { cancelProjectWorkflow } from './long-take-cancel.util'
import { parseCaptionSettingsBody } from './long-take-caption-settings.util'
import { readEditorDraft } from './long-take-editor-draft.util'
import {
  normalizeEditorStateForStorage,
  readCanonicalEditorState,
  withLoopKeyframesInProgress,
} from './long-take-editor-state.util'
import { resolveSuccessfulTransitionFields } from './long-take-generation-record-fields.util'
import { readOptionalJsonFile, readTranscript } from './long-take-helpers.util'
import {
  clipModelLabel,
  clipsOnKeyframe,
  commitKeyframePicture,
  KEYFRAMES_PATH,
  type KeyframeSwapPlan,
  pictureSize,
  type StagedKeyframe,
  stageKeyframePicture,
  storyClipUsd,
} from './long-take-keyframe-swap.util'
import {
  fetchTransitionGenerationRecords,
  hasCanonicalRenderSnapshot,
  regenerateTransition as regenerateTransitionUtil,
  regenerateTransitionKeyframe as regenerateTransitionKeyframeUtil,
} from './long-take-regen.util'
import {
  regenerateLongTakeIntoNewProject,
  resolveLongTakeRetryEligibility,
} from './long-take-regenerate.util'
import { generateLongTakeScriptPreview } from './long-take-script'
import { validateTargetDurationSeconds } from './long-take-script-helpers'
import { handleStoryModeStartWorkflowFailure } from './long-take-start-failure'
import { buildLongTakeStatus, STATUS_CACHE_PREFIX } from './long-take-status.util'
import { resolveLongTakeRequestVoice } from './long-take-voice-guard.util'
import {
  analyzeImages as analyzeImagesUtil,
  buildLongTakeStartWorkflowContext,
  buildLongTakeUserAssetCatalog,
  buildLongTakeWorkflowArgs,
  buildQueuedAdmissionMeta,
  editRenderSettings,
  normalizeRatio,
  normalizeRenderUri,
  persistDebugOverrides,
  renderRequestSettings,
  resolveLongTakeProjectId as resolveLongTakeProjectIdUtil,
  resolveProjectWorkflowFlags,
  resolveStoryModeStartAudioPath,
  resolveStoryModeTaskQueue,
  saveLongTakeRequestMetadata,
  updateLongTakeProjectMetadataIfNeeded,
} from './long-take-workflow.util'
import { prepareMcpVoiceover as prepareMcpVoiceoverUtil } from './voiceover-audio-script.util'

/** A story video's clip redo would break a loop short's 1-2-3-4 beat. */
const LOOP_CLIP_REDO =
  'This video is a loop short: redo its clips from the chat, which keeps the beat.'

// A generated name is ~2-4 words; this bounds a hand-typed one without ever
// cutting a real title. Enforced server-side only -- the rename field scrolls.
const BGM_TRACK_NAME_MAX_LENGTH = 100

// Terminal (closed, non-recoverable) workflow statuses. Deliberately an allowlist:
// anything not listed here (RUNNING, PAUSED, UNSPECIFIED, UNKNOWN) is treated as
// still-live and must NOT be surfaced as a failure.
const TERMINAL_WORKFLOW_STATUSES = new Set([
  'CANCELLED',
  'CONTINUED_AS_NEW',
  'FAILED',
  'TERMINATED',
  'TIMED_OUT',
])

@Injectable()
export class LongTakeService {
  private readonly logger = new Logger(LongTakeService.name)

  constructor(
    private readonly projectsService: ProjectService,
    private readonly mediaService: MediaService,
    private readonly kv: KvStore,
    private readonly prisma: PrismaService,
    private readonly music: MusicService,
    private readonly beatLoop: BeatLoopService,
  ) {}

  /**
   * Switch the project to one of its existing BGM beds and rebake
   * the delivered video at it. Nothing is generated, only re-muxed.
   *
   * Writes ONLY the current-bed scalars. bgmVersions is deliberately untouched:
   * internalUpdateProject reads that field's presence as a finished
   * regeneration and would fire a "music ready" notification for every arrow
   * click. The history stays append-only and owned by the
   * regenerate path.
   *
   * The re-mux runs with TERMINATE_EXISTING on the shared per-project id, so a
   * user clicking through versions supersedes their own in-flight rebuild
   * instead of queueing one per click -- the same contract as the settings
   * edit, which also means the export guard, the SSE wake-up and the download
   * queue all apply unchanged.
   */
  async applyBgmVersion(
    projectId: string,
    versionId: string,
    user: UserInfo,
  ): Promise<{
    remux: 'skipped_muted' | 'skipped_not_delivered' | 'skipped_unchanged' | 'started'
    workflowId?: string
  }> {
    await this.assertProjectAccess(projectId)

    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }
    const history = resolveBgmVersionHistory(project)
    const versionIndex = history.findIndex((entry) => resolveBgmVersionId(entry.uri) === versionId)
    const version = history[versionIndex]
    if (!version) {
      throw new NotFoundException('Music version not found')
    }
    // Idempotent: re-applying the current bed rebuilds nothing. Keeps a
    // double-click, or an arrow bounced back to where it started, from
    // superseding an in-flight rebuild with an identical one.
    if (version.uri === project.bgmBedUri) {
      return { remux: 'skipped_unchanged' }
    }
    // Saved as the address like the bed itself: the served URL is built on read.
    const bedCdnUrl = storeKeyOf(version.uri) ? version.uri : undefined
    if (!bedCdnUrl) {
      throw new BadRequestException('Music version is not playable')
    }

    await this.projectsService.internalUpdateProject(
      projectId,
      {
        bgmBedCdnUrl: bedCdnUrl,
        // A version without its own measured gain (an older version)
        // keeps the incumbent scalar as an approximation rather than nulling
        // it: null drops the live preview to the legacy LINEAR curve, which
        // for a hot bed is 10-20 dB louder than the export mix -- the bed
        // drowns the voiceover (the self-QA finding). Beds for one
        // project cluster within a few dB, so the incumbent parity gain is
        // close; the re-mux then measures this bed exactly and persists the
        // true value back over the approximation.
        bgmBedGainDb: version.bedToVoiceGainDb ?? project.bgmBedGainDb ?? null,
        bgmBedUri: version.uri,
        bgmModel: version.model,
        bgmPrompt: version.prompt,
        // A version from before the library has no source: it was generated.
        bgmSource: version.source ?? 'generated',
        bgmTrackId: version.trackId ?? null,
        bgmTrackName: version.trackName,
      },
      user.userId || 'system',
    )
    await this.dropStatusCache(projectId)

    // The restore itself is done: the project is on the chosen track and the
    // editor plays it. Emitted here rather than after the re-mux branch below,
    // because every skip path is still a restore the user performed -- only the
    // delivered file did or did not need rebuilding. Never reached by the
    // already-current no-op above, which restores nothing.
    const fromIndex = project.bgmBedUri
      ? history.findIndex((entry) => entry.uri === project.bgmBedUri)
      : -1

    if (!project.resultVideo) {
      return { remux: 'skipped_not_delivered' }
    }
    const bgmEnabled = project.bgmEnabled ?? false
    const bgmVolume = project.bgmVolume ?? BGM_DEFAULT_VOLUME
    // Off or muted: the delivered file is already voiceover-only, so a re-mux
    // would rewrite identical bytes. The swapped bed is live in the preview
    // and bakes when music is turned back on.
    if (!bgmEnabled || bgmVolume <= 0) {
      return { remux: 'skipped_muted' }
    }

    const client = await createClient()
    const workflowId = this.buildBgmRemuxWorkflowId(projectId)
    await client.workflow.start('LongTakeBgmRemuxWorkflow', {
      args: [
        {
          bgmBedUri: version.uri,
          bgmEnabled,
          bgmVolume,
          projectId,
          userEmail: user.email,
          userId: user.userId,
        },
      ],
      taskQueue: await resolveStoryModeTaskQueue(),
      workflowExecutionTimeout: '30 minutes',
      workflowId,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.TERMINATE_EXISTING,
    })
    this.logger.log(
      `BGM version apply started ${JSON.stringify({ projectId, versionId, workflowId })}`,
    )
    return { remux: 'started', workflowId }
  }

  /** Refuses (409) while neither fal nor Gemini can make a video, with phase 3's words and the
   *  reason (`generationNotReadyMessage()`). The start calls it first; agent mode calls it
   *  before it creates a project or writes a script. */
  assertCanStart(): void {
    if (!generationProviderReady()) throw new ConflictException(generationNotReadyMessage())
  }

  buildBgmRemuxWorkflowId(projectId: string): string {
    return getWorkflowId(projectId, 'story-mode', 'bgm-remux')
  }

  buildRenderWorkflowId(projectId: string): string {
    return getWorkflowId(projectId, 'story-mode', 'render')
  }

  buildTransitionKeyframeWorkflowId(projectId: string, shotId: string): string {
    return getWorkflowId(projectId, 'story-mode', 'transition-keyframe-regen', shotId)
  }

  buildTransitionWorkflowId(projectId: string, transitionId: string): string {
    return getWorkflowId(projectId, 'story-mode', 'transition-regen', transitionId)
  }

  async cancelWorkflow(projectId: string, workflowId: string): Promise<{ workflowId: string }> {
    return cancelProjectWorkflow(
      { logger: this.logger, projectsService: this.projectsService },
      projectId,
      workflowId,
    )
  }

  /**
   * Says every line of a loop's storyboard in its voice and measures it (`make_beat_loop`,
   * before its card): refused first when nothing can make the video, so no voice is paid for.
   */
  async checkBeatLoopLines(
    input: Parameters<BeatLoopService['checkLines']>[0],
  ): Promise<BeatLoopLinesCheck> {
    this.assertCanStart()
    return this.beatLoop.checkLines(input)
  }

  /** Agent edit mode: the staged picture becomes keyframe `shotId` (after its clips are made). */
  async commitKeyframe(projectId: string, shotId: string, staged: StagedKeyframe): Promise<void> {
    await this.assertProjectAccess(projectId)
    await commitKeyframePicture(await createStorage(projectId), shotId, staged)
  }

  // Completion wake-up stream for the settings re-mux. Access-gated
  // like getBgmSettings (the older render/transition streams predate the
  // guard; new endpoints do not extend that pattern).
  async createBgmRemuxStream(projectId: string) {
    await this.assertProjectAccess(projectId)
    return this.createWorkflowStream(
      this.buildBgmRemuxWorkflowId(projectId),
      'bgm remux',
      () => ({}),
    )
  }

  async createBgmVersion(
    projectId: string,
    body: unknown,
    user: UserInfo,
  ): Promise<{ workflowId: string }> {
    await this.assertProjectAccess(projectId)
    const { note, prompt, track } = parseBgmVersionCreateBody(body)

    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }
    // A loop takes music too (off until the user adds it): its remux and renders mix it under
    // the loop's own sound (beat-loop-finish.ts).
    const durationSec = project.duration ?? 0
    if (durationSec <= 0) {
      throw new BadRequestException('Video is not ready for music generation yet')
    }

    // Version history: the shared resolver folds the current bed in
    // whenever the recorded history does not already carry it -- a first
    // regenerate, or a rerun that persisted a bed without touching the history
    // -- so no generated bed is dropped from the switchable set. The workflow
    // appends the new bed to whatever this returns.
    const priorVersions: BgmVersion[] = resolveBgmVersionHistory(project)
    // A chosen track must exist (404 otherwise) before anything is written.
    const trackArg = track ? await this.music.resolveTrackArg(user.userId, track) : undefined

    // A requested bed is a request to hear it: with music off the regenerate workflow would
    // make and persist the bed but skip the delivery remux (gated on bgmEnabled).
    // A saved 0% would make the new bed silent while the music reads as on: back to default.
    const reviveVolume = project.bgmVolume === 0
    if (project.bgmEnabled !== true || reviveVolume) {
      await this.projectsService.internalUpdateProject(
        projectId,
        { bgmEnabled: true, ...(reviveVolume ? { bgmVolume: BGM_DEFAULT_VOLUME } : {}) },
        user.userId,
        user.orgId,
      )
    }
    // A new wish (a mood or the user's words) replaces the stored one for this and later takes.
    if (note !== undefined) {
      await this.projectsService.internalUpdateProject(
        projectId,
        { bgmNote: note },
        user.userId,
        user.orgId,
      )
    }
    const wish = note === undefined ? project.bgmNote : note
    await this.dropStatusCache(projectId)

    const workflowId = getWorkflowId(projectId, 'story-mode', 'bgm-regen')
    // The card status pill's run record. `generate` when the project
    // has no bed yet (first user-triggered generation), `regenerate` after.
    const bgmRunStartedAt = new Date().toISOString()
    const bgmRunKind: BgmRunState['kind'] = priorVersions.length > 0 ? 'regenerate' : 'generate'
    // Written before the start so it cannot land after the workflow's own
    // terminal patch: a fast finish (or a gate-off skip) settles or clears the
    // record within milliseconds, and a post-start write would resurrect it as
    // `running` and spin the card until the client staleness ceiling.
    await this.patchBgmRun(
      projectId,
      { kind: bgmRunKind, startedAt: bgmRunStartedAt, status: 'running' },
      user,
    )
    try {
      const client = await createClient()
      await client.workflow.start('LongTakeBgmRegenerateWorkflow', {
        args: [
          {
            bgmEnabled: true,
            bgmRunStartedAt,
            bgmVolume: reviveVolume
              ? BGM_DEFAULT_VOLUME
              : (project.bgmVolume ?? BGM_DEFAULT_VOLUME),
            durationSec,
            existingVersions: priorVersions,
            orgId: user.orgId,
            projectId,
            // A track is fitted as it is; otherwise a director take (no prompt) still honours
            // the project's wish.
            ...(trackArg ? { track: trackArg } : { prompt, userRequest: wish ?? undefined }),
            remuxDelivered: Boolean(project.resultVideo),
            userEmail: user.email,
            userId: user.userId,
          },
        ],
        taskQueue: await resolveStoryModeTaskQueue(),
        workflowExecutionTimeout: '30 minutes',
        workflowId,
      })
    } catch (error) {
      if (ensureError(error).name === 'WorkflowExecutionAlreadyStartedError') {
        // A run really is in flight; leave the marker so the card keeps spinning.
        throw new ConflictException('Music generation is already in progress')
      }
      // Nothing started, so nothing will settle the marker: drop it.
      await this.patchBgmRun(projectId, null, user)
      throw error
    }
    this.logger.log(
      `BGM regenerate started ${JSON.stringify({ hasPrompt: Boolean(prompt), projectId, workflowId })}`,
    )
    return { workflowId }
  }

  async createWorkflowStream(
    workflowId: string,
    label: string,
    buildResult: (progress: AssetWorkflowProgress) => unknown,
  ) {
    this.logger.log(`SSE connection request for ${label} workflowId: ${workflowId}`)

    const channelKey = getAssetSSEChannelKey(workflowId)
    const bus = await SSEFactory.getSSEBus(channelKey)
    if (!bus) {
      throw new Error(`Failed to get SSE bus for workflow ${workflowId}`)
    }

    return bus.stream({
      onStart: async () => {
        this.logger.log(`User connected to ${label} events on ${workflowId}`)

        try {
          const workflowProgress = await this.queryTransitionWorkflowProgress(workflowId)
          await bus.push({
            type: 'update',
            data: JSON.stringify({
              status: workflowProgress.status,
              result: buildResult(workflowProgress),
              ...(workflowProgress.errorMessage && {
                error: {
                  code: workflowProgress.errorCategory ?? 'UNKNOWN',
                  message: workflowProgress.errorMessage,
                },
              }),
              updatedAt: Date.now(),
            }),
          })

          if (workflowProgress.status === 'completed' || workflowProgress.status === 'failed') {
            this.logger.log(`Workflow ${workflowId} already finished, ending stream`)
            await bus.end()
          }
        } catch (error) {
          this.logger.warn(
            `Failed to get initial state for ${workflowId}: ${ensureError(error).message}`,
          )
          // The progress query fails when the workflow closed abruptly (terminated /
          // timed out) or was purged past retention -- none of which pushed a terminal
          // SSE event, so a reconnecting client would wait forever. Surface a terminal
          // failure if the execution is closed or gone.
          await this.resolveClosedWorkflowStream(workflowId, bus)
        }
      },
      onCleanup: () => {
        this.logger.log(`User disconnected from ${label} events on ${workflowId}`)
      },
    })
  }

  async generateAudioScriptPreview(params: {
    audioUri: string
    user: UserInfo
  }): Promise<{ script: string }> {
    return generateAudioScriptPreviewUtil(this.logger, params)
  }

  async generateScriptPreview(params: {
    imageUris?: string[]
    prompt: string
    targetDurationSeconds?: number
    user: UserInfo
  }): Promise<LongTakeScriptPreviewResponse> {
    const { prompt, targetDurationSeconds, user } = params
    const normalizedPrompt = prompt?.trim() || ''
    if (!normalizedPrompt) {
      throw new BadRequestException('Prompt is required')
    }

    // Per-user gate: non-gated users see legacy 3-min / 450-word ceilings;
    // gated users get the expanded long-video product. Resolving here
    // before the LLM call lets us reject obviously over-limit picker
    // values up front rather than after several minutes of generation.
    const userLimits = getStoryModeUserLimits()
    const durationError = validateTargetDurationSeconds(
      targetDurationSeconds,
      userLimits.maxNonAudioDurationSeconds,
    )
    if (durationError) {
      throw new BadRequestException(durationError)
    }

    const imageAnalyses = await analyzeImagesUtil(
      this.logger,
      params.imageUris || [],
      user.userId || user.sub || 'unknown',
    )

    return generateLongTakeScriptPreview({
      effectiveMaxScriptWords: userLimits.absoluteMaxScriptWords,
      imageAnalyses: imageAnalyses.length > 0 ? imageAnalyses : undefined,
      rawInput: normalizedPrompt,
      targetDurationSeconds,
      userId: user.userId || user.sub || 'long-take',
    })
  }

  /**
   * Owner-only music panel state. This is deliberately a separate
   * read from the long-take status: the status is readable via share links, so
   * bgmPrompt (free-text LLM prompt, prefills the editable regenerate box) is
   * only surfaced here behind assertProjectAccess.
   */
  async getBgmSettings(projectId: string): Promise<{
    applying: boolean
    bgmEnabled: boolean | null
    bgmPrompt: null | string
    bgmSource: null | string
    bgmTrackId: null | string
    bgmTrackName: null | string
    bgmVolume: null | number
    generating: boolean
    regenOutcome: BgmRemuxOutcome
    regenRunId: null | string
    remuxOutcome: BgmRemuxOutcome
  }> {
    await this.assertProjectAccess(projectId)
    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }
    // In-flight workflows are read from the workflow engine so the panel's pending state
    // and the export guard survive a remount (client capture state dies with
    // the tab). Both legs report their full latest-run outcome: the remux for
    // the download queue, the regen so the client can settle its
    // pending from the terminal state instead of a bed-url diff.
    const [regen, remuxOutcome] = await Promise.all([
      this.getBgmRegenState(projectId),
      this.getBgmRemuxOutcome(projectId),
    ])
    return {
      applying: remuxOutcome === 'running',
      bgmEnabled: project.bgmEnabled ?? null,
      bgmPrompt: project.bgmPrompt ?? null,
      bgmSource: project.bgmSource ?? null,
      bgmTrackId: project.bgmTrackId ?? null,
      bgmTrackName: project.bgmTrackName ?? null,
      bgmVolume: project.bgmVolume ?? null,
      generating: regen.outcome === 'running',
      regenOutcome: regen.outcome,
      regenRunId: regen.runId,
      remuxOutcome,
    }
  }

  /**
   * The beds this project can switch between, oldest first, and
   * which one it is on. Access-gated like getBgmSettings rather than the
   * share-readable status: an entry carries the owner's Lyria prompt.
   *
   * The list is resolved, not read raw -- a project that has never regenerated
   * still reports its one bed, so the client never reimplements the rule.
   */
  async getBgmVersions(projectId: string): Promise<{
    currentVersionId: null | string
    versions: LongTakeBgmVersion[]
  }> {
    await this.assertProjectAccess(projectId)
    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }
    const { currentVersionId, versions } = resolveBgmVersionList(project)
    return {
      currentVersionId,
      // The store:// URI stays server-side: the client previews from the CDN, and
      // the id is what an apply takes. Derived, not stored -- bed objects are
      // immutable, so the URL never goes stale.
      versions: versions.map(({ uri, ...version }) => ({
        ...version,
        cdnUrl: storedFileUrl(uri) ?? null,
      })),
    }
  }

  // Whether a failed/cancelled long-take can be regenerated (its artifacts are
  // reusable) or the caller must remix. Lets the Retry entry route before it
  // starts anything.
  async getLongTakeRetryEligibility(sourceProjectId: string): Promise<{ canRegenerate: boolean }> {
    // A loop short runs again in place from its stored clips (`regenerateLongTake`).
    if (await this.beatLoop.isBeatLoopProject(sourceProjectId)) {
      await this.assertProjectAccess(sourceProjectId)
      return { canRegenerate: await this.beatLoop.canResume(sourceProjectId) }
    }
    return resolveLongTakeRetryEligibility(
      {
        logger: this.logger,
        mediaService: this.mediaService as never,
        prisma: this.prisma as never,
        projectsService: this.projectsService as never,
        kv: this.kv as never,
      },
      sourceProjectId,
    )
  }

  async getStateWithUnrenderedChanges(projectId: string): Promise<LongTakeEditorStateResponse> {
    await this.assertProjectAccess(projectId)
    const storage = await createStorage(projectId)
    const canonical = await readCanonicalEditorState(storage)
    // What the page shows: a loop's keyframes appear as each is made. The checks below read
    // the canonical state.
    const data = await withLoopKeyframesInProgress(storage, canonical)
    // Status-read posture: a corrupt draft/inpaint blob or storage error must
    // never 500 the status endpoint, so any throw is swallowed and logged and
    // both signals fail closed. The inpaint blob is read once and shared: the
    // running count is derived from the same state the diff check walks.
    try {
      const inpaintState = await readInpaintState(projectId)
      return {
        data,
        hasUnrenderedChanges: await this.detectUnrenderedChanges(
          projectId,
          storage,
          canonical,
          inpaintState,
        ),
        runningInpaintGenerationCount: inpaintState ? countInFlightGenerations(inpaintState) : 0,
      }
    } catch (error) {
      this.logger.warn(
        `Failed to derive editor state signals for ${projectId}: ${ensureError(error).message}`,
      )
      return { data, hasUnrenderedChanges: false, runningInpaintGenerationCount: 0 }
    }
  }

  async getStatus(projectId: string): Promise<LongTakeStatus | null> {
    return buildLongTakeStatus(
      {
        logger: this.logger,
        projectsService: this.projectsService as never,
        kv: this.kv as never,
      },
      projectId,
    )
  }

  async getTranscript(projectId: string) {
    await this.assertProjectAccess(projectId)
    return readTranscript(await createStorage(projectId))
  }

  /** Whether the project is a loop short: the agent's clip tools treat it apart. */
  async isBeatLoopProject(projectId: string): Promise<boolean> {
    return this.beatLoop.isBeatLoopProject(projectId)
  }

  /**
   * Agent edit mode: what a new picture as keyframe `shotId` makes again and costs, and the size
   * it is fitted to. A story video's keyframe opens one clip and ends another: those two (one for
   * the first or last keyframe), priced on the project's clip model at its resolution. A loop
   * short's clips are chained: its own service plans them. Nothing is changed. Refused in plain
   * words (400) for an unknown keyframe or one no clip uses, and (409) when nothing can make
   * clips.
   */
  async planKeyframeSwap(projectId: string, shotId: string): Promise<KeyframeSwapPlan> {
    await this.assertProjectAccess(projectId)
    this.assertCanStart()
    const storage = await createStorage(projectId)
    if (await this.beatLoop.isBeatLoopProject(projectId)) {
      const plan = await this.beatLoop.planKeyframeSwap(projectId, shotId)
      const frame = await pictureSize(storage, plan.framePaths[0])
      if (!frame) throw new BadRequestException(`Keyframe ${plan.frameId}'s picture can't be read.`)
      // The clips run from the one landing on the frame to the end of the loop, 4 s each. The
      // opening frame (written over its closing copy too) is left by clip 1 and landed on by
      // the last clip.
      const first = plan.clipCount - plan.clipIds.length + 1
      const opening = plan.framePaths.length > 1
      const last = plan.clipIds.length - 1
      return {
        clipCount: plan.clipCount,
        clips: plan.clipIds.map((id, i) => ({
          endMs: (first + i) * BEAT_CLIP_SECONDS * 1000,
          id,
          lands: opening ? i === last : i === 0,
          number: first + i,
          startMs: (first + i - 1) * BEAT_CLIP_SECONDS * 1000,
          usd: plan.clipUsd,
        })),
        frame,
        loop: true,
        modelLabel: plan.modelLabel,
        shotId: plan.frameId,
        totalUsd: plan.estimatedCostUsd,
      }
    }
    const { keyframes, transitions } = await readKeyframesAndClips(storage)
    const keyframe = keyframes.find((k) => k.shotId === shotId)
    if (!keyframe) {
      throw new BadRequestException(
        `No keyframe ${shotId || '(none)'}. The keyframes are ${keyframes.map((k) => k.shotId).join(', ')}.`,
      )
    }
    const clips = clipsOnKeyframe(transitions, shotId)
    if (!clips.length) {
      throw new BadRequestException(
        `No clip starts or ends on keyframe ${shotId}, so a new picture there wouldn't change the video.`,
      )
    }
    const project = await this.projectsService.getProject(projectId)
    const model = this.transitionModelOf(project)
    const resolution = sanitizeGenerationResolution(project?.generationResolution)?.videoResolution
    const priced = clips.map(({ number, transition }) => ({
      endMs: transition.endMs,
      id: transition.transitionId,
      lands: transition.toShotId === shotId,
      number,
      startMs: transition.startMs,
      usd: storyClipUsd({
        durationSeconds: (transition.endMs - transition.startMs) / 1000,
        model,
        resolution,
      }),
    }))
    // The new picture takes the keyframe's size; a keyframe that can't be read, the clips'.
    const video = clips.find(({ transition }) => transition.videoWidth && transition.videoHeight)
    const frame =
      (await pictureSize(storage, asStoreUri(keyframe.keyframeUrl) ?? keyframe.keyframeUrl)) ??
      (video
        ? {
            height: Number(video.transition.videoHeight),
            width: Number(video.transition.videoWidth),
          }
        : null)
    if (!frame) throw new BadRequestException(`Keyframe ${shotId}'s picture can't be read.`)
    return {
      clipCount: transitions.length,
      clips: priced,
      frame,
      loop: false,
      modelLabel: clipModelLabel(model),
      shotId,
      totalUsd: Math.round(priced.reduce((sum, clip) => sum + clip.usd, 0) * 100) / 100,
    }
  }

  // MCP voiceover ingest: thin delegate to prepareMcpVoiceover (off the oversized
  // service file). See mcp-voiceover.util for the orchestration + rationale.
  async prepareMcpVoiceover(params: {
    audioUri: string
    user: UserInfo
  }): Promise<{ detectedTranscript: string; durationSeconds: null | number }> {
    return prepareMcpVoiceoverUtil(params)
  }

  async queryTransitionWorkflowProgress(workflowId: string): Promise<AssetWorkflowProgress> {
    const client = await createClient()
    const handle = client.workflow.getHandle(workflowId)
    return await handle.query<AssetWorkflowProgress>(ASSET_PROGRESS_QUERY_NAME)
  }

  // Regenerate a finished long-take into a NEW project on a different
  // transition video model, reusing the source artifacts through keyframes.
  // Validation, seeding, and workflow start live in the util.
  async regenerateLongTake(
    sourceProjectId: string,
    body: { transitionVideoModel: string },
    user: UserInfo,
  ): Promise<{ projectId: string; workflowId: string }> {
    // Try again on a loop short: the same project runs again from the first clip it didn't keep.
    if (await this.beatLoop.isBeatLoopProject(sourceProjectId)) {
      return this.beatLoop.resume(sourceProjectId, user)
    }
    return regenerateLongTakeIntoNewProject(
      {
        logger: this.logger,
        mediaService: this.mediaService as never,
        prisma: this.prisma as never,
        projectsService: this.projectsService as never,
        kv: this.kv as never,
      },
      {
        sourceProjectId,
        transitionVideoModel: body.transitionVideoModel,
        user,
      },
    )
  }

  /**
   * Agent edit mode on a loop short: redoes one clip from the real last frame of the clip before
   * it, its template filled from the (optionally rewritten) slots. The clips after it stay, or
   * are made again too with `redoFollowing`. Returns the workflow to wait on and the cost.
   */
  async regenerateLoopClip(
    projectId: string,
    clipId: string,
    opts: { changes?: BeatLoopClipChanges; redoFollowing?: boolean },
    user: UserInfo,
  ): Promise<RegenerateLoopClipResult> {
    this.assertCanStart()
    return this.beatLoop.regenerateClip(projectId, clipId, opts, user)
  }

  async regenerateTransition(
    projectId: string,
    transitionId: string,
    body: {
      keyframeDriven?: boolean
      prompt?: string
      transitionList: Array<{
        firstFrameUrl: string
        lastFrameUrl: string
        transitionId: string
      }>
    },
    user: UserInfo,
  ): Promise<{ workflowId: string }> {
    await this.assertProjectAccess(projectId)
    if (!Array.isArray(body.transitionList) || body.transitionList.length === 0) {
      throw new BadRequestException('transitionList must not be empty')
    }
    const project = await this.projectsService.getProject(projectId)
    if (isBeatLoopUseCase(project)) throw new BadRequestException(LOOP_CLIP_REDO)
    const debugSettings = project?.debugSettings as DebugSettings | null | undefined
    const rawTransitionVideoModel =
      typeof debugSettings?.transitionVideoModel === 'string'
        ? debugSettings.transitionVideoModel
        : undefined
    // Resolve the regen transition model ONCE via the shared no-clobber
    // helper. `?? undefined` normalizes the helper's null for the downstream param.
    const transitionVideoModel = resolveTransitionVideoModel(rawTransitionVideoModel) ?? undefined

    const { workflowId } = await regenerateTransitionUtil(
      {
        buildTransitionKeyframeWorkflowId: (p, s) => this.buildTransitionKeyframeWorkflowId(p, s),
        projectsService: this.projectsService as never,
      },
      projectId,
      transitionId,
      body,
      user,
      transitionVideoModel,
    )
    return { workflowId }
  }

  /** Agent edit mode: redo one clip from the editor state's keyframes with a final prompt. */
  async regenerateTransitionFromState(
    projectId: string,
    transitionId: string,
    prompt: string,
    user: UserInfo,
    opts: { promptIsFinal: boolean },
  ): Promise<{ workflowId: string }> {
    await this.assertProjectAccess(projectId)
    if (await this.beatLoop.isBeatLoopProject(projectId)) {
      throw new BadRequestException(LOOP_CLIP_REDO)
    }
    const storage = await createStorage(projectId)
    const state = await readCanonicalEditorState(storage)
    const transition = state.transitions.find((t) => t.transitionId === transitionId)
    if (!transition) throw new BadRequestException(`Transition ${transitionId} not found`)
    const keyframe = (shotId: string) =>
      state.keyframes.find((k) => k.shotId === shotId)?.keyframeUrl
    const firstFrameUrl = keyframe(transition.fromShotId)
    const lastFrameUrl = keyframe(transition.toShotId)
    if (!firstFrameUrl || !lastFrameUrl)
      throw new BadRequestException(`Keyframes missing for ${transitionId}`)
    const workflowId = this.buildTransitionWorkflowId(projectId, transitionId)
    await this.startAgentClipRun(
      projectId,
      workflowId,
      [
        {
          endMs: transition.endMs,
          firstFrameUri: asStoreUri(firstFrameUrl) ?? firstFrameUrl,
          fromShotId: transition.fromShotId,
          lastFrameUri: asStoreUri(lastFrameUrl) ?? lastFrameUrl,
          outputName: regenerateOutputName(transitionId, Date.now().toString(36)),
          prompt,
          startMs: transition.startMs,
          toShotId: transition.toShotId,
          transitionId,
        },
      ],
      { promptIsFinal: opts.promptIsFinal, user },
    )
    return { workflowId }
  }

  async regenerateTransitionKeyframe(
    projectId: string,
    shotId: string,
    body: { keyframeUrl?: string; prompt: string; referenceImageUrl?: string },
    user: UserInfo,
  ): Promise<{ workflowId: string }> {
    await this.assertProjectAccess(projectId)
    const { workflowId } = await regenerateTransitionKeyframeUtil(
      {
        buildTransitionKeyframeWorkflowId: (p, s) => this.buildTransitionKeyframeWorkflowId(p, s),
        projectsService: this.projectsService,
      },
      projectId,
      shotId,
      body,
      user,
    )
    return { workflowId }
  }

  // Reimagine is not offered: every request is refused.
  async reimagineLongTake(): Promise<{ projectId: string; workflowId: string }> {
    throw new ForbiddenException('Reimagine is not available')
  }

  /**
   * Agent edit mode, a story video: the new picture (`png`, fitted to the keyframe) is stored
   * under a name of its own, and the clips that start or end on keyframe `shotId` are made again
   * from it in one run, each with the whole prompt it was made with (the stored copy is cut at 512
   * characters) on the project's clip model. The run writes the new clips into the project; the
   * picture becomes the keyframe with `commitKeyframe` once they are made, then the video is
   * rendered again (`renderFromState`).
   */
  async remakeClipsWithKeyframe(
    projectId: string,
    shotId: string,
    png: Buffer,
    user: UserInfo,
  ): Promise<StagedKeyframe & { transitionIds: string[]; workflowId: string }> {
    await this.assertProjectAccess(projectId)
    if (await this.beatLoop.isBeatLoopProject(projectId)) {
      throw new BadRequestException(LOOP_CLIP_REDO)
    }
    this.assertCanStart()
    const storage = await createStorage(projectId)
    const { keyframes, transitions } = await readKeyframesAndClips(storage)
    const clips = clipsOnKeyframe(transitions, shotId).map((c) => c.transition)
    if (!clips.length) throw new BadRequestException(`No clip starts or ends on keyframe ${shotId}`)
    const frameOf = (id: string) => {
      const url = keyframes.find((k) => k.shotId === id)?.keyframeUrl
      if (!url) throw new BadRequestException(`Keyframe ${id} is missing`)
      return asStoreUri(url) ?? url
    }
    const stamp = Date.now().toString(36)
    const staged = await stageKeyframePicture(storage, shotId, png, stamp)
    const records = await fetchTransitionGenerationRecords(
      { prisma: this.prisma as never },
      projectId,
      clips.map((t) => t.transitionId),
    )
    const workflowId = this.buildTransitionKeyframeWorkflowId(projectId, shotId)
    await this.startAgentClipRun(
      projectId,
      workflowId,
      clips.map((t) => ({
        endMs: t.endMs,
        firstFrameUri: t.fromShotId === shotId ? staged.keyframeUri : frameOf(t.fromShotId),
        fromShotId: t.fromShotId,
        lastFrameUri: t.toShotId === shotId ? staged.keyframeUri : frameOf(t.toShotId),
        outputName: regenerateOutputName(t.transitionId, stamp),
        prompt:
          resolveSuccessfulTransitionFields(
            { transitionId: t.transitionId, videoUri: t.videoUri },
            records,
          ).finalVideoPrompt || t.prompt,
        startMs: t.startMs,
        toShotId: t.toShotId,
        transitionId: t.transitionId,
      })),
      { busy: 'That keyframe is already being changed; wait for it.', promptIsFinal: true, user },
    )
    return { ...staged, transitionIds: clips.map((t) => t.transitionId), workflowId }
  }

  /**
   * Rename one BGM version. Nothing is generated.
   *
   * Persisted with a DIRECT prisma update, never internalUpdateProject: that
   * path reads the mere presence of bgmVersions as "a regeneration finished",
   * clears lastSeenAt and pushes a "music ready" notification --
   * for a rename. The synthesized current entry (a bed never recorded in the
   * history) lives only in the scalars, so its name is bgmTrackName; a
   * recorded entry that is also current writes both, keeping the panel's
   * track row and the history card on the same name after a reload.
   */
  async renameBgmVersion(
    projectId: string,
    versionId: string,
    rawTrackName: unknown,
    user: UserInfo,
  ): Promise<{ trackName: string }> {
    await this.assertProjectAccess(projectId)

    // Typed as unknown on purpose: nothing validates the request body at runtime
    // (there is no global ValidationPipe), so a JSON number or object arrives
    // here verbatim and a bare .trim() would be a 500 where a 400 is owed.
    const trackName = typeof rawTrackName === 'string' ? rawTrackName.trim() : ''
    if (!trackName) {
      throw new BadRequestException('trackName is required')
    }
    if (trackName.length > BGM_TRACK_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `trackName must be at most ${BGM_TRACK_NAME_MAX_LENGTH} characters`,
      )
    }

    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }
    const version = resolveBgmVersionHistory(project).find(
      (entry) => resolveBgmVersionId(entry.uri) === versionId,
    )
    if (!version) {
      throw new NotFoundException('Music version not found')
    }

    const stored = project.bgmVersions ?? []
    const isStored = stored.some((entry) => entry?.uri === version.uri)
    const isCurrent = version.uri === project.bgmBedUri
    await this.prisma.project.update({
      data: {
        ...(isStored
          ? {
              bgmVersions: stored.map((entry) =>
                entry?.uri === version.uri ? { ...entry, trackName } : entry,
              ) as unknown as InputJsonValue,
            }
          : {}),
        ...(isCurrent ? { bgmTrackName: trackName } : {}),
      },
      where: { id: projectId },
    })
    return { trackName }
  }

  async render(
    projectId: string,
    input: LongTakeRenderRequest,
    user: UserInfo,
  ): Promise<{ isUpscaling: boolean; workflowId: string }> {
    await this.assertProjectAccess(projectId)

    if (!hasCanonicalRenderSnapshot(input)) {
      throw new BadRequestException(
        'expectedRevision, keyframes and non-empty transitions are required',
      )
    }

    const storage = await createStorage(projectId)
    const canonicalSnapshot = normalizeEditorStateForStorage(
      {
        keyframes: input.keyframes,
        transitions: input.transitions,
      },
      normalizeRenderUri,
    )

    const currentRevision = buildLongTakeEditorRevision(await readCanonicalEditorState(storage))
    if (currentRevision !== input.expectedRevision) {
      throw new ConflictException(
        'Long Take editor state is out of date. Refresh and try exporting again.',
      )
    }

    const transitionVideos = canonicalSnapshot.transitions
    if (transitionVideos.length === 0) {
      throw new BadRequestException('No transition videos available to render')
    }
    const project = await this.projectsService.getProject(projectId)

    const client = await createClient()
    const taskQueue = await resolveTaskQueueForClient('ao-editor')
    const workflowId = getWorkflowId(projectId, 'story-mode', 'render')

    // Effective BGM at render start: the re-render republishes
    // final_video.mp4, so finalize must bake the bed like every other
    // publisher or the delivery loses its BGM. Same effective-bed rule as the
    // 4K export start (resolveEffectiveBgm): a lingering bed uri with BGM
    // disabled bakes nothing, and volume 0 is the voiceover-only delivery.
    // A client that states its music intent wins over the stored flag: the two
    // disagree whenever a toggle write did not land, and the user's toggle is
    // what the delivered file must match.
    const effectiveBgm = resolveEffectiveBgm(
      input.settings?.bgmEnabled === undefined
        ? (project ?? {})
        : { ...project, bgmEnabled: input.settings.bgmEnabled },
    )

    try {
      await client.workflow.start('LongTakeEditRenderWorkflow', {
        args: [
          {
            ...(effectiveBgm.bedUri
              ? { bgmBedUri: effectiveBgm.bedUri, bgmVolume: effectiveBgm.bgmVolume }
              : {}),
            keyframes: canonicalSnapshot?.keyframes,
            projectId,
            settings: renderRequestSettings(input.settings),
            transitionVideos,
            aspectRatio: project?.longTakeRatio ?? undefined,
            userId: user.sub,
            userEmail: user.email,
          },
        ],
        taskQueue,
        workflowId,
        workflowExecutionTimeout: '2 hours',
      })
    } catch (error) {
      const err = ensureError(error)
      if (err.name === 'WorkflowExecutionAlreadyStartedError') {
        return { isUpscaling: false, workflowId }
      }
      throw error
    }

    return { isUpscaling: false, workflowId }
  }

  /** Agent edit mode: rebuild the video from the current editor state, with the project's
   *  caption setting. */
  async renderFromState(projectId: string, user: UserInfo): Promise<{ workflowId: string }> {
    const storage = await createStorage(projectId)
    const [state, project] = await Promise.all([
      readCanonicalEditorState(storage),
      this.projectsService.getProject(projectId),
    ])
    return this.render(
      projectId,
      {
        expectedRevision: buildLongTakeEditorRevision(state),
        keyframes: state.keyframes,
        settings: editRenderSettings(project),
        transitions: state.transitions,
      },
      user,
    )
  }

  // Restyle a long-take into a NEW project under a different visual style.
  // Restyle is not offered, so every request is refused.
  async restyleLongTake(): Promise<{ projectId: string; workflowId: string }> {
    throw new ForbiddenException('Restyle is not available')
  }

  /**
   * A loop short's start (agent mode), in a project made for it: refused first when nothing can
   * make the video, then `BeatLoopService.start` writes the storyboard and starts the workflow.
   */
  async startBeatLoop(
    input: StartBeatLoopInput,
  ): Promise<{ projectId: string; workflowId: string }> {
    this.assertCanStart()
    return this.beatLoop.start(input)
  }

  async startWorkflow(
    user: UserInfo,
    userPrompt: string | undefined,
    script: string | undefined,
    prompt?: string,
    _unusedInitPrompt?: string,
    styleText?: string,
    customStyle?: boolean,
    ratio?: AspectRatio,
    voiceId?: string,
    perfectLoop?: boolean,
    visualScriptTemperature?: number,
    audioUri?: string,
    projectId?: string,
    styleName?: string,
    styleThumbnailUrl?: string,
    isSavedStyle?: boolean,
    debugSettings?: DebugSettings,
    remixProjectId?: string,
    isStyleCopy?: boolean,
    transitionVideoModel?: string,
    v4Category?: string,
    v4Track?: string,
    v4PreviewContextId?: string,
    scriptGeneratorPath?: LongTakeScriptGeneratorPath,
    keyframeImageModel?: string,
    targetDurationSeconds?: number,
    generationResolution?: GenerationResolution,
    // Story Mode project type chosen at creation; persisted on the
    // Project when this request creates it (no-projectId path).
    createUseCase?: string,
    // Channel that initiated the start ('mcp' | 'web'); threaded into
    // buildLongTakeWorkflowArgs so project.long_take.started/.completed carry it
    // for MCP-vs-web attribution. Undefined => 'unknown'.
    source?: 'mcp' | 'web',
    // Camera style picked for this start; undefined keeps the stored value.
    cameraStyle?: CameraStyle,
    // The music choice for this start; undefined keeps the stored values.
    music?: {
      bgmEnabled?: boolean
      bgmNote?: null | string
      bgmSource?: MusicSource | null
      bgmTrackId?: null | string
    },
  ): Promise<{ projectId: string; workflowId: string }> {
    // Neither fal nor Gemini can make it (no key, or the provider chosen in Setup lost its key):
    // refuse before anything is created, with why.
    this.assertCanStart()
    const { validatedVoiceId, voiceOverJson: resolvedVoiceOverJson } =
      await resolveLongTakeRequestVoice(
        { logger: this.logger, prisma: this.prisma },
        voiceId?.trim() || undefined,
        user.orgId,
      )
    const normalized = buildLongTakeStartWorkflowContext(normalizeRatio, {
      audioUri,
      customStyle,
      projectId,
      prompt,
      ratio,
      script,
      styleText,
      userPrompt,
      visualScriptTemperature,
      voiceId: validatedVoiceId,
    })
    if (!normalized.normalizedScript && !normalized.normalizedAudioPath) {
      throw new BadRequestException('Prompt or audio is required')
    }
    if (normalized.normalizedAudioPath && !normalized.normalizedProjectId) {
      throw new BadRequestException('Project ID is required when audio is provided')
    }
    const resolvedProjectId = await resolveLongTakeProjectIdUtil(
      this.projectsService as never,
      normalized.normalizedProjectId,
      normalized.projectInitialText,
      normalized.longTakeMetadata,
      normalized.normalizedStyleText,
      styleName?.trim() || undefined,
      styleThumbnailUrl?.trim() || undefined,
      resolvedVoiceOverJson,
      createUseCase,
    )
    const resolvedAudioPath = await resolveStoryModeStartAudioPath({
      audioPath: normalized.normalizedAudioPath,
      extractVideoAudioToMp3: extractVideoAudioToMp3InStore,
      isVideoExtension,
      logger: this.logger,
      projectId: resolvedProjectId,
      userId: user.userId,
    })
    const audioDurationLimitMessage = await getStoryModeAudioDurationLimitMessage({
      audioPath: resolvedAudioPath,
      projectId: resolvedProjectId,
      user,
    })
    if (audioDurationLimitMessage) {
      throw new BadRequestException(audioDurationLimitMessage)
    }
    const userAssetCatalog = await buildLongTakeUserAssetCatalog(
      {
        logger: this.logger,
        mediaService: this.mediaService as never,
        kv: this.kv as never,
      },
      resolvedProjectId,
    )
    await updateLongTakeProjectMetadataIfNeeded(
      { projectsService: this.projectsService as never },
      {
        longTakeMetadata: normalized.longTakeMetadata,
        normalizedInitPrompt: normalized.normalizedInitPrompt,
        normalizedProjectId: normalized.normalizedProjectId,
        normalizedScript: normalized.normalizedScript,
        normalizedStyleName: styleName?.trim() || undefined,
        normalizedStyleText: normalized.normalizedStyleText,
        normalizedStyleThumbnailUrl: toSavedAddress(styleThumbnailUrl?.trim()) || undefined,
        normalizedVoiceOverJson: resolvedVoiceOverJson,
        resolvedProjectId,
        userSub: user.sub,
      },
    )
    // Resolve the transition video model ONCE, then use the SAME
    // resolved value for execution and persistence (shared no-clobber helper,
    // identical to the UIP create/update paths). `?? undefined` normalizes the
    // helper's null to undefined for the downstream string | undefined params.
    const resolvedTransitionVideoModel =
      resolveTransitionVideoModel(transitionVideoModel) ?? undefined

    if (debugSettings || resolvedTransitionVideoModel) {
      await persistDebugOverrides(
        { projectsService: this.projectsService as never },
        {
          debugSettings,
          projectId: resolvedProjectId,
          // Persist the RESOLVED model: the transition activity reads
          // debugSettings.transitionVideoModel with precedence over the workflow
          // arg, so it must match what executes.
          transitionVideoModel: resolvedTransitionVideoModel,
          userSub: user.sub,
        },
      )
    }

    // Never trust the client: keep only valid enum fields.
    const resolvedGenerationResolution = sanitizeGenerationResolution(generationResolution)
    // A start never pins an image model on the project (the client's selection
    // is not honored), so clear any earlier one.
    await this.prisma.project.update({
      where: { id: resolvedProjectId },
      data: {
        imageModel: null,
        generationResolution: (resolvedGenerationResolution as InputJsonValue | undefined) ?? null,
        ...(cameraStyle === undefined ? {} : { cameraStyle: sanitizeCameraStyle(cameraStyle) }),
        ...(music?.bgmEnabled === undefined ? {} : { bgmEnabled: music.bgmEnabled }),
        ...(music?.bgmNote === undefined ? {} : { bgmNote: music.bgmNote }),
        ...(music?.bgmSource === undefined ? {} : { bgmSource: music.bgmSource }),
        ...(music?.bgmTrackId === undefined ? {} : { bgmTrackId: music.bgmTrackId }),
      },
    })

    const workflowId = getWorkflowId(resolvedProjectId, 'story-mode')
    try {
      const projectWorkflowFlags = await resolveProjectWorkflowFlags(
        this.projectsService,
        resolvedProjectId,
      )
      const bgmTrack = await this.resolveStartBgmTrack(projectWorkflowFlags, user.userId)
      const workflowArgs = buildLongTakeWorkflowArgs({
        bgmEnabled: projectWorkflowFlags.bgmEnabled,
        bgmNote: projectWorkflowFlags.bgmNote,
        bgmTrack,
        cameraStyle: projectWorkflowFlags.cameraStyle,
        debugSettings,
        enableCaption: projectWorkflowFlags.enableCaption,
        generationResolution: resolvedGenerationResolution,
        isStyleCopy,
        keyframeImageModel,
        modelSelectorTier: projectWorkflowFlags.modelSelectorTier,
        normalized,
        orgId: user.orgId,
        perfectLoop,
        remixProjectId,
        resolvedAudioPath,
        resolvedProjectId,
        scriptGeneratorPath: resolvedAudioPath ? 'audio_upload' : scriptGeneratorPath,
        source,
        styleName,
        styleThumbnailUrl,
        targetDurationSeconds,
        // Execute with the RESOLVED model -- never the raw client selection.
        transitionVideoModel: resolvedTransitionVideoModel,
        user,
        userAssetCatalog,
        v4Category,
        v4PreviewContextId,
        v4Track,
      })

      await saveLongTakeRequestMetadata(
        {
          logger: this.logger,
          mediaService: this.mediaService as never,
          kv: this.kv as never,
        },
        {
          isSavedStyle,
          normalized,
          resolvedAudioPath,
          resolvedProjectId,
          styleName,
          styleThumbnailUrl,
        },
      )

      return startStandaloneAdmissionWorkflow(
        {
          logger: this.logger,
          mediaService: this.mediaService as never,
          kv: this.kv as never,
        },
        createClient as never,
        buildQueuedAdmissionMeta,
        {
          resolvedProjectId,
          taskQueue: await resolveStoryModeTaskQueue(),
          user,
          workflowArgs,
          workflowId,
        },
      )
    } catch (error) {
      handleStoryModeStartWorkflowFailure({
        error,
        logger: this.logger,
        resolvedProjectId,
        user,
      })
      throw error
    }
  }

  /** Agent edit mode, a loop short: the new picture becomes the keyframe, and the loop runs
   *  again from the clip landing on it (`BeatLoopService.swapKeyframe`). */
  async swapLoopKeyframe(
    projectId: string,
    shotId: string,
    png: Buffer,
    user: UserInfo,
  ): Promise<LoopKeyframeSwapPlan & { workflowId: string }> {
    this.assertCanStart()
    return this.beatLoop.swapKeyframe(projectId, shotId, png, user)
  }

  /**
   * Persist the music panel's settings and republish the delivered
   * video at them. Settings persist unconditionally (they seed the panel and
   * carry into rerun); the remux only starts when there is something to
   * rebuild -- a generated bed AND a delivered resultVideo. The workflow id is
   * shared per project with TERMINATE_EXISTING so rapid edits are
   * latest-write-wins (the superseding run rewrites both variants).
   */
  async updateBgmSettings(
    projectId: string,
    body: unknown,
    user: UserInfo,
  ): Promise<{
    remux: 'skipped_no_bed' | 'skipped_not_delivered' | 'started'
    workflowId?: string
  }> {
    await this.assertProjectAccess(projectId)
    const settings = parseBgmSettingsBody(body)

    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }

    // Turning music on at a saved 0% would stay silent while it reads as on: back to default.
    const volumeToSave =
      settings.bgmEnabled === true && settings.bgmVolume === undefined && project.bgmVolume === 0
        ? BGM_DEFAULT_VOLUME
        : settings.bgmVolume
    await this.projectsService.internalUpdateProject(
      projectId,
      {
        ...(settings.bgmEnabled === undefined ? {} : { bgmEnabled: settings.bgmEnabled }),
        ...(volumeToSave === undefined ? {} : { bgmVolume: volumeToSave }),
      },
      user.userId || 'system',
    )
    await this.dropStatusCache(projectId)

    if (!project.bgmBedUri) {
      return { remux: 'skipped_no_bed' }
    }
    if (!project.resultVideo) {
      return { remux: 'skipped_not_delivered' }
    }

    const bgmEnabled = settings.bgmEnabled ?? project.bgmEnabled ?? false
    const bgmVolume = volumeToSave ?? project.bgmVolume ?? BGM_DEFAULT_VOLUME

    const client = await createClient()
    const workflowId = this.buildBgmRemuxWorkflowId(projectId)
    await client.workflow.start('LongTakeBgmRemuxWorkflow', {
      args: [
        {
          bgmBedUri: project.bgmBedUri,
          bgmEnabled,
          bgmVolume,
          projectId,
          userEmail: user.email,
          userId: user.userId,
        },
      ],
      taskQueue: await resolveStoryModeTaskQueue(),
      workflowExecutionTimeout: '30 minutes',
      workflowId,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.TERMINATE_EXISTING,
    })
    this.logger.log(
      `BGM settings remux started ${JSON.stringify({ projectId, bgmEnabled, bgmVolume, workflowId })}`,
    )
    return { remux: 'started', workflowId }
  }

  /**
   * Save the caption look the user picked (style, highlight, height, size) on the
   * project. Fields sent replace the saved ones, null puts one back to its default and
   * fields left out are kept. Nothing re-renders here: the editor preview resolves the
   * settings live, and the next render or export draws them.
   */
  async updateCaptionSettings(
    projectId: string,
    body: unknown,
    user: UserInfo,
  ): Promise<{ captionStyle: CaptionStyleSettings }> {
    await this.assertProjectAccess(projectId)
    const settings = parseCaptionSettingsBody(body)

    const project = await this.projectsService.getProject(projectId)
    if (!project) {
      throw new BadRequestException('Project not found')
    }

    const captionStyle = { ...readCaptionStyleSettings(project.captionStyle), ...settings }
    await this.projectsService.internalUpdateProject(
      projectId,
      { captionStyle },
      user.userId || 'system',
    )
    await this.dropStatusCache(projectId)
    return { captionStyle }
  }

  private async assertProjectAccess(projectId: string): Promise<void> {
    if (!(await this.projectsService.canVisitProject(projectId))) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }
  }

  /**
   * Whether the project holds edits the last render has not applied.
   *
   * THROWS on a read/migration failure so each caller can pick its own
   * posture: the status endpoint degrades to "no changes" (a corrupt blob
   * must not 500 a read), while the export guard must fail CLOSED -- an
   * unreadable draft is exactly the case where we cannot prove the
   * composition is current, and money moves on the answer.
   */
  private async detectUnrenderedChanges(
    projectId: string,
    storage: Awaited<ReturnType<typeof createStorage>>,
    canonical: LongTakeEditorState,
    inpaintState: InpaintGlobalState | null,
  ): Promise<boolean> {
    return (
      (await this.resolveEditedComposition(projectId, storage, canonical, inpaintState)) !== null
    )
  }

  /** The status endpoint caches its answer for a few seconds: after a music write, the next
   *  read must see the change (the page re-reads it as soon as the chat or the switch is done). */
  private async dropStatusCache(projectId: string): Promise<void> {
    try {
      await this.kv.del(`${STATUS_CACHE_PREFIX}${projectId}`)
    } catch (error) {
      this.logger.warn(
        `Failed to drop the status cache for ${projectId}: ${ensureError(error).message}`,
      )
    }
  }

  /**
   * Authoritative status + runId of the LATEST bgm-regen run, same
   * semantics as the remux probe above: WorkflowNotFoundError is the definite
   * never-ran answer (not_started); any other probe failure holds as
   * 'unknown' so the client never mistakes a transient hiccup for a settled
   * run. The runId lets the client attribute a terminal outcome to a specific
   * run (return-visit failure toasts fire once per run).
   */
  private async getBgmRegenState(
    projectId: string,
  ): Promise<{ outcome: BgmRemuxOutcome; runId: null | string }> {
    try {
      const client = await createClient()
      const handle = client.workflow.getHandle(getWorkflowId(projectId, 'story-mode', 'bgm-regen'))
      const description = await handle.describe()
      return {
        outcome: resolveBgmRemuxOutcome(description.status.name),
        runId: description.runId ?? null,
      }
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return { outcome: 'not_started', runId: null }
      }
      this.logger.warn(
        `BGM regen outcome probe failed ${JSON.stringify({
          error: ensureError(error).message,
          projectId,
        })}`,
      )
      return { outcome: 'unknown', runId: null }
    }
  }

  /**
   * Authoritative status of the LATEST bgm-remux run. Only the
   * DEFINITE no-such-workflow answer (WorkflowNotFoundError, the normal case
   * for a project that never ran a remux) reads as not_started; any other
   * probe failure reads as 'unknown' so the client never mistakes a transient
   * hiccup for "no remux is running" and downloads a mid-rewrite file.
   */
  private async getBgmRemuxOutcome(projectId: string): Promise<BgmRemuxOutcome> {
    try {
      const client = await createClient()
      const handle = client.workflow.getHandle(this.buildBgmRemuxWorkflowId(projectId))
      return resolveBgmRemuxOutcome((await handle.describe()).status.name)
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        return 'not_started'
      }
      this.logger.warn(
        `BGM remux outcome probe failed ${JSON.stringify({
          error: ensureError(error).message,
          projectId,
        })}`,
      )
      return 'unknown'
    }
  }

  private async patchBgmRun(projectId: string, bgmRun: BgmRunState | null, user: UserInfo) {
    try {
      await this.projectsService.internalUpdateProject(
        projectId,
        { bgmRun },
        user.userId,
        user.orgId,
      )
    } catch (error) {
      this.logger.warn(
        `Failed to record the BGM run start for ${projectId}: ${ensureError(error).message}`,
      )
    }
  }

  private async pushClosedWorkflowEvent(
    bus: {
      end: () => Promise<void>
      push: (event: { data: string; type: string }) => Promise<void>
    },
    code: 'WORKFLOW_CLOSED' | 'WORKFLOW_NOT_FOUND',
  ): Promise<void> {
    await bus.push({
      type: 'update',
      data: JSON.stringify({
        status: 'failed',
        error: { code, message: 'Regeneration did not finish. Please try again.' },
        updatedAt: Date.now(),
      }),
    })
    await bus.end()
  }

  /**
   * Read the typed `blocked` outcome from a COMPLETED regen
   * workflow's result, or undefined when the workflow completed normally / the
   * result cannot be read. Best-effort and read-only: a failure to fetch must
   * not break stream teardown.
   */
  private async readBlockedRegenOutcome(
    workflowId: string,
  ): Promise<undefined | { category: string; userMessage: string }> {
    try {
      const client = await createClient()
      const result = (await client.workflow.getHandle(workflowId).result()) as null | {
        blocked?: { category?: unknown; userMessage?: unknown }
      }
      const blocked = result?.blocked
      if (
        blocked &&
        typeof blocked.category === 'string' &&
        typeof blocked.userMessage === 'string'
      ) {
        return { category: blocked.category, userMessage: blocked.userMessage }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read blocked regen outcome for ${workflowId}: ${ensureError(error).message}`,
      )
    }
    return undefined
  }

  private async resolveClosedWorkflowStream(
    workflowId: string,
    bus: {
      end: () => Promise<void>
      push: (event: { data: string; type: string }) => Promise<void>
    },
  ): Promise<void> {
    let statusName: string
    try {
      const client = await createClient()
      const description = await client.workflow.getHandle(workflowId).describe()
      statusName = description.status.name
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        await this.pushClosedWorkflowEvent(bus, 'WORKFLOW_NOT_FOUND')
        return
      }
      // Transient describe failure -- keep the stream open; the live SSE may still deliver.
      this.logger.warn(
        `Failed to describe workflow ${workflowId} after progress query failure: ${ensureError(error).message}`,
      )
      return
    }

    if (statusName === 'COMPLETED') {
      // A regen workflow now closes COMPLETED even when the request
      // was blocked (an unsupported edit), carrying a typed `blocked` payload in
      // its result. If this reconnect's progress query failed, the client would
      // otherwise get neither the blocked message nor onFailed (the SSE consumer
      // starts after the last stored event, so notifyErrorActivity is not
      // replayed). Recover the blocked message from the completed result and
      // emit it as a terminal failure event, mirroring the old FAILED fallback,
      // before ending the stream.
      const blocked = await this.readBlockedRegenOutcome(workflowId)
      if (blocked) {
        await bus.push({
          type: 'update',
          data: JSON.stringify({
            status: 'failed',
            error: { code: blocked.category, message: blocked.userMessage },
            updatedAt: Date.now(),
          }),
        })
      }
      await bus.end()
      return
    }
    if (TERMINAL_WORKFLOW_STATUSES.has(statusName)) {
      await this.pushClosedWorkflowEvent(bus, 'WORKFLOW_CLOSED')
    }
  }

  /**
   * The composition the user is actually looking at, when it differs from the
   * last-rendered one -- otherwise null.
   *
   * Both editors are covered from one place: the inpaint editor persists its
   * own history, and the legacy editor's storage draft is migrated onto a
   * canonical base to reach the same shape. Reading it SERVER-side is what
   * lets 4K price and export the edited cut without a client contract change
   * (the client never sends its edits to the 4K endpoints).
   *
   * Throws on a read/migration failure; callers pick their posture (the status
   * endpoint degrades, the export path fails closed).
   */
  private async resolveEditedComposition(
    projectId: string,
    storage: Awaited<ReturnType<typeof createStorage>>,
    canonical: LongTakeEditorState,
    // Already-read inpaint state, so a caller deriving several signals from it
    // pays for one storage read. Omit to read it here.
    preReadInpaintState?: InpaintGlobalState | null,
  ): Promise<LongTakeEditorState | null> {
    const inpaintState =
      preReadInpaintState === undefined ? await readInpaintState(projectId) : preReadInpaintState
    if (inpaintState) {
      const current = new InpaintHistory(inpaintState.history).current
      return buildLongTakeEditorRevision(current) === buildLongTakeEditorRevision(canonical)
        ? null
        : current
    }

    const baseId = hexToUuidV4(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'))
    const baseHistory: InpaintHistoryData = {
      base: { id: baseId, keyframes: canonical.keyframes, transitions: canonical.transitions },
      currentId: baseId,
      diffs: {},
      latestId: baseId,
    }
    const migrated = migrateLegacyDraftToInpaintHistory({
      baseHistory,
      draft: await readEditorDraft(storage),
      keyframes: canonical.keyframes,
      transitions: canonical.transitions,
    })
    return migrated.status === 'migrated' ? new InpaintHistory(migrated.history).current : null
  }

  /**
   * Regenerate the BGM bed = create a new BGM version. Starts
   * LongTakeBgmRegenerateWorkflow, which persists the new bed and best-effort
   * re-muxes the delivered video. No TERMINATE_EXISTING: a duplicate start
   * surfaces as a 409 instead of superseding the in-flight run. The enable_bgm
   * gate is the project's own `bgmEnabled`: a requested bed is a request to hear it, so
   * the flag is turned on here before the run.
   */
  /**
   * The chosen track for a start, resolved for the workflow. An unknown track (a library
   * id the manifest dropped, a deleted upload) logs and falls back to a generated bed
   * rather than failing the video.
   */
  private async resolveStartBgmTrack(
    flags: { bgmEnabled: boolean | null; bgmSource: null | string; bgmTrackId: null | string },
    userId: string,
  ): Promise<MusicTrackArg | null> {
    if (!flags.bgmEnabled || !flags.bgmTrackId) return null
    if (flags.bgmSource !== 'library' && flags.bgmSource !== 'upload') return null
    try {
      return await this.music.resolveTrackArg(userId, {
        id: flags.bgmTrackId,
        source: flags.bgmSource,
      })
    } catch (error) {
      this.logger.warn(
        `[long-take] chosen music track ${flags.bgmSource}:${flags.bgmTrackId} not found; a bed is generated instead (${String(error)})`,
      )
      return null
    }
  }

  /**
   * Starts RegenerateTransitionWorkflow for agent edit mode: the clips are made again in order,
   * on the project's clip model and camera style, and written into the project's clips when all
   * are made (`commitToCanonical`). A run already going under `workflowId` is a 409 (`busy`).
   */
  private async startAgentClipRun(
    projectId: string,
    workflowId: string,
    transitionList: Record<string, unknown>[],
    opts: { busy?: string; promptIsFinal: boolean; user: UserInfo },
  ): Promise<void> {
    const project = await this.projectsService.getProject(projectId)
    const transitionVideoModel = this.transitionModelOf(project)
    const client = await createClient()
    try {
      await client.workflow.start('RegenerateTransitionWorkflow', {
        args: [
          {
            aspectRatio: project?.longTakeRatio ?? undefined,
            ...(project?.cameraStyle
              ? { cameraStyle: sanitizeCameraStyle(project.cameraStyle) }
              : {}),
            commitToCanonical: true,
            projectId,
            promptIsFinal: opts.promptIsFinal,
            transitionList,
            ...(transitionVideoModel ? { transitionVideoModel } : {}),
            userEmail: opts.user.email,
            userId: opts.user.sub,
          },
        ],
        taskQueue: await resolveTaskQueueForClient('ao-editor'),
        workflowExecutionTimeout: '2 hours',
        workflowId,
      })
    } catch (error) {
      if (ensureError(error).name === 'WorkflowExecutionAlreadyStartedError') {
        throw new ConflictException(opts.busy ?? 'A clip is already being redone; wait for it.')
      }
      throw error
    }
  }

  /** The clip model the project's clips are made on (its `transitionVideoModel`), or none. */
  private transitionModelOf(
    project: null | undefined | { debugSettings?: unknown },
  ): string | undefined {
    const debugSettings = project?.debugSettings as DebugSettings | null | undefined
    return (
      resolveTransitionVideoModel(
        typeof debugSettings?.transitionVideoModel === 'string'
          ? debugSettings.transitionVideoModel
          : undefined,
      ) ?? undefined
    )
  }
}

/** The keyframes (`store://` pictures) and clips the project's files list. */
async function readKeyframesAndClips(storage: Awaited<ReturnType<typeof createStorage>>): Promise<{
  keyframes: { keyframeUrl: string; shotId: string }[]
  transitions: LongTakeTransition[]
}> {
  const [keyframes, transitions] = await Promise.all([
    readOptionalJsonFile<{ keyframeUrl: string; shotId: string }[]>(storage, KEYFRAMES_PATH),
    readOptionalJsonFile<LongTakeTransition[]>(storage, 'long_take/transition_videos.json'),
  ])
  return {
    keyframes: Array.isArray(keyframes) ? keyframes : [],
    transitions: Array.isArray(transitions) ? transitions : [],
  }
}
