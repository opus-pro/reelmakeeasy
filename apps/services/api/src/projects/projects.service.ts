// Internal deps
import { Asset } from '@agent-lib/types/storyloader'
import { Prisma, ProjectLifecycleStatus } from '@reelmakeeasy/api-db'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { LOCAL_USER_EMAIL } from '@reelmakeeasy/common/auth/local-identity'
import { ProjectDeletedEvent } from '@reelmakeeasy/common/events/project.events'
import { KvStore } from '@reelmakeeasy/common/kv/store'
import { logger } from '@reelmakeeasy/common/logger'
import { getLongTakeStatusKey } from '@reelmakeeasy/common/long-take'
import { sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import {
  MUSIC_NOTE_MAX_LENGTH,
  MUSIC_TRACK_ID_MAX_LENGTH,
  sanitizeMusicSource,
} from '@reelmakeeasy/common/long-take/music-craft'
import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { pushOrgProjectEvent } from '@reelmakeeasy/common/sse/org-project-event'
import {
  filesBaseUrl,
  storeUriToUrl,
  toSavedAddress,
  toSavedAddresses,
  toSavedAddressesInText,
} from '@reelmakeeasy/common/storage/address'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
// External deps
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ProjectCreateRequestBody,
  ProjectForBackend,
  ProjectStage,
  ProjectVoiceOverJson,
} from '@shared/types/api/project'
import { AccessLevel } from '@shared/types/api/shared'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { DebugSettings } from '@shared/types/project/debug-settings'
import { z } from 'zod'

import { MediaService } from '../media/media.service'
import { PrismaService } from '../prisma/prisma.service'
import { SharedService } from '../shared/shared.service'
import { VideoScriptService } from '../video-script/video-script.service'

import { scanProjectAssets } from './scanner/scanProjectAssets'
import {
  AGENT_PROJECT_SUMMARY_SELECT,
  agentProjectFields,
  type AgentProjectSummaryRow,
  fillAgentFields,
} from './agent-project-fields'
import { downloadFileExists, videoNotRendered } from './download-file.util'
import { getProjectEnv } from './get-project-env'
import { applySearchTextSnapshot } from './project-search-text.util'
import { measureStorageOnFinish } from './project-storage.util'
import {
  getDefaultVoiceConfigFromDB,
  isProjectTerminalStage,
  markProjectsSeenUtil,
  parseVoiceOverJson,
  writePickedHookFileV2,
} from './projects-lifecycle.util'
import { listProjectsByOwnerQuery, listProjectsQuery } from './projects-list.util'
import {
  applyNoLipSyncDownloadVariant,
  buildFasterTtsSurveyMetadata,
  buildLongVideoSurveyMetadata,
  countProjectAttachmentAssets,
  enhancePrompt as enhancePromptUtil,
  generateProjectId,
  generateProjectName as generateProjectNameUtil,
  generateVideoDownloadUrl as generateVideoDownloadUrlUtil,
  getProjectMetadata as getProjectMetadataUtil,
  getProjectWithShareId as getProjectWithShareIdUtil,
  parseLongTakePromptRoute,
  parseScriptGeneratorPath,
  type ProjectMetadataResponse,
  recordProjectDownloadEvent,
  versionDownloadUrlByGeneration,
} from './projects-query.util'

// Re-export for backward compatibility
export { writePickedHookFile, writePickedHookFileV2 } from './projects-lifecycle.util'
export { normalizeProjectListItem, PROJECT_LIST_SELECT } from './projects-list.util'

