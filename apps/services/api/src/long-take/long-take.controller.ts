import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Put,
  Sse,
  UnauthorizedException,
} from '@nestjs/common'
import { Logger } from '@reelmakeeasy/common/logger'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import {
  MUSIC_TRACK_ID_MAX_LENGTH,
  sanitizeMusicSource,
} from '@reelmakeeasy/common/long-take/music-craft'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import type { ReimagineModelSelectorTier } from '@reelmakeeasy/common/model-config/reimagine-model-tier'
import { toSavedAddressesInText } from '@reelmakeeasy/common/storage/address'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import type {
  LongTakeBgmSettingsReadResponse,
  LongTakeBgmSettingsRequest,
  LongTakeBgmSettingsResponse,
  LongTakeBgmVersionApplyResponse,
  LongTakeBgmVersionCreateRequest,
  LongTakeBgmVersionCreateResponse,
  LongTakeBgmVersionRenameRequest,
  LongTakeBgmVersionRenameResponse,
  LongTakeBgmVersionsResponse,
  LongTakeCaptionSettingsRequest,
  LongTakeCaptionSettingsResponse,
  LongTakeEditorDraftResponse,
  LongTakeEditorStateResponse,
  LongTakeRenderRequest,
  LongTakeScriptGeneratorPath,
  LongTakeScriptPreviewResponse,
  LongTakeStatusResponse,
  SaveLongTakeEditorDraftRequest,
} from '@shared/types/api/long-take'
import { DebugSettings } from '@shared/types/project/debug-settings'
import { Observable } from 'rxjs'

import { ProjectService } from '../projects/projects.service'

import { LongTakeService } from './long-take.service'
import { getEditorDraftForProject, saveEditorDraftForProject } from './long-take-editor-draft.util'
import { buildLongTakeRequestUser } from './long-take-helpers.util'
import { parseReimagineModelSelectorTier } from './long-take-reimagine-tier.util'

@Controller('long-take-videos')
export class LongTakeController {
  private readonly logger = new Logger(LongTakeController.name)

  constructor(
    private readonly longTakeService: LongTakeService,
    private readonly projectsService: ProjectService,
  ) {}

  // Switch the project to one of its existing beds and rebake the delivered
  // video at it. Free -- nothing is generated -- but eligible plans
  // only, like a volume edit. 404 when the id is not one of this project's
  // versions.
  @Post(':projectId/bgm-versions/:versionId/apply')
  async applyBgmVersion(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ): Promise<LongTakeBgmVersionApplyResponse> {
    if (!projectId || !versionId) {
      throw new BadRequestException('projectId and versionId are required')
    }
    return {
      data: await this.longTakeService.applyBgmVersion(projectId, versionId, {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo),
    }
  }

  @Post(':projectId/cancel')
  async cancelWorkflow(
    @Param('projectId') projectId: string,
    @Body() body: { workflowId: string },
  ): Promise<{ workflowId: string }> {
    if (!projectId || !body.workflowId) {
      throw new BadRequestException('projectId and workflowId are required')
    }
    return this.longTakeService.cancelWorkflow(projectId, body.workflowId)
  }

  // Regenerate the bed = create a new BGM version (a POST onto the video's
  // bgmVersions history); 409 when a regeneration is already in flight.
  @Post(':projectId/bgm-versions')
  async createBgmVersion(
    @Param('projectId') projectId: string,
    @Body() body: LongTakeBgmVersionCreateRequest,
  ): Promise<LongTakeBgmVersionCreateResponse> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return {
      data: await this.longTakeService.createBgmVersion(projectId, body, {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo),
    }
  }

  // Owner-only (unlike the share-readable status): surfaces bgmPrompt for the
  // panel's editable regenerate box.
  @Get(':projectId/bgm-settings')
  async getBgmSettings(
    @Param('projectId') projectId: string,
  ): Promise<LongTakeBgmSettingsReadResponse> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return { data: await this.longTakeService.getBgmSettings(projectId) }
  }

