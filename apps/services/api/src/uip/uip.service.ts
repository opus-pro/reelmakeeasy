/**
 * UIP Service -- Production API Layer (Architecture doc section 2.8)
 *
 * Translates HTTP requests into workflow signals and MongoDB reads.
 * The API Service is the coordinator -- it does NOT run the planner loop.
 *
 * Key design:
 * - Write operations -> Signal the workflow
 * - Read operations -> Read from persisted DB + storage (not a workflow query)
 * - Confirm -> API Service orchestrates: write storage + update Project + start story-mode workflow + signal UIP
 * - Callbacks -> activities POST back here for persist + SSE push
 */

import type { Prisma } from '@reelmakeeasy/api-db'
import { ProjectDeletedEvent } from '@reelmakeeasy/common/events/project.events'
import { KvStore } from '@reelmakeeasy/common/kv/store'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { generateUploadSignedUrl } from '@reelmakeeasy/common/storage/stored-files'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { UIP_INBOUND_SIGNALS } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { getUipWorkflowId } from '@reelmakeeasy/common/workflow/uip-workflow-version'
import type {
  ActiveModalKind,
  CancelQueuedItemSignalPayload,
  ContinueUipDraftSignalPayload,
  ScriptReviewUpdateSignalPayload,
  SessionResponse,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  supportsWorkflowProtocolFeature,
} from '@reelmakeeasy/uip-planner-runtime'
import { Client, WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/client'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import { BrandBriefStyleGenerationService } from '../brand-briefs/brand-brief-style-generation.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectService } from '../projects/projects.service'
import { parseVoiceOverJson } from '../projects/projects-lifecycle.util'
import { UserSavedStylesService } from '../user-saved-styles/user-saved-styles.service'
import { VoiceOverService } from '../voice-over/voice-over.service'

import type { TranscriptVoicePreviewDto, UploadFileDescriptorDto } from './uip.dto'
import {
  brandBankEditBodyToSignalPayload,
  confirmBrandReview as confirmBrandReviewOp,
  type ConfirmBrandReviewBody,
  type EditBrandBankBody,
  submitBrandBrief as submitBrandBriefOp,
} from './uip-brand-operations'
import { getCarryUipContextFn } from './uip-carry-uip-context'
import { executeConfirmFastOrchestration } from './uip-confirm-fast-orchestration'
import { executeConfirmOrchestration } from './uip-confirm-orchestration'
import { PHASE_RANK } from './uip-constants'
import { clearSessionContinued, markSessionContinued } from './uip-continue-marker'
import type { CreateSessionInput } from './uip-create-session'
import { createUipSession } from './uip-create-session'
import type { DeadlineExpiredDecision } from './uip-deadline-resolver'
import { resolveDeadlineExpiredFn } from './uip-deadline-resolver'
import { appendGuiEditEvent } from './uip-gui-edit'
import { cancelInputMessage } from './uip-input-inbox'
import {
  retryModelTransaction,
  selectUipModels,
  type SelectUipModelsInput,
} from './uip-model-selection'
import { claimNextAction } from './uip-next-action'
import { persistFromCallbackToStorage, writeLiveStatusState } from './uip-persist-callback'
import { cancelSessionOnProjectDeleted } from './uip-project-deleted'
import { validateScriptReviewInput } from './uip-script-validation'
import { sendGuiUpdateFn } from './uip-send-gui-update'
import { sendMessageFn } from './uip-send-message'
import { sendSummaryUpdateFn, type SummaryUpdateGlobalConstraints } from './uip-send-summary-update'
import { assertActiveSession, assertUipAccess } from './uip-session-assertions'
import { setAutoContinueFn } from './uip-set-auto-continue'
import { getSpecVersionFromStorage } from './uip-spec-version'
import {
  appendActionEvent,
  mergeTranscriptAndSessionChanged,
  resolveActionEvents,
  setPendingActionIntent,
  updateTimelineEvents,
  writeOperateAtHeartbeat,
} from './uip-timeline-lock-writers'
import type { UipTranscriptMessage } from './uip-timeline-merge'
import { normalizeTimeline, sessionResponseToChangedEventInput } from './uip-timeline-transformers'
import type { StateChanges } from './uip-timeline-types'
import type { UipSessionState } from './uip-timeline-types'
import { updateTranscriptEditingStateWithLock } from './uip-transcript-editing'
import {
  generateTranscriptVoicePreviewFn,
  readTranscriptVoicePreviewEnabledFromSpec,
  type TranscriptVoicePreviewResponse,
} from './uip-transcript-voice-preview'
import { triggerNextActionFn } from './uip-trigger-next-action'
import { assertUipVoiceUsable } from './uip-voice-guard'
import { resolveUserDefaultImageModel } from './user-default-image-model.util'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-service')