async function resolveUipNotificationReviewMode(
  prisma: PrismaService,
  projectId: string,
): Promise<'auto' | 'manual'> {
  try {
    const session = await prisma.uipSession.findUnique({
      select: { state: true },
      where: { projectId },
    })
    const state = session?.state
    if (
      typeof state === 'object' &&
      state !== null &&
      'auto_continue_enabled' in state &&
      (state as { auto_continue_enabled?: boolean }).auto_continue_enabled === false
    ) {
      return 'manual'
    }
    return 'auto'
  } catch (error) {
    logger.warn(
      { error: ensureError(error), projectId },
      'Failed to resolve UIP notification mode; defaulting to auto',
    )
    return 'auto'
  }
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvStore,
    private readonly videoScriptService: VideoScriptService,
    private readonly mediaService: MediaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => SharedService))
    private readonly sharedService: SharedService,
  ) {}

  async acknowledgeEditorWarning(
    id: string,
    copyVersion: string,
  ): Promise<{ editorWarningAcknowledgedAt: string; editorWarningCopyVersion: string }> {
    if (!(await this.isProjectOwnedByRequester(id))) {
      throw new ForbiddenException(`Project with ID ${id} is not owned by the requester`)
    }
    if (typeof copyVersion !== 'string' || !copyVersion || copyVersion.length > 64) {
      throw new BadRequestException(
        'copyVersion must be a non-empty string of at most 64 characters',
      )
    }
    // Acknowledging the warning is not an edit, so carry the stored updatedAt through.
    const existing = await this.prisma.project.findFirst({
      select: { updatedAt: true },
      where: { id },
    })
    if (!existing) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }
    const editorWarningAcknowledgedAt = new Date()
    try {
      await this.prisma.project.update({
        data: {
          editorWarningAcknowledgedAt,
          editorWarningCopyVersion: copyVersion,
          updatedAt: existing.updatedAt,
        },
        where: { id },
      })
    } catch (e) {
      const err = e as { code?: string }
      if (err?.code === 'P2025') {
        throw new NotFoundException(`Project with ID ${id} not found`)
      }
      throw e
    }
    return {
      editorWarningAcknowledgedAt: editorWarningAcknowledgedAt.toISOString(),
      editorWarningCopyVersion: copyVersion,
    }
  }

  /**
   * Read-only "can the caller VIEW this project" check. A strict superset of
   * `canVisitProject`: everything a visitor may do, PLUS the public allowance
   * that any visitor may view a Story Mode / long-take project. This mirrors
   * `resolveProjectAccess` in projects.controller.ts (`if (candidate.isLongTake)
   * return candidate`), so the read path and view-gated server-side reads agree
   * on exactly the public-long-take row.
   *
   * Use this ONLY for read-only / carry-over decisions (e.g. remix carry). Do
   * NOT use it -- and do NOT add the public allowance to `canVisitProject` --
   * for mutating or sensitive ops (cancelVideoExport, abortAgent, chat-history
   * read, video regen/cancel); widening that gate would be a security
   * regression. Cloned-voice exposure is handled separately by the read-time
   * sanitizer and the submit-time owned-clone guard, so a wider view gate does
   * not leak a creator's cloned voice.
   */
  async canViewProject(projectId: string, shareId?: string) {
    if (await this.canVisitProject(projectId, shareId)) {
      return true
    }
    // Public read allowance: any visitor may view (and therefore remix from) a
    // public long-take project. A demo id has no Project row, so this stays
    // false and the demo snapshot path is preserved.
    const project = await this.getProject(projectId)
    return Boolean(project?.isLongTake)
  }

  async canVisitProject(projectId: string, shareId?: string) {
    const project = await this.getProject(projectId)
    if (!project) {
      return false
    }

    const reqCtx = getReqContext()
    if (project.owner === reqCtx.login_id || (project.orgId && reqCtx.org_id === project.orgId)) {
      return true
    }
    if (shareId) {
      const shareItem = await this.prisma.projectShared.findUnique({
        where: { sharedProjectId: shareId },
      })
      if (shareItem?.projectId === projectId) {
        return true
      }
    }

    return false
  }

  /** The agent chat that made projects is gone: forget it. Their Agent tag stays. */
  async clearAgentSession(sessionId: string): Promise<void> {
    await this.prisma.project.updateMany({
      data: { agentSessionId: null },
      where: { agentSessionId: sessionId },
    })
  }

  async createProject(
    body: ProjectCreateRequestBody,
    options?: {
      // Agent mode: the chat that made this project (marks it createdVia 'agent').
      agentSessionId?: string
      isUip?: boolean
      // Create with a caller-chosen id instead of a fresh one. Used by the MCP
      // prepare/start split: the id is minted at prepare and the real Project is
      // created here at start, so prepare and start agree on one stable id.
      projectId?: string
      rerunFrom?: string
      stage?: string
    },
  ): Promise<ProjectForBackend> {
    // AI UGC retirement: only Story Mode projects can be created.
    // Applies to reruns of legacy UGC projects too; their read paths stay open.
    // First check in the method so a rejected request triggers no side effects.
    // Warn-logged so residual traffic on the retired path is measurable to zero.
    // Strict !== true: the body is unvalidated, so a truthy non-boolean (e.g.
    // the string "false") must not slip past and get persisted as Story Mode.
    if (body.isLongTake !== true) {
      logger.warn('ugc_retired: non-story-mode project creation rejected')
      throw new ForbiddenException('ugc_creation_retired')
    }

    const reqContext = getReqContext()
    const owner = reqContext.login_id
    const ownerEmail = LOCAL_USER_EMAIL

    const {
      initialText,
      voice,
      style,
      styleText,
      styleName,
      styleThumbnailUrl,
      avatarId,
      cameraStyle,
      debugSettings,
      enableCaption,
      hookTemplateName,
      longTakeInput,
      longTakeRatio,
    } = body
    const isLongTake = Boolean(body.isLongTake)

    // Validate storyboard settings if present
    if (debugSettings?.storyboard) {
      const { fixedTemplate, genAI } = debugSettings.storyboard
      const enableFixedTemplate = fixedTemplate ?? true
      const enableGenAI = genAI ?? false

      if (!enableFixedTemplate && !enableGenAI) {
        throw new BadRequestException(
          'At least one storyboard generation plan must be enabled. Please enable fixedTemplate or genAI.',
        )
      }
    }
    // An upload's tag in the text keeps its address, never a URL with a host or port.
    const initText = toSavedAddressesInText(initialText ?? '')
    const normalizedStyleText = styleText?.trim() || undefined
    const normalizedStyleName = styleName?.trim() || undefined
    // Saved as an address (store:// or preset://), never a URL with a host or port.
    const normalizedStyleThumbnailUrl = toSavedAddress(styleThumbnailUrl?.trim()) || undefined
    // Generate a unique project ID (or use the caller-supplied one; see options).
    const projectId = options?.projectId ?? generateProjectId()
    const createTime = Date.now()

    const generatedName = await this.generateProjectName(initText)
    let shortName = generatedName
    if (!initText.trim() && isLongTake && longTakeInput === 'audio') {
      shortName = 'Audio Project'
    }

    const project = await this.prisma.project.create({
      data: {
        id: projectId,
        initPrompt: initText,
        name: shortName,
        owner,
        ownerEmail,
        stage: (options?.stage ?? PROJECT_STAGE.INITIALIZING) as ProjectStage,
        voiceOverJson: await parseVoiceOverJson(voice || null, this.prisma),
        env: getProjectEnv(),
        style,
        styleText: normalizedStyleText,
        // Fields added to Prisma schema; types available after next `prisma generate`.
        ...((normalizedStyleName ? { styleName: normalizedStyleName } : {}) as Record<
          string,
          unknown
        >),
        ...((normalizedStyleThumbnailUrl
          ? { styleThumbnailUrl: normalizedStyleThumbnailUrl }
          : {}) as Record<string, unknown>),
        // Story Mode project type chosen at creation; spread + cast like styleName
        // until the next `prisma generate` picks up the new column.
        ...((body.createUseCase ? { createUseCase: body.createUseCase } : {}) as Record<
          string,
          unknown
        >),
        avatarId,
        hookTemplateName,
        debugSettings: body.debugSettings,
        isLongTake,
        isUip: options?.isUip ?? undefined,
        // Agent mode only, from the server-side option: never from the request body.
        ...agentProjectFields(options?.agentSessionId),
        longTakeInput,
        longTakeRatio,
        modelSelectorTier: parseModelSelectorAnalyticsTier(body.modelSelectorTier),
        modelSwitch: body.debugSettings?.llm,
        enableCaption: enableCaption ?? false,
        ...(cameraStyle === undefined ? {} : { cameraStyle: sanitizeCameraStyle(cameraStyle) }),
        // Story-mode BGM toggle: persist only when the request carries
        // it (gated FE clients). When absent, write nothing so the Prisma
        // @default(false) applies and ungated creates are unchanged.
        ...(body.bgmEnabled === undefined ? {} : { bgmEnabled: body.bgmEnabled }),
        // The music wish: one trimmed line, capped, so a raw client cannot stuff the prompt.
        ...(body.bgmNote === undefined
          ? {}
          : {
              bgmNote:
                body.bgmNote.replace(/\s+/g, ' ').trim().slice(0, MUSIC_NOTE_MAX_LENGTH) || null,
            }),
        // Where the bed comes from and which track: unknown values read as none.
        ...(body.bgmSource === undefined ? {} : { bgmSource: sanitizeMusicSource(body.bgmSource) }),
        ...(body.bgmTrackId === undefined
          ? {}
          : {
              bgmTrackId:
                String(body.bgmTrackId ?? '')
                  .trim()
                  .slice(0, MUSIC_TRACK_ID_MAX_LENGTH) || null,
            }),
        createdAt: new Date(createTime),
        projectTier: body.projectTier || 'PRO',
        rerunFrom: options?.rerunFrom,
        orgId: reqContext.org_id,
        userId: reqContext.user_id,
        lastSeenAt: null,
        // Projects never expire: the lifecycle anchor stays null.
        lifecycleStatus: ProjectLifecycleStatus.ACTIVE,
        expiresAt: null,
        expiryPlanTier: null,
      },
    })

    pushOrgProjectEvent(project.orgId, {
      resource: 'project',
      action: 'created',
      projectId: project.id,
      stage: (options?.stage ?? PROJECT_STAGE.INITIALIZING) as string,
    })
    logger.info(`project.created:${projectId}`)

    // Auto-create share link with public access for S2V projects
    try {
      const sharedProjectId = this.sharedService.generateSharedProjectId()
      await this.prisma.projectShared.create({
        data: {
          projectId: project.id,
          sharedProjectId,
          owner: project.owner || owner,
          accessLevel: AccessLevel.PUBLIC, // Default to public
        },
      })
      logger.info(`Auto-created public share link for project ${projectId}`)
    } catch (shareError) {
      logger.error(
        { error: ensureError(shareError), projectId },
        'Failed to auto-create share link for project',
      )
      // Don't throw - project creation was successful, share creation is secondary
    }

    return project as unknown as ProjectForBackend
  }

  async deleteProject(id: string, user: UserInfo): Promise<ProjectForBackend> {
    const project = await this.getProjectAsOwner(id, user.orgId)
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }
    // Check if project is already deleted
    if (project.isDeleted) {
      throw new BadRequestException(`Project with ID ${id} is already deleted`)
    }

    const updatedProject = await this.prisma.project.update({
      data: {
        hardDeleteAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        isDeleted: true,
      } as Prisma.ProjectUpdateInput,
      where: { id },
    })

    this.eventEmitter.emit('project.deleted', new ProjectDeletedEvent(id, user.sub, user.email))

    pushOrgProjectEvent(updatedProject.orgId, {
      resource: 'project',
      action: 'deleted',
      projectId: id,
    })
    logger.info(`Project deleted (soft): ${id} by user ${user.sub}`)

    return updatedProject as unknown as ProjectForBackend
  }

  /**
   * Enhance user prompt using LLM
   */
  async enhancePrompt(userPrompt: string): Promise<string> {
    return enhancePromptUtil(userPrompt)
  }

  /** Fills `createdVia` / `agentSessionId` on agent projects made before they existed. */
  async fillAgentFields(input: {
    agentProjectIds: string[]
    sessionByProject: Map<string, string>
  }): Promise<number> {
    return fillAgentFields(this.prisma, input)
  }

  async generateProjectName(text?: null | string, useLLM?: boolean): Promise<string> {
    return generateProjectNameUtil(text, useLLM)
  }

  async generateVideoDownloadUrl(
    projectId: string,
    watermark: boolean,
    lipSync?: boolean,
    userId?: null | string,
  ): Promise<{ filename: string; url: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        orgId: true,
        resultVideo: true,
        watermarkVideo: true,
      },
    })
    if (!project) {
      throw new NotFoundException('Project not found')
    }
    const downloadProject =
      lipSync === false ? await applyNoLipSyncDownloadVariant(projectId, project) : project
    const { filename, url } = generateVideoDownloadUrlUtil(downloadProject, projectId, watermark)
    if (!(await downloadFileExists(url))) {
      throw videoNotRendered()
    }
    // The project keeps the video's address: the link is its served URL.
    const servedUrl = storeUriToUrl(url)
    const result = {
      filename,
      url: withDownloadName(await versionDownloadUrlByGeneration(servedUrl), filename),
    }
    await recordProjectDownloadEvent(this.prisma, projectId, userId || null, watermark)
    return result
  }

  async getDefaultVoice(): Promise<ProjectVoiceOverJson> {
    return getDefaultVoiceConfigFromDB(this.prisma)
  }

  async getProject(id: string): Promise<null | ProjectForBackend> {
    return this.prisma.project.findUnique({
      where: { id },
    }) as unknown as ProjectForBackend
  }

  async getProjectAsOwner(id: string, orgId: string): Promise<null | ProjectForBackend> {
    return this.prisma.project.findUnique({
      where: { id, orgId },
    }) as unknown as ProjectForBackend
  }

  async getProjectAssets(projectId: string): Promise<Asset[]> {
    // Check if project exists
    const project = await this.getProject(projectId)
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`)
    }
    return scanProjectAssets(projectId)
  }

  /**
   * Get project metadata for survey tracking
   * Returns shot type statistics, niche/use case information, and anchor asset counts
   */
  async getProjectMetadata(projectId: string): Promise<ProjectMetadataResponse> {
    const base = await getProjectMetadataUtil(projectId, this.prisma)

    try {
      const [attachments, longTakeStatus, project] = await Promise.all([
        this.mediaService.getAttachments(projectId),
        this.kv.getObject<{ meta?: Record<string, number | string> }>(
          getLongTakeStatusKey(projectId),
        ),
        this.prisma.project.findUnique({
          where: { id: projectId },
          select: { debugSettings: true, longTakeRatio: true },
        }),
      ])
      const { numActorAsset, numLogoAsset, numObjectAsset } =
        countProjectAttachmentAssets(attachments)
      const meta = longTakeStatus?.meta
      // Normalize the persisted count once; treat null/undefined/malformed as "unknown"
      // (undefined) rather than letting NaN leak into the response.
      const parsedAssetLibraryTransitionsCount =
        meta?.assetLibraryTransitionsCount == null
          ? undefined
          : Number(meta.assetLibraryTransitionsCount)
      const assetLibraryTransitionsCount = Number.isFinite(parsedAssetLibraryTransitionsCount)
        ? parsedAssetLibraryTransitionsCount
        : undefined
      return {
        ...base,
        ...buildFasterTtsSurveyMetadata(meta),
        ...buildLongVideoSurveyMetadata(meta, project?.longTakeRatio),
        numAssets: numActorAsset + numLogoAsset + numObjectAsset,
        numActorAsset,
        numActorAssetsGenerated:
          meta?.numActorAssetsGenerated == null ? undefined : Number(meta.numActorAssetsGenerated),
        numAssetsGenerated:
          meta?.numAssetsGenerated == null ? undefined : Number(meta.numAssetsGenerated),
        numLogoAsset,
        numLogoAssetsGenerated:
          meta?.numLogoAssetsGenerated == null ? undefined : Number(meta.numLogoAssetsGenerated),
        numObjectAsset,
        numObjectAssetsGenerated:
          meta?.numObjectAssetsGenerated == null
            ? undefined
            : Number(meta.numObjectAssetsGenerated),
        promptRoute: parseLongTakePromptRoute(meta?.promptRoute),
        scriptGeneratorPath: parseScriptGeneratorPath(meta?.scriptGeneratorPath),
        keyframeImageModel: (project?.debugSettings as DebugSettings)?.keyframeImageModel,
        // Prefer the actually-used model persisted at completion; fall back to the debug
        // override. The Seedance 2.0 rollout picks the model server-side, so debugSettings is
        // empty for normal users --
        transitionVideoModel:
          meta?.transitionVideoModel == null
            ? (project?.debugSettings as DebugSettings)?.transitionVideoModel
            : String(meta.transitionVideoModel),
        assetLibraryTransitionsCount,
        assetLibraryEnabled:
          assetLibraryTransitionsCount == null ? undefined : assetLibraryTransitionsCount > 0,
      }
    } catch (error) {
      logger.warn(
        { error: ensureError(error), projectId },
        'Failed to count anchor assets for project metadata',
      )
      return base
    }
  }

  async getProjectStage(id: string): Promise<null | ProjectStage> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { stage: true },
    })
    return (project?.stage as ProjectStage | undefined) || null
  }

  /** Name, stage and thumbnails of these projects, in one query (the agent chat list). */
  async getProjectSummaries(ids: string[]): Promise<AgentProjectSummaryRow[]> {
    if (!ids.length) return []
    return this.prisma.project.findMany({
      select: AGENT_PROJECT_SUMMARY_SELECT,
      where: { id: { in: ids } },
    }) as Promise<AgentProjectSummaryRow[]>
  }

  async getProjectVideoScript(id: string): Promise<VideoScript> {
    const canVisit = await this.canVisitProject(id)
    if (!canVisit) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }
    return this.videoScriptService.getVideoScript(id)
  }

  async getProjectWithShareId(
    projectId: string,
    shareId: string,
  ): Promise<null | ProjectForBackend> {
    return getProjectWithShareIdUtil(this.prisma, projectId, shareId)
  }

  async internalUpdateProject(
    id: string,
    data: Partial<ProjectForBackend>,
    userId: string,
    orgId?: string,
  ) {
    // Saved as addresses: a served URL a caller passes (with its host and port) is not kept.
    const normalizedData: Partial<ProjectForBackend> = { ...toSavedAddresses(data) }
    if (data.stage && !isProjectTerminalStage(data.stage)) {
      normalizedData.lastSeenAt = null
    }

    // A patch carrying bgmVersions is the BGM regen completion persist -- only
    // the regenerate path assembles the history array. Re-flag the
    // project unseen so the finished-projects badge and seen-state machinery
    // resurface it.
    const isBgmRegenCompletion = data.bgmVersions !== undefined
    if (isBgmRegenCompletion) {
      normalizedData.lastSeenAt = null
    }

    // Write-once searchText snapshot on first FINISHED, persisted
    // separately with an unset-only guard so concurrent updates cannot race.
    await applySearchTextSnapshot(this.prisma, id, data)

    // PII / payload hygiene: strip from the tracking payload: ownerEmail
    // (PII), searchText (raw script content), the BGM free-text prompt +
    // unbounded regen-history array, and the bgmRun lifecycle blob
    // (ao.bgm.* events already cover the funnel). The small BGM
    // scalars (bgmEnabled/bgmVolume/bgmModel/...) stay, useful product signal.
    const {
      bgmPrompt: _bgmPrompt,
      bgmRun: _bgmRun,
      bgmVersions: _bgmVersions,
      ownerEmail: _ownerEmail,
      searchText: _searchText,
      ...trackData
    } = normalizedData
    // The regen workflow's failure-clear patch arrives as JSON null,
    // which this MongoDB client takes as-is (`bgmRun?: InputJsonValue | null`).
    // The DbNull/JsonNull sentinels are a relational-connector concern.
    const result = await this.prisma.project.update({
      data: normalizedData as unknown as Prisma.ProjectUpdateInput,
      where: { id },
    })

    // Best-effort, non-blocking storage measurement on finish.
    measureStorageOnFinish(this.prisma, id, normalizedData)

    // Push SSE notification on stage change
    if (data.stage) {
      const resolvedOrgId = orgId || result.orgId
      if (resolvedOrgId) {
        pushOrgProjectEvent(resolvedOrgId, {
          resource: 'project',
          action: 'stage-changed',
          projectId: id,
          stage: data.stage,
        })
      }
    }

    if (data.stage === 'FINISHED' && result.resultVideo && result.isUip) {
      const reviewMode = await resolveUipNotificationReviewMode(this.prisma, id)
      pushOrgProjectEvent(orgId || result.orgId, {
        action: 'processing-update',
        deadlineAt: null,
        dedupeKey: `${id}:uip-video:finished`,
        outcome: 'completed',
        ownerLoginId: result.owner ?? null,
        processingType: 'uip-video',
        projectId: id,
        projectTitle: result.name ?? null,
        resource: 'project',
        reviewMode,
        uipSessionId: id,
      })
    }

    // Push a processing notification on BGM regen completion.
    // Failure emission is intentionally absent here: failed runs never reach
    // this persist path and are still surfaced by the bgm-settings poll.
    if (isBgmRegenCompletion) {
      const resolvedOrgId = orgId || result.orgId
      if (resolvedOrgId) {
        pushOrgProjectEvent(resolvedOrgId, {
          action: 'processing-update',
          // bgmVersions is append-only, so its length is stable per run.
          dedupeKey: `${id}:bgm-regen:${data.bgmVersions?.length ?? 0}`,
          outcome: 'completed',
          ownerLoginId: result.owner ?? null,
          processingType: 'bgm-regen',
          projectId: id,
          projectTitle: result.name ?? null,
          resource: 'project',
        })
      }
    }

    return result
  }

  /**
   * Strict ownership for the requester: theirs (JWT login id) or their org's.
   * Unlike canVisitProject this never passes for share links or public
   * long-takes, and never throws -- a pure predicate. Missing project (incl. demos, which have no
   * Project row) -> false. Remix uses it to decide "the user's own".
   */
  async isProjectOwnedByRequester(projectId: string): Promise<boolean> {
    const project = await this.getProject(projectId)
    if (!project) {
      return false
    }
    const reqCtx = getReqContext()
    if (!reqCtx.login_id) {
      return false
    }
    return (
      project.owner === reqCtx.login_id || Boolean(project.orgId && reqCtx.org_id === project.orgId)
    )
  }

  async listProjects(
    options?: Parameters<typeof listProjectsQuery>[1],
  ): Promise<{ data: ProjectForBackend[]; total: number }> {
    return listProjectsQuery({ prisma: this.prisma as never }, options)
  }

  async listProjectsByOwner(
    options: NonNullable<Parameters<typeof listProjectsByOwnerQuery>[1]> = {},
  ): Promise<{ data: ProjectForBackend[]; total: number }> {
    return listProjectsByOwnerQuery({ prisma: this.prisma as never }, options)
  }

  /**
   * Acknowledge finished background jobs on this project -- the card
   * status pill's done state renders only while a run's settledAt is newer
   * than this stamp. User-owned column set on project OPEN; workflow writes
   * never touch it, so it cannot race a concurrent run start. Deliberately NOT
   * the mark-seen pipeline above: lastSeenAt is stamped on list RENDER, which
   * would clear the pill before the user ever saw it.
   */
  async markProcessingSeen(
    id: string,
    orgId: null | string | undefined,
  ): Promise<{ processingSeenAt: string }> {
    if (!orgId) {
      throw new UnauthorizedException('User not authenticated')
    }
    const processingSeenAt = new Date()
    // Opening a project is not editing it: `updatedAt` is an @updatedAt column
    // that the list sort and the admin "Finished in" metric both read, so carry
    // the stored value through rather than let Prisma advance it. Read-then-write
    // is not atomic: a concurrent workflow patch landing in between has its fresh
    // updatedAt rolled back to the value read here, which is harmless (the column
    // under-reports by one write) and bounded by a single round trip.
    const existing = await this.prisma.project.findFirst({
      select: { updatedAt: true },
      where: { id, orgId },
    })
    if (!existing) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }
    try {
      await this.prisma.project.update({
        data: { processingSeenAt, updatedAt: existing.updatedAt },
        where: { id, orgId },
      })
    } catch (e) {
      const err = e as { code?: string }
      if (err?.code === 'P2025') {
        throw new NotFoundException(`Project with ID ${id} not found`)
      }
      throw e
    }
    return { processingSeenAt: processingSeenAt.toISOString() }
  }

  async markProjectsSeen(
    ids: string[],
    orgId: null | string | undefined,
  ): Promise<{ changedCount: number; skippedCount: number }> {
    return markProjectsSeenUtil({ prisma: this.prisma as never }, ids, orgId)
  }

  async renameProject(id: string, orgId: string, name: string): Promise<ProjectForBackend> {
    if (name == null) {
      throw new BadRequestException('Project name cannot be empty')
    }
    const trimmed = name.trim()
    if (!trimmed) {
      throw new BadRequestException('Project name cannot be empty')
    }
    if (trimmed.length > 100) {
      throw new BadRequestException('Project name cannot exceed 100 characters')
    }

    let project
    try {
      project = await this.prisma.project.update({
        data: { name: trimmed, isCustomName: true },
        where: { id, orgId },
      })
    } catch (e) {
      const err = e as { code?: string }
      if (err?.code === 'P2025') {
        throw new NotFoundException(`Project with ID ${id} not found`)
      }
      throw e
    }

    return project as unknown as ProjectForBackend
  }

  async setDefaultVoice(voiceConfig: ProjectVoiceOverJson) {
    try {
      await this.prisma.systemConfig.upsert({
        create: { key: 'default_voice', value: voiceConfig },
        update: { value: voiceConfig },
        where: { key: 'default_voice' },
      })
      logger.info('Default voice configuration updated')
      return { success: true, voiceConfig }
    } catch (error) {
      logger.error({ error: ensureError(error) }, 'Failed to set default voice')
      throw error
    }
  }

  // Persist the caption on/off flag onto an already-materialized project. The MCP
  // prepare/start split can edit enable_captions AFTER a failed start already
  // created the Project; startWorkflow renders from Project.enableCaption (see
  // resolveProjectWorkflowFlags), so the edited value must be written back before a
  // retry re-renders, else the retry keeps the stale first-attempt setting.
  async updateEnableCaption(projectId: string, enableCaption: boolean): Promise<void> {
    await this.prisma.project.update({
      data: { enableCaption },
      where: { id: projectId },
    })
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async updateProject(
    id: string,
    orgId: string,
    body: ProjectCreateRequestBody,
  ): Promise<ProjectForBackend> {
    // B2: no edit (prompt / voice / script / hook) of a locked project. Loaded as owner (by
    // { id, orgId }); a miss exits early (never falls through to an unscoped read), so neither lock
    // state nor project data leaks to a caller from another org. Rename (PUT :id/name) and delete
    // are separate endpoints and intentionally stay open.
    const current = await this.getProjectAsOwner(id, orgId)
    if (!current) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }
    const { hookId, hookTemplateName, initialText, script, voice } = body

    const updateData: Partial<ProjectForBackend> = {}

    if (initialText !== undefined && initialText !== null) {
      updateData.initPrompt = toSavedAddressesInText(initialText)
      const existing = await this.prisma.project.findUnique({
        where: { id, orgId },
        select: { isCustomName: true },
      })
      if (!existing?.isCustomName) {
        updateData.name = await this.generateProjectName(initialText)
      }
    }

    if (voice !== undefined && voice !== null) {
      updateData.voiceOverJson = await parseVoiceOverJson(voice, this.prisma)
    }

    if (script !== undefined && script !== null) {
      updateData.script = toSavedAddressesInText(script)
    }

    if (hookId !== undefined && hookId !== null) {
      updateData.hookId = hookId
    }

    if (hookTemplateName !== undefined && hookTemplateName !== null) {
      updateData.hookTemplateName = hookTemplateName
    }

    if (Object.keys(updateData).length === 0) {
      return current // no-op update -> return the owner-scoped project already loaded above
    }

    const DebugSettingsSchema = z.unknown().refine(
      (v) => {
        try {
          JSON.stringify(v)
          return true
        } catch {
          return false
        }
      },
      { message: 'debugSettings must be JSON-serializable' },
    )

    const { debugSettings: rawDebugSettings, ...restUpdateData } = updateData
    const ds =
      rawDebugSettings === undefined ? undefined : DebugSettingsSchema.parse(rawDebugSettings)

    const project = await this.prisma.project.update({
      data: {
        ...restUpdateData,
        ...(ds !== undefined && { debugSettings: { set: ds as Prisma.InputJsonValue } }),
      } satisfies Prisma.ProjectUpdateInput,
      where: { id, orgId },
    })

    if (script !== undefined && script !== null) {
      try {
        // V2: Use createStorage (writes to storage)
        logger.info(`Writing script to storage for project ${id}`)
        const storage = await createStorage(id)
        await storage.writeFile(STORY_LOADER_PATHS.scriptTxtPath, toSavedAddressesInText(script))
        logger.info(`Successfully updated script.txt for project ${id}`)
      } catch (error) {
        logger.error(
          {
            err: ensureError(error),
            projectId: id,
          },
          'Failed to update script.txt',
        )
      }
    }

    if (hookId !== undefined && hookId !== null) {
      await writePickedHookFileV2(id, hookId)
    }
    // PII cleanup: strip ownerEmail (PII field on ProjectForBackend) before tracking.
    const { ownerEmail: _ownerEmail, ...trackUpdateData } = updateData
    return project as unknown as ProjectForBackend
  }
}

/** Local file URLs download under `filename` (see FilesController); others pass through. */
function withDownloadName(url: string, filename: string): string {
  if (!url.startsWith(`${filesBaseUrl()}/`)) {
    return url
  }
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(filename)}`
}