  // The switchable beds for the music panel's back/forward arrows.
  // Owner-gated like bgm-settings: an entry carries the owner's Lyria prompt.
  @Get(':projectId/bgm-versions')
  async getBgmVersions(
    @Param('projectId') projectId: string,
  ): Promise<LongTakeBgmVersionsResponse> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return { data: await this.longTakeService.getBgmVersions(projectId) }
  }

  @Get(':projectId/editor-draft')
  async getEditorDraft(
    @Param('projectId') projectId: string,
  ): Promise<LongTakeEditorDraftResponse> {
    if (!projectId) {
      throw new BadRequestException('Invalid story mode editor draft request')
    }
    return { data: await getEditorDraftForProject(this.projectsService, projectId) }
  }

  // Whether a failed/cancelled long-take can be regenerated from its reused
  // artifacts (cheap) or the Retry entry must fall back to a full remix.
  @Get(':projectId/retry-eligibility')
  async getRetryEligibility(
    @Param('projectId') projectId: string,
  ): Promise<{ canRegenerate: boolean }> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return this.longTakeService.getLongTakeRetryEligibility(projectId)
  }

  @Get(':videoId/state')
  async getState(@Param('videoId') videoId: string): Promise<LongTakeEditorStateResponse> {
    if (!videoId) {
      throw new BadRequestException('Invalid story mode state request')
    }
    return this.longTakeService.getStateWithUnrenderedChanges(videoId)
  }

  @Get(':videoId')
  async getStatus(@Param('videoId') videoId: string): Promise<LongTakeStatusResponse> {
    if (!videoId) {
      throw new BadRequestException('Invalid story mode status request')
    }
    return { data: await this.longTakeService.getStatus(videoId) }
  }

  @Get(':projectId/transcript')
  async getTranscript(@Param('projectId') projectId: string) {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return this.longTakeService.getTranscript(projectId)
  }

  @Post('audio-script-preview')
  async previewAudioScript(
    @Body()
    body: {
      audioUri: string
    },
  ): Promise<{ script: string }> {
    return this.longTakeService.generateAudioScriptPreview({
      audioUri: body.audioUri,
      user: {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo,
    })
  }

  @Post('script-preview')
  async previewScript(
    @Body()
    body: {
      imageUris?: string[]
      prompt: string
      targetDurationSeconds?: number
    },
  ): Promise<LongTakeScriptPreviewResponse> {
    return this.longTakeService.generateScriptPreview({
      prompt: body.prompt,
      imageUris: body.imageUris,
      targetDurationSeconds: body.targetDurationSeconds,
      user: {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo,
    })
  }

  // Regenerate a finished long-take with the selected transition video model
  // into a NEW project, reusing the source artifacts through keyframes. The
  // response carries the new project id; progress rides the standard status
  // surfaces of that project.
  @Post(':projectId/regenerate')
  async regenerateLongTake(
    @Param('projectId') projectId: string,
    @Body() body: { transitionVideoModel: string },
  ): Promise<{ projectId: string }> {
    const transitionVideoModel =
      typeof body?.transitionVideoModel === 'string' ? body.transitionVideoModel.trim() : ''
    if (!projectId || !transitionVideoModel) {
      throw new BadRequestException('projectId and transitionVideoModel are required')
    }
    const result = await this.longTakeService.regenerateLongTake(
      projectId,
      { transitionVideoModel },
      buildLongTakeRequestUser(),
    )
    return { projectId: result.projectId }
  }

  @Post(':projectId/transitions/:transitionId/regenerate')
  async regenerateTransition(
    @Param('projectId') projectId: string,
    @Param('transitionId') transitionId: string,
    @Body()
    body: {
      keyframeDriven?: boolean
      prompt?: string
      transitionList: Array<{
        firstFrameUrl: string
        lastFrameUrl: string
        transitionId: string
      }>
    },
  ): Promise<{ workflowId: string }> {
    if (!projectId || !transitionId) {
      throw new BadRequestException('projectId and transitionId are required')
    }
    return this.longTakeService.regenerateTransition(projectId, transitionId, body, {
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
      sub: getReqContext().login_id,
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
    } as UserInfo)
  }

  @Post(':projectId/keyframes/:shotId/regenerate')
  async regenerateTransitionKeyframe(
    @Param('projectId') projectId: string,
    @Param('shotId') shotId: string,
    @Body() body: { keyframeUrl?: string; prompt: string; referenceImageUrl?: string },
  ): Promise<{ workflowId: string }> {
    if (!projectId || !shotId || !body.prompt) {
      throw new BadRequestException(
        `${projectId ? '' : 'projectId, '}${shotId ? '' : 'shotId, '}${body.prompt ? '' : 'prompt'} are required`,
      )
    }
    return this.longTakeService.regenerateTransitionKeyframe(projectId, shotId, body, {
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
      sub: getReqContext().login_id,
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
    } as UserInfo)
  }

  @Post(':projectId/reimagine')
  async reimagineLongTake(
    @Param('projectId') projectId: string,
    @Body() body: { modelSelectorTier?: ReimagineModelSelectorTier; transitionVideoModel: string },
  ): Promise<{ projectId: string }> {
    const transitionVideoModel =
      typeof body?.transitionVideoModel === 'string' ? body.transitionVideoModel.trim() : ''
    if (!projectId || !transitionVideoModel) {
      throw new BadRequestException('projectId and transitionVideoModel are required')
    }
    parseReimagineModelSelectorTier(body.modelSelectorTier)
    const result = await this.longTakeService.reimagineLongTake()
    return { projectId: result.projectId }
  }

  // Rename one version in the history. Update = named operation per
  // the house REST standard; a write like restore, so the same tier gate.
  @Post(':projectId/bgm-versions/:versionId/rename')
  async renameBgmVersion(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() body: LongTakeBgmVersionRenameRequest,
  ): Promise<LongTakeBgmVersionRenameResponse> {
    // typeof before trim: the body is unvalidated at runtime, so { trackName: 1 }
    // would otherwise throw a TypeError and surface as a 500 rather than a 400.
    if (!projectId || !versionId || typeof body?.trackName !== 'string' || !body.trackName.trim()) {
      throw new BadRequestException('projectId, versionId and a non-empty trackName are required')
    }
    return {
      data: await this.longTakeService.renameBgmVersion(projectId, versionId, body.trackName, {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo),
    }
  }

  @Post(':projectId/render')
  async render(
    @Param('projectId') projectId: string,
    @Body() body: LongTakeRenderRequest,
  ): Promise<{ isUpscaling: boolean; workflowId: string }> {
    const hasCanonicalSnapshot =
      !!body.expectedRevision && Array.isArray(body.keyframes) && !!body.transitions?.length

    if (!projectId || !hasCanonicalSnapshot) {
      throw new BadRequestException(
        'projectId, expectedRevision, keyframes and non-empty transitions are required',
      )
    }
    return this.longTakeService.render(projectId, body, {
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
      sub: getReqContext().login_id,
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
    } as UserInfo)
  }

  // Restyle a finished long-take under a DIFFERENT visual style into a NEW
  // project. Restyle is not offered: the body is still validated, then the
  // service refuses every request.
  @Post(':projectId/restyle')
  async restyleLongTake(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      modelSelectorTier?: ReimagineModelSelectorTier
      styleName: string
      styleText: string
      styleThumbnailUrl?: string
      transitionVideoModel?: string
    },
  ): Promise<{ projectId: string }> {
    // Hand-validated: this service mounts no ValidationPipe.
    const styleName = typeof body?.styleName === 'string' ? body.styleName.trim() : ''
    const styleText = typeof body?.styleText === 'string' ? body.styleText.trim() : ''
    if (!projectId || !styleName || !styleText) {
      throw new BadRequestException('projectId, styleName and styleText are required')
    }
    parseReimagineModelSelectorTier(body.modelSelectorTier)
    const result = await this.longTakeService.restyleLongTake()
    return { projectId: result.projectId }
  }

  @Put(':projectId/editor-draft')
  async saveEditorDraft(
    @Param('projectId') projectId: string,
    @Body() body: SaveLongTakeEditorDraftRequest,
  ): Promise<LongTakeEditorDraftResponse> {
    if (!projectId) {
      throw new BadRequestException('Invalid story mode editor draft request')
    }
    return { data: await saveEditorDraftForProject(this.projectsService, projectId, body) }
  }

  @Post()
  async startLongTake(
    @Body()
    body: {
      audioUri?: string
      /** The music choice: on/off and the user's wish (see `resolveMusicRequest`). */
      bgmEnabled?: boolean
      bgmNote?: null | string
      /** Where the bed comes from ('generated' | 'library' | 'upload') and which track. */
      bgmSource?: null | string
      bgmTrackId?: null | string
      cameraStyle?: CameraStyle
      createUseCase?: string
      customStyle?: boolean
      debugSettings?: DebugSettings
      generationResolution?: GenerationResolution
      initPrompt?: string // Keep for backward compatibility (deprecated)
      isSavedStyle?: boolean
      isStyleCopy?: boolean
      keyframeImageModel?: string
      perfectLoop?: boolean
      projectId?: string
      prompt?: string
      ratio?: AspectRatio
      remixProjectId?: string
      /** The user's saved style id; an image style's picture guides every picture. */
      savedStyleId?: string
      script?: string
      scriptGeneratorPath?: LongTakeScriptGeneratorPath
      styleName?: string
      styleText?: string
      styleThumbnailUrl?: string
      targetDurationSeconds?: number
      transitionVideoModel?: string
      userPrompt?: string // Primary field
      v4Category?: string
      v4PreviewContextId?: string
      v4Track?: string
      visualScriptTemperature?: number
      voiceId?: string
    },
  ): Promise<{ projectId: string; videoId: string; workflowId: string }> {
    // Unify: userPrompt takes precedence, fallback to initPrompt for old clients. An upload's
    // tag in the text keeps the file's address, never a URL with a host or port.
    const unifiedUserPrompt = toSavedAddressesInText(body.userPrompt || body.initPrompt)
    // Fold keyframeImageModel into debugSettings so the service persists it via the
    // existing debugSettings spread (clones can then read it from project metadata).
    const debugSettings: DebugSettings | undefined = body.keyframeImageModel
      ? { ...body.debugSettings, keyframeImageModel: body.keyframeImageModel }
      : body.debugSettings

    const result = await this.longTakeService.startWorkflow(
      {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo,
      unifiedUserPrompt, // Pass unified value
      toSavedAddressesInText(body.script),
      toSavedAddressesInText(body.prompt),
      undefined, // No initPrompt parameter
      body.styleText,
      body.customStyle,
      body.ratio,
      body.voiceId,
      body.perfectLoop,
      body.visualScriptTemperature,
      body.audioUri,
      body.projectId,
      body.styleName,
      body.styleThumbnailUrl,
      body.isSavedStyle,
      debugSettings,
      body.remixProjectId,
      body.isStyleCopy,
      body.transitionVideoModel,
      body.v4Category,
      body.v4Track,
      body.v4PreviewContextId,
      body.scriptGeneratorPath,
      body.keyframeImageModel,
      body.targetDurationSeconds,
      body.generationResolution,
      body.createUseCase,
      'web', // source (web app channel attribution)
      body.cameraStyle,
      {
        bgmEnabled: body.bgmEnabled,
        bgmNote: body.bgmNote,
        ...(body.bgmSource === undefined ? {} : { bgmSource: sanitizeMusicSource(body.bgmSource) }),
        ...(body.bgmTrackId === undefined
          ? {}
          : {
              bgmTrackId:
                String(body.bgmTrackId ?? '')
                  .trim()
                  .slice(0, MUSIC_TRACK_ID_MAX_LENGTH) || null,
            }),
      },
      typeof body.savedStyleId === 'string' ? body.savedStyleId : undefined,
    )
    return { ...result, videoId: result.projectId }
  }

  // Near-instant wake-up for the settings re-mux so the export
  // processing popup re-reads server truth without waiting a poll interval.
  @Sse(':projectId/bgm-remux/stream')
  async streamBgmRemuxEvents(
    @Param('projectId') projectId: string,
  ): Promise<Observable<MessageEvent>> {
    return this.longTakeService.createBgmRemuxStream(projectId)
  }

  // `videoUri` here is the workflow's `fileUri` -- a `store://` URI the browser
  // turns into a file URL itself.
  @Sse(':projectId/render/stream')
  async streamRenderEvents(
    @Param('projectId') projectId: string,
  ): Promise<Observable<MessageEvent>> {
    await this.assertStreamAccess(projectId)
    const workflowId = this.longTakeService.buildRenderWorkflowId(projectId)
    return this.longTakeService.createWorkflowStream(workflowId, 'render', (progress) => ({
      videoUri: progress.fileUri ?? '',
    }))
  }

  @Sse(':projectId/keyframes/:shotId/regenerate/stream')
  async streamTransitionKeyframeRegenEvents(
    @Param('projectId') projectId: string,
    @Param('shotId') shotId: string,
  ): Promise<Observable<MessageEvent>> {
    await this.assertStreamAccess(projectId)
    const workflowId = this.longTakeService.buildTransitionKeyframeWorkflowId(projectId, shotId)
    return this.longTakeService.createWorkflowStream(workflowId, 'keyframe regen', (progress) => ({
      fileUri: progress.fileUri ?? '',
      thumbnailStorePath: progress.thumbnailStorePath ?? '',
    }))
  }

  @Sse(':projectId/transitions/:transitionId/regenerate/stream')
  async streamTransitionRegenEvents(
    @Param('projectId') projectId: string,
    @Param('transitionId') transitionId: string,
  ): Promise<Observable<MessageEvent>> {
    await this.assertStreamAccess(projectId)
    const workflowId = this.longTakeService.buildTransitionWorkflowId(projectId, transitionId)
    return this.longTakeService.createWorkflowStream(
      workflowId,
      'transition regen',
      (progress) => progress.results ?? [],
    )
  }

  @Put(':projectId/bgm-settings')
  async updateBgmSettings(
    @Param('projectId') projectId: string,
    @Body() body: LongTakeBgmSettingsRequest,
  ): Promise<LongTakeBgmSettingsResponse> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return {
      data: await this.longTakeService.updateBgmSettings(projectId, body, {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo),
    }
  }

  // The caption look (style, highlight, height, size) for the editor and chat panels.
  // Access-checked like bgm-settings; 400 with the reason for a body it can't take.
  @Put(':projectId/caption-settings')
  async updateCaptionSettings(
    @Param('projectId') projectId: string,
    @Body() body: LongTakeCaptionSettingsRequest,
  ): Promise<LongTakeCaptionSettingsResponse> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return {
      data: await this.longTakeService.updateCaptionSettings(projectId, body, {
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        email: getReqContext().pii?.email || '',
        sub: getReqContext().login_id,
        orgId: getReqContext().org_id,
        userId: getReqContext().user_id,
      } as UserInfo),
    }
  }

  /**
   * These three streams take a caller-supplied `:projectId`, build a
   * DETERMINISTIC workflow id from it, and emit that workflow's media, so they
   * check access like every other project read.
   *
   * `canVisitProject` rather than an owner check, matching every neighbouring
   * read (`getStatus`, `getBgmSettings`, `createBgmRemuxStream`): it is
   * share-aware, so a legitimate share viewer keeps its stream.
   */
  private async assertStreamAccess(projectId: string): Promise<void> {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    if (!(await this.projectsService.canVisitProject(projectId))) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }
  }
}