@Injectable()
export class UipService {
  private workflowClient: Client | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly voiceOverService: VoiceOverService,
    private readonly userSavedStylesService: UserSavedStylesService,
    // Optional so the many unit tests that construct UipService with positional
    // mocks need not wire the store; prod always injects it (KvModule is @Global).
    private readonly kv?: KvStore,
    // Optional for the same test-construction reason; prod injects it via the
    // BrandBriefModule import.
    private readonly brandBriefStyleGeneration?: BrandBriefStyleGenerationService,
  ) {}

  //
  // PUBLIC API METHODS
  //

  async assertReadAccess(projectId: string): Promise<void> {
    await this.assertUipAccess(projectId, 'read')
  }

  async assertUipAccess(projectId: string, mode: 'read' | 'write'): Promise<void> {
    await assertUipAccess(this.projectService, projectId, mode)
  }

  async cancelQueuedItem(projectId: string, queuedItemId: string): Promise<boolean> {
    await this.assertUipAccess(projectId, 'write')

    const session = await this.loadSession(projectId, { state: true })
    const sessionState = (session.state ?? {}) as { workflow_protocol_version?: string }
    const isNewProtocol = supportsWorkflowProtocolFeature(
      sessionState.workflow_protocol_version,
      API_INBOX_WORKFLOW_PROTOCOL_SINCE,
    )

    if (isNewProtocol) {
      // New protocol: inbox removal is the cancel. The workflow is not signalled --
      // it never owned queued items and has no handler for uip-cancel-queued-item.
      return cancelInputMessage(this.prisma, projectId, queuedItemId)
    }

    // Old protocol path: mark timeline event unqueued + send cancel signal.
    const payload: CancelQueuedItemSignalPayload = { queuedItemId }
    await Promise.all([
      updateTimelineEvents(this.prisma, projectId, (current) => {
        const updateItems: Array<{ id: number; status: 'unqueued' }> = []
        for (const event of current.events) {
          if (
            event.type === 'user_message' &&
            event.message_id === queuedItemId &&
            event.status === 'pending'
          ) {
            updateItems.push({ id: event.id, status: 'unqueued' })
            event.status = 'unqueued'
          }
        }
        return updateItems
      }).catch((err): undefined => {
        logger.warn(`[${projectId}] cancelQueuedItem timeline write failed: ${err}`)
      }),
      this.signalWorkflow(projectId, 'uip-cancel-queued-item', payload),
    ])
    return true
  }

  /** Cancel a session. Allowed for any active session regardless of phase. */
  async cancelSession(
    projectId: string,
    gateToken: string,
    clientId?: string,
    userId?: string,
  ): Promise<'accepted' | 'duplicated' | 'rejected'> {
    await this.assertUipAccess(projectId, 'write')
    return this.cancelActiveSession({ clientId, gateToken, projectId, trigger: 'user', userId })
  }

  /**
   * Cancel a single running tool by name. The session stays alive.
   */
  async cancelTool(projectId: string, toolName: string, userId?: string): Promise<'accepted'> {
    await this.assertUipAccess(projectId, 'write')
    // Direct signal (not the inbox): a cancel must be immediate and must not be
    // buffered behind a pending_action. Idempotent -- if no matching tool is
    // running the workflow no-ops. Session stays alive (per-tool cancel).
    await this.signalWorkflow(projectId, 'uip-cancel-tool', { toolName })
    logger.info(`[${projectId}] Cancel tool signal sent: ${toolName} (userId=${userId ?? 'n/a'})`)
    return 'accepted'
  }

  /**
   * State-machine check for action events (synchronous, pass in a loaded session).
   * Returns 'ok' if the session is active and in one of the allowed phases, 'rejected' otherwise.
   */
  checkActionAllowed(
    session: Pick<Awaited<ReturnType<typeof this.loadSession>>, 'phase' | 'status'>,
    allowedPhases: string[],
  ): 'ok' | 'rejected' {
    if (session.status !== 'active' || !allowedPhases.includes(session.phase ?? '')) {
      return 'rejected'
    }
    return 'ok'
  }

  async claimNextActionById(projectId: string, actionId: string): Promise<boolean> {
    return claimNextAction(this.prisma, projectId, actionId)
  }

  //

  async confirmBrandReview(projectId: string, body: ConfirmBrandReviewBody, userId?: string) {
    return confirmBrandReviewOp(this, projectId, body, userId)
  }

  /**
   * Confirm-fast: combine continue + confirm (lock + start fast workflow) in one
   * step. Valid in script_review phase only (new protocol sessions exclusively).
   */
  async confirmFast(
    projectId: string,
    _clientId?: string,
    _userId?: string,
  ): Promise<'accepted' | 'duplicated' | 'rejected'> {
    await this.assertUipAccess(projectId, 'write')
    const session = await this.loadSession(projectId, {
      status: true,
      phase: true,
      voiceId: true,
    })
    if (this.checkActionAllowed(session, ['script_review']) === 'rejected') {
      return 'rejected'
    }
    assertUipVoiceUsable(session.voiceId)
    const intentResult = await setPendingActionIntent(this.prisma, projectId, 'confirm_fast')
    if (intentResult !== 'rejected') {
      await this.signalWorkflow(projectId, 'uip-wake')
    }
    // uipVideoStarted is fired later by triggerNextActionFn when the fast workflow
    // actually starts -- not here at intent-acceptance, which re-fired on every
    // retry of a failed confirm-fast (e.g. word cap).
    return intentResult
  }

  async confirmPlan(
    projectId: string,
    clientId?: string,
    userId?: string,
  ): Promise<'accepted' | 'duplicated' | 'rejected'> {
    await this.assertUipAccess(projectId, 'write')
    logger.info(`[${projectId}] confirmPlan called`)
    try {
      return await this._confirmPlanInternal(projectId, clientId, userId)
    } catch (err) {
      const errJson = JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      logger.error(`[${projectId}] confirmPlan failed ${errJson}`)
      throw err
    }
  }

  //

  /** Continue UIP draft. Valid in script_review phase only. */
  async continueUipDraft(
    projectId: string,
    gateToken: string,
    clientId?: string,
    userId?: string,
  ): Promise<'accepted' | 'duplicated' | 'rejected'> {
    await this.assertUipAccess(projectId, 'write')
    const session = await this.loadSession(projectId, {
      state: true,
      status: true,
      phase: true,
      timeline: true,
      imageModel: true,
      transitionVideoModel: true,
    })
    if (
      this.checkActionAllowed(session, ['script_review']) === 'rejected' ||
      (session.state as null | UipSessionState)?.script_word_cap_exceeded === true
    ) {
      return 'rejected'
    }

    const continueSessionState = (session.state ?? {}) as UipSessionState
    const isNewProtocol = supportsWorkflowProtocolFeature(
      continueSessionState.workflow_protocol_version,
      API_INBOX_WORKFLOW_PROTOCOL_SINCE,
    )

    if (isNewProtocol) {
      // New protocol: defer the continue orchestration + signal dispatch to triggerNextAction
      // so activity retries handle failures atomically.
      const result = await setPendingActionIntent(this.prisma, projectId, 'continue')
      if (result !== 'rejected') {
        await this.signalWorkflow(projectId, 'uip-wake')
        // uipScriptConfirmed fires from triggerNextAction once the continue action
        // actually dispatches, not here at intent-acceptance.
      }
      return result
    }

    // Claim first: model selection checks this intent in its Mongo transaction.
    const result = await appendActionEvent(this.prisma, projectId, 'continue', clientId)
    if (result !== 'accepted') {
      return result
    }
    try {
      await markSessionContinued(this.prisma, projectId)
    } catch (error) {
      await resolveActionEvents(this.prisma, projectId, []).catch((resolveErr) => {
        logger.warn(`[${projectId}] Failed to resolve continue action event: ${resolveErr}`)
      })
      throw error
    }

    if (result === 'accepted') {
      const payload: ContinueUipDraftSignalPayload = { gateToken }
      await this.signalWorkflow(projectId, 'uip-continue-draft', payload)
    }
    return result
  }

  async createSession(input: CreateSessionInput) {
    return createUipSession(input, {
      prisma: this.prisma,
      projectService: this.projectService,
      kv: this.kv,
      // Parks auto-continue on a session this create supersedes.
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
      getWorkflowClient: () => this.getWorkflowClient(),
    })
  }

  async generateTranscriptVoicePreview(
    projectId: string,
    input: TranscriptVoicePreviewDto,
  ): Promise<TranscriptVoicePreviewResponse> {
    return generateTranscriptVoicePreviewFn({
      assertAccess: (sessionProjectId, mode) => this.assertUipAccess(sessionProjectId, mode),
      input,
      loadSession: (sessionProjectId, select) => this.loadSession(sessionProjectId, select),
      prisma: this.prisma,
      projectId,
      readTranscriptVoicePreviewEnabledFromSpec,
      voiceOverService: this.voiceOverService,
    })
  }

  async generateUploadUrls(projectId: string, files: UploadFileDescriptorDto[]) {
    await this.assertUipAccess(projectId, 'write')
    this.assertImageUploadDescriptors(files)
    const uploads = await Promise.all(
      files.map(async (file) => {
        const assetId = `upload_${Date.now()}_${file.index}`
        // Full path in bucket (for signed URL generation)
        const fullStorePath = `projects/${projectId}/user-intent-planner/uploads/${assetId}/${file.fileName}`
        // Relative to planner storage root projects/<projectId>/user-intent-planner/.
        // describe_uploaded_images uses createStorage(<sessionId>/user-intent-planner)
        // which has root projects/<sessionId>/user-intent-planner/.
        const fileUri = `uploads/${assetId}/${file.fileName}`

        const { signedUrl, expiresAt: urlExpiresAt } = await generateUploadSignedUrl(
          fullStorePath,
          file.contentType,
        )

        return { assetId, expiresAt: urlExpiresAt, fileUri, index: file.index, signedUrl }
      }),
    )
    return { uploads }
  }

  /** Remix carry-over preview; see uip-carry-uip-context.ts. */
  async getCarryUipContext(sourceProjectId: string, shareId?: string) {
    return getCarryUipContextFn(
      { prisma: this.prisma, projectService: this.projectService },
      sourceProjectId,
      shareId,
    )
  }

  async getSession(projectId: string) {
    await this.assertUipAccess(projectId, 'read')
    const uipSession = await this.prisma.uipSession.findUnique({ where: { projectId } })
    if (!uipSession) {
      throw new NotFoundException(`UIP session not found: ${projectId}`)
    }
    const state = ((uipSession.state as null | UipSessionState) ?? {}) satisfies UipSessionState
    const project = await this.projectService.getProject(projectId)
    const voice = project?.voiceOverJson as null | ProjectVoiceOverJson
    // Carried-forward default (Wave 4, spec D7): the model this user's
    // FIRST PT-routed project rendered on, else the org config default. The
    // selector DISPLAYS this for a non-picker (no explicit image_model) without
    // writing the explicit-selection atom, so PT-routing eligibility is
    // preserved -- only a real click is an explicit pick. assertUipAccess above
    // already guarantees the project exists.
    const carriedForwardImageModel = await resolveUserDefaultImageModel(
      this.prisma as never,
      project?.owner ?? '',
      project?.orgId ?? null,
    )
    return {
      session_id: uipSession.projectId,
      phase: uipSession.phase,
      status: uipSession.status,
      spec_version: uipSession.specVersion,
      locked_at: uipSession.lockedAt?.toISOString() ?? null,
      voice: voice ?? null,
      voice_id: uipSession.voiceId ?? null,
      aspect_ratio: uipSession.aspectRatio ?? null,
      image_model: uipSession.imageModel ?? null,
      model_selector_tier: uipSession.modelSelectorTier ?? project?.modelSelectorTier ?? undefined,
      carried_forward_image_model: carriedForwardImageModel,
      entry_use_case: uipSession.entryUseCase ?? null,
      transition_video_model: uipSession.transitionVideoModel ?? null,
      created_at: uipSession.createdAt.toISOString(),
      updated_at: uipSession.updatedAt.toISOString(),
      state,
      state_version: uipSession.stateVersion,
      timeline: normalizeTimeline(uipSession.timeline),
    }
  }

  /** Read a specific spec version from storage with diff markers against previous version. */
  async getSpecVersion(projectId: string, version: number) {
    await this.assertUipAccess(projectId, 'read')
    return getSpecVersionFromStorage({ projectId, version })
  }

  /**
   * Stop the planner session when its project is deleted.
   *
   * Without this the session's auto-continue deadline keeps firing after the
   * delete, confirms on the user's behalf, and renders a video
   * into a row the owner can no longer open. Delete is also the only stop button
   * the product offers outside script review, so it has to mean stop.
   *
   * Deliberately never throws: the project is already soft-deleted by the time
   * this runs and the rest of the `project.deleted` fan-out must still complete.
   */
  @OnEvent('project.deleted')
  async handleProjectDeletedEvent(payload: ProjectDeletedEvent): Promise<void> {
    await cancelSessionOnProjectDeleted(payload.projectId, {
      cancelActiveSession: (projectId) =>
        this.cancelActiveSession({ gateToken: '', projectId, trigger: 'project_deleted' }),
      prisma: this.prisma,
    })
  }

  /** Fetch session or throw 404. */
  async loadSession(
    projectId: string,
  ): Promise<NonNullable<Awaited<ReturnType<PrismaService['uipSession']['findUnique']>>>>
  async loadSession<TSelect extends Prisma.UipSessionSelect>(
    projectId: string,
    select: TSelect,
  ): Promise<Prisma.UipSessionGetPayload<{ select: TSelect }>>
  async loadSession<TSelect extends Prisma.UipSessionSelect>(
    projectId: string,
    select?: TSelect,
  ): Promise<unknown> {
    const session = await this.prisma.uipSession.findUnique({
      where: { projectId },
      ...(select ? { select } : {}),
    })
    if (!session) {
      throw new NotFoundException(`UIP session not found: ${projectId}`)
    }
    return session
  }
  /** Called by persistSessionSnapshot local activity via HTTP POST. */
  async persistFromCallback(
    projectId: string,
    sessionState: unknown,
    newRawInput?: {
      sessionState?: null | unknown
      spec?: null | unknown
    },
  ) {
    await persistFromCallbackToStorage({
      logger,
      prisma: this.prisma,
      projectId,
      sessionState,
      newRawInput,
    })
  }
  /** Called by publishSessionStatus local activity via HTTP POST. */
  async publishStatusFromCallback(projectId: string, status: unknown) {
    const response = status as SessionResponse
    const ts = new Date().toISOString()
    const nextState = sessionResponseToChangedEventInput(response)
    const transcript = (response.transcript ?? []) as UipTranscriptMessage[]

    await mergeTranscriptAndSessionChanged(this.prisma, projectId, {
      nextState,
      transcript,
      ts,
    })

    // Write live status fields to state so the frontend gets them via kind:'state' SSE.
    await writeLiveStatusState(this.prisma, projectId, response)

    // Resolve any pending optimistic action event based on the published status.
    const statusResolved: ('cancel' | 'confirm' | 'continue')[] = []
    if (response.status === 'completed') {
      statusResolved.push('confirm')
    }
    if (response.status === 'cancelled') {
      statusResolved.push('cancel')
    }
    if (response.phase === 'bootstrap_visual') {
      statusResolved.push('continue')
    }
    if (statusResolved.length) {
      await resolveActionEvents(this.prisma, projectId, statusResolved)
    }
  }

  /** Guard: session must be active (and optionally in a specific phase). Throws on violation. */
  async requireActiveSession(projectId: string, requiredPhase: null | string, operation: string) {
    const session = await this.loadSession(projectId, { phase: true, status: true })
    assertActiveSession({ phase: session.phase, status: session.status }, requiredPhase, operation)
    return session
  }

  async resolveDeadlineExpired(
    projectId: string,
    intent: 'confirm' | 'continue',
    force?: boolean,
  ): Promise<DeadlineExpiredDecision> {
    return resolveDeadlineExpiredFn(
      projectId,
      intent,
      {
        executeConfirmFastOrchestration: (id) => this._executeConfirmFastOrchestration(id),
        executeConfirmOrchestration: (id) => this._executeConfirmOrchestration(id),
        prisma: this.prisma,
        signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
      },
      force,
    )
  }

  selectModels(projectId: string, input: SelectUipModelsInput) {
    return selectUipModels(this, projectId, input)
  }

  async sendGuiUpdate(
    projectId: string,
    input: { transcript?: string; voice?: ProjectVoiceOverJson; voicePreviewSpeed?: number },
  ) {
    await this.assertUipAccess(projectId, 'write')
    // Refuse a voice that can't speak (a Gemini voice without its key) before anything is saved.
    if (input.voice) assertUipVoiceUsable(input.voice.voiceId)
    const session = await this.loadSession(projectId, {
      phase: true,
      status: true,
      state: true,
      stateVersion: true,
    })
    await sendGuiUpdateFn(projectId, input, session, {
      prisma: this.prisma,
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
    })

    if (input.voice) {
      assertActiveSession(session, 'script_review', 'update voice')
      const voiceOverJson = await parseVoiceOverJson(input.voice, this.prisma)
      await this.prisma.$transaction([
        this.prisma.uipSession.update({
          where: { projectId },
          data: { voiceId: voiceOverJson.voiceId },
        }),
        this.prisma.project.update({
          where: { id: projectId },
          data: {
            voiceOverJson: voiceOverJson as unknown as Prisma.InputJsonValue,
          },
        }),
      ])
    }
  }

  async sendMessage(
    projectId: string,
    message: string,
    uploadedAssets?: Array<{
      asset_id: string
      content_type: string
      file_name: string
      file_path: string
    }>,
    answerToMessageId?: string,
    clientId?: string,
    brandDraftEdits?: EditBrandBankBody[],
    sentFrom?: ActiveModalKind,
  ) {
    await this.assertUipAccess(projectId, 'write')
    // Flush pending GUI brand-brief draft edits with the message so
    // the planner activity applies them before reading brand_bank (honored
    // activity-side only during brand_review). Malformed entries are dropped.
    const brandDraftEditPayloads = brandDraftEdits
      ?.map((edit) => brandBankEditBodyToSignalPayload(edit))
      .filter((p): p is NonNullable<typeof p> => p !== null)
    return sendMessageFn(projectId, message, uploadedAssets, answerToMessageId, clientId, {
      brandDraftEdits:
        brandDraftEditPayloads && brandDraftEditPayloads.length > 0
          ? brandDraftEditPayloads
          : undefined,
      prisma: this.prisma,
      sentFrom,
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
    })
  }

  // Summary artifact edit channel: reuses the transcript gui-update
  // signal so an edit also resets the review-gate deadline. Gated active +
  // not-locked -- see sendSummaryUpdateFn for the lock rationale.
  async sendSummaryUpdate(
    projectId: string,
    input: { globalConstraints?: SummaryUpdateGlobalConstraints; requestId?: string },
  ) {
    await this.assertUipAccess(projectId, 'write')
    const session = await this.loadSession(projectId, {
      lockedAt: true,
      phase: true,
      status: true,
    })
    await sendSummaryUpdateFn(projectId, input, session, {
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
    })
  }

  // Mid-session auto-continue flip. Valid in any active phase: the
  // setting only matters at the timed gates, and flipping early simply changes
  // what happens when one is reached.
  async setAutoContinue(projectId: string, enabled: boolean) {
    await this.assertUipAccess(projectId, 'write')
    await this.requireActiveSession(projectId, null, 'setAutoContinue')
    await setAutoContinueFn(projectId, enabled, {
      prisma: this.prisma,
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
    })
  }

  /**
   * Signal a running UIP workflow. Handles common errors:
   * - WorkflowNotFoundError -> 400 "Session is completed"
   * - gRPC errors -> 503 "Service Unavailable"
   *
   * Does NOT auto-mark the session as failed on WorkflowNotFoundError: transient
   * causes (brief workflow-engine blips) would otherwise
   * flip a healthy session to `failed`. The scheduled-job sweep
   * (`uip-scheduled-job.service.ts`) handles cleanup safely after confirming
   * the workflow is genuinely gone.
   */
  async signalWorkflow(
    projectId: string,
    signalName: string,
    payload?: unknown,
    deadline?: number,
  ) {
    try {
      const workflowClient = await this.getWorkflowClient()
      const workflowId = this.resolveUipWorkflowId(projectId)
      const handle = workflowClient.workflow.getHandle(workflowId)

      const signal = () =>
        payload === undefined ? handle.signal(signalName) : handle.signal(signalName, payload)
      if (deadline === undefined) {
        await signal()
      } else {
        await workflowClient.connection.withDeadline(deadline, signal)
      }
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        throw new BadRequestException(`Session ${projectId} is completed or does not exist`)
      }
      // Connection errors (workflow service unavailable)
      if (err instanceof Error && err.message?.includes('UNAVAILABLE')) {
        throw new ServiceUnavailableException('Workflow service temporarily unavailable')
      }
      throw err
    }
  }

  //
  // PRIVATE HELPERS
  //

  async submitBrandBrief(
    projectId: string,
    body: {
      answerToMessageId?: string
      kind: 'freeform' | 'url'
      text?: string
      uploadedAssets?: Array<{
        asset_id: string
        content_type: string
        file_name: string
        file_path: string
        uploaded_at?: string
      }>
      url?: string
    },
  ): Promise<void> {
    return submitBrandBriefOp(this, projectId, body)
  }

  /**
   * Called by the run-planner-turn activity when it receives a wake signal.
   * Reads current state, selects the next pending action, and sends the authoritative
   * signal. Returns immediately after signal dispatch (fire-and-forget from
   * the activity's perspective). Guarantees serial execution: only one activity runs
   * at a time, so selectNextAction's optimistic lock prevents duplicate signals.
   */
  async triggerNextAction(projectId: string): Promise<void> {
    await triggerNextActionFn(projectId, {
      executeConfirmFastOrchestration: (id) => this._executeConfirmFastOrchestration(id),
      executeConfirmOrchestration: (id) => this._executeConfirmOrchestration(id),
      prisma: this.prisma,
      signalWorkflow: (id, signal, payload) => this.signalWorkflow(id, signal, payload),
    })
  }

  async updateImageModel(projectId: string, imageModel: null | string) {
    await this.assertUipAccess(projectId, 'write')
    await this.requireActiveSession(projectId, null, 'updateImageModel')
    // The requested model is not honored: the selection always resets to the
    // default (null). Re-check the continued marker and mirror the reset onto
    // both UipSession and Project in a single interactive transaction. Re-reading
    // continuedAt inside the txn closes the TOCTOU race where a continue could land
    // between an outside-the-txn check and the writes; the throw rolls back so
    // neither row is mutated. The selection locks at "Create video": the confirm
    // orchestration carries the persisted imageModel into the workflow (E7/E10).
    // The two mirrored writes also commit together so they never drift.
    await retryModelTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const session = await tx.uipSession.findUnique({
          where: { projectId },
          select: { continuedAt: true, status: true },
        })
        // Re-check liveness: a concurrent cancel/confirm can flip the session out
        // of active after the outer requireActiveSession but before this txn body.
        // session-not-found (undefined) also fails the check, which is safe.
        if (session?.status !== 'active') {
          throw new BadRequestException(`Cannot updateImageModel: session is ${session?.status}.`)
        }
        if (session?.continuedAt) {
          throw new BadRequestException('Cannot change the image model after the video is created')
        }
        await tx.uipSession.update({
          where: { projectId },
          data: { imageModel: null },
        })
        await tx.project.update({
          where: { id: projectId },
          data: { imageModel: null },
        })
      }),
    )
  }

  async updateScriptReview(
    projectId: string,
    input: { gateToken: string; globalConstraints?: Record<string, unknown>; script?: string },
  ) {
    await this.assertUipAccess(projectId, 'write')
    const session = await this.loadSession(projectId, {
      phase: true,
      status: true,
      state: true,
      stateVersion: true,
    })
    assertActiveSession(session, 'script_review', 'updateScriptReview')

    const sessionState = (session.state as null | UipSessionState) ?? {}

    // L3-b script lock: audio-mode sessions have an immutable script.
    if (input.script !== undefined) {
      validateScriptReviewInput(input.script, session.state as UipSessionState)
    }

    const isNewProtocol = supportsWorkflowProtocolFeature(
      sessionState.workflow_protocol_version,
      API_INBOX_WORKFLOW_PROTOCOL_SINCE,
    )

    const { requestId } = await appendGuiEditEvent(this.prisma, projectId, ['script_edit'])

    if (isNewProtocol) {
      await this.signalWorkflow(projectId, 'uip-gui-update', {
        requestId,
        transcript: input.script,
      })
    } else {
      const payload: ScriptReviewUpdateSignalPayload = {
        gateToken: input.gateToken,
        script: input.script,
        globalConstraints:
          input.globalConstraints as ScriptReviewUpdateSignalPayload['globalConstraints'],
        requestId,
      }
      await this.signalWorkflow(projectId, 'uip-script-review-update', payload)
    }
  }

  /**
   * Called by the frontend to update transcript editing state per client.
   * active=true: record editing_at=now for this clientId (renewed every 30s while editing).
   * active=false: remove this clientId's entry immediately (user left the editor).
   * Deadline expiry checks max(editing_at values) -- all clients must go stale to stop extension.
   */
  async updateTranscriptEditingState(
    projectId: string,
    active: boolean,
    clientId: string,
  ): Promise<null | StateChanges> {
    await this.assertUipAccess(projectId, 'write')
    await this.requireActiveSession(projectId, 'script_review', 'updateTranscriptEditingState')
    return updateTranscriptEditingStateWithLock({
      active,
      clientId,
      logger,
      prisma: this.prisma,
      projectId,
    })
  }

  async updateTransitionVideoModel(projectId: string, transitionVideoModel: null | string) {
    await this.assertUipAccess(projectId, 'write')
    await this.requireActiveSession(projectId, null, 'updateTransitionVideoModel')

    const trimmed =
      typeof transitionVideoModel === 'string' ? transitionVideoModel.trim() || null : null

    // Same no-clobber rule as create: `trimmed` is persisted verbatim.
    const normalizedTransitionVideoModel = trimmed

    await this.prisma.uipSession.update({
      where: { projectId },
      data: {
        transitionVideoModel: normalizedTransitionVideoModel,
      },
    })
    await this.signalWorkflow(projectId, UIP_INBOUND_SIGNALS.setTransitionVideoModel, {
      transitionVideoModel: normalizedTransitionVideoModel,
    })
  }

  async updateUserOperationHeartbeat(
    projectId: string,
    clientId: string,
  ): Promise<null | StateChanges> {
    await this.assertUipAccess(projectId, 'write')
    const changes = await writeOperateAtHeartbeat(this.prisma, projectId, clientId)
    if (changes === null) {
      return null
    }
    await this.signalWorkflow(projectId, UIP_INBOUND_SIGNALS.userActivity)
    return changes
  }

  private async _confirmPlanInternal(
    projectId: string,
    clientId?: string,
    userId?: string,
  ): Promise<'accepted' | 'duplicated' | 'rejected'> {
    const session = await this.loadSession(projectId, {
      state: true,
      status: true,
      phase: true,
      timeline: true,
      voiceId: true,
    })
    const wordCapOver = (session.state as null | UipSessionState)?.script_word_cap_exceeded === true
    if (this.checkActionAllowed(session, ['refinement']) === 'rejected' || wordCapOver) {
      return 'rejected'
    }
    assertUipVoiceUsable(session.voiceId)

    const confirmSessionState = (session.state ?? {}) as UipSessionState
    const isNewProtocol = supportsWorkflowProtocolFeature(
      confirmSessionState.workflow_protocol_version,
      API_INBOX_WORKFLOW_PROTOCOL_SINCE,
    )

    if (isNewProtocol) {
      // New protocol: set pending intent, wake the workflow.
      // triggerNextAction handles orchestration + uip-confirm signal + resolves the event.
      const intentResult = await setPendingActionIntent(this.prisma, projectId, 'confirm')
      if (intentResult !== 'rejected') {
        await this.signalWorkflow(projectId, 'uip-wake')
        // uipVideoStarted fires from triggerNextAction at actual start, not here at
        // intent-acceptance, so failed confirms no longer inflate the event.
      }
      return intentResult
    }

    // Old protocol: write action event, orchestrate, resolve, then signal directly.
    const confirmAppended = await appendActionEvent(this.prisma, projectId, 'confirm', clientId)
    if (confirmAppended !== 'accepted') {
      return confirmAppended
    }

    try {
      await this._executeConfirmOrchestration(projectId)
      await resolveActionEvents(this.prisma, projectId, ['confirm'])
    } catch (err) {
      await resolveActionEvents(this.prisma, projectId, []).catch((resolveErr) => {
        logger.warn(`[${projectId}] Failed to resolve action event: ${resolveErr}`)
      })
      throw err
    }

    await this.signalWorkflow(projectId, 'uip-confirm')
    logger.info(`[${projectId}] Confirm complete: spec locked, story-mode workflow started`)
    return 'accepted' as const
  }

  /**
   * Confirm-fast orchestration: write optional storage handoff artifacts, lock session,
   * start UipToStoryModeFastWorkflow (skips visual_script + anchor index pre-generation).
   */
  private async _executeConfirmFastOrchestration(projectId: string) {
    return executeConfirmFastOrchestration({
      projectId,
      prisma: this.prisma,
      getWorkflowClient: () => this.getWorkflowClient(),
      voiceOverService: this.voiceOverService,
    })
  }
  /**
   * Shared confirm orchestration: read spec, write storage, update Project, start story-mode.
   * Used by both manual confirm (+ signal UIP workflow) and auto-confirm (workflow exits itself).
   */
  private async _executeConfirmOrchestration(projectId: string): Promise<boolean> {
    return executeConfirmOrchestration({
      projectId,
      prisma: this.prisma,
      getWorkflowClient: () => this.getWorkflowClient(),
      voiceOverService: this.voiceOverService,
    })
  }
  private assertImageUploadDescriptors(files: UploadFileDescriptorDto[]): void {
    for (const file of files) {
      if (!file.contentType?.startsWith('image/')) {
        throw new BadRequestException(
          `Only image uploads are allowed. Unsupported contentType: ${file.contentType}`,
        )
      }
    }
  }

  /**
   * The cancel body, minus the request-scoped authorization check.
   *
   * Split out of `cancelSession` so an internal caller that has already
   * authorized the action can reuse it. `assertUipAccess` matches the request
   * context's org against the project's, so it can only ever succeed inside an
   * HTTP request -- a caller running off an event has no org to match and would
   * always be refused.
   *
   * `trigger` decides analytics only: `uipVideoCancelled` describes a user
   * pressing the cancel control, so a cancel the product initiates does not
   * fire it.
   */
  private async cancelActiveSession(params: {
    clientId?: string
    gateToken: string
    projectId: string
    trigger: 'project_deleted' | 'user'
    userId?: string
  }): Promise<'accepted' | 'duplicated' | 'rejected'> {
    const { clientId, gateToken, projectId, trigger } = params
    const session = await this.loadSession(projectId, {
      state: true,
      status: true,
      phase: true,
      timeline: true,
    })

    // Status-only guard. The phase guard was removed so operators (and
    // users) can cancel sessions stuck in mode_confirmation / bootstrap_*
    // -- previously those sessions had no cancel path through the API at
    // all, contributing to the stuck-workflow backlog. The
    // state-collision `rejected` returned by `appendActionEvent` further
    // down is preserved as-is: that one signals "another action is already
    // pending in the timeline" which is a soft idempotency case, not a
    // caller error.
    if (session.status !== 'active') {
      throw new BadRequestException(
        `Cannot cancel session: status is "${session.status}" (must be "active").`,
      )
    }

    const sessionState = (session.state ?? {}) as UipSessionState
    const isNewProtocol = supportsWorkflowProtocolFeature(
      sessionState.workflow_protocol_version,
      API_INBOX_WORKFLOW_PROTOCOL_SINCE,
    )

    if (isNewProtocol) {
      // New protocol: defer the cancel + signal dispatch to triggerNextAction
      // so activity retries handle failures atomically.
      const result = await setPendingActionIntent(this.prisma, projectId, 'cancel')
      if (result !== 'rejected') {
        await this.signalWorkflow(projectId, 'uip-wake')
        if (result === 'accepted') {
          logger.info(`[${projectId}] Cancel session intent set (trigger=${trigger})`)
        }
      }
      return result
    }

    const result = await appendActionEvent(this.prisma, projectId, 'cancel', clientId)
    if (result === 'accepted') {
      // The session continues at the script_review -> bootstrap_visual handoff
      // (continueUipDraft). Only clear the marker after the cancel is accepted -- a
      // rejected cancel means another action is still in flight. Best-effort.
      if ((PHASE_RANK[session.phase] ?? -1) >= PHASE_RANK['script_review']) {
        await clearSessionContinued(this.prisma, projectId)
      }
      await this.signalWorkflow(projectId, 'uip-cancel-session', { gateToken })
      logger.info(`[${projectId}] Cancel session signal sent (trigger=${trigger})`)
    }
    return result
  }
  private async getWorkflowClient(): Promise<Client> {
    if (!this.workflowClient) {
      this.workflowClient = await createClient()
    }
    return this.workflowClient
  }

  /**
   * Read `spec.meta.audio_source` from the current spec snapshot in storage.
   * Returns null when the spec file does not yet exist or the field is unset.
   */
  private async readAudioSourceFromSpec(projectId: string): Promise<null | string> {
    try {
      const file = fileStore.file(
        `projects/${projectId}/user-intent-planner/spec/current/spec.json`,
      )
      const exists = await file.exists()
      if (!exists) {
        return null
      }
      const buf = await file.read()
      const spec = JSON.parse(buf.toString()) as { meta?: { audio_source?: null | string } }
      return spec?.meta?.audio_source ?? null
    } catch (err) {
      logger.warn(`[${projectId}] Failed to read audio_source from spec: ${err}`)
      return null
    }
  }

  /**
   * Resolve the running UIP-session workflow id for a project. All sessions are
   * V2, so the id always carries the `:uip-v2` suffix.
   */
  private resolveUipWorkflowId(projectId: string): string {
    return getUipWorkflowId(projectId)
  }
}
