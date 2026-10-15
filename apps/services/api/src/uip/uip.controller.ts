/**
 * UIP Controller -- Production API Layer (Architecture doc section 2.8)
 *
 * 10 public endpoints + 2 internal callback endpoints.
 * Write operations -> signal the workflow.
 * Read operations -> read from MongoDB.
 * SSE -> real-time push via SSEFactory.
 * Internal -> called by local activities (persist + status).
 */

import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { ACTIVE_MODAL_KIND_VALUES } from '@reelmakeeasy/uip-planner-runtime'
import type { MessageEvent } from '@nestjs/common'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common'
import type { Observable } from 'rxjs'

import { GenerationReadyGuard } from '../setup/generation-ready.guard'

import { getCachedBrandStylePreview, streamBrandStylePreview } from './brand-style-preview.service'
import {
  BrandBankEditDto,
  BrandBriefSubmitDto,
  BrandStylePreviewStartDto,
  CancelSessionDto,
  CancelUipToolDto,
  ConfirmBrandReviewDto,
  ConfirmPlanDto,
  CreateUipSessionDto,
  GenerateUploadUrlsDto,
  GuiUpdateDto,
  ReviewGateActionDto,
  SendUipMessageDto,
  SetAutoContinueDto,
  SetStyleDto,
  SummaryUpdateDto,
  TranscriptEditingStateDto,
  TranscriptVoicePreviewDto,
  UpdateImageModelDto,
  UpdateScriptReviewDto,
  UpdateTransitionVideoModelDto,
  UserOperationHeartbeatDto,
} from './uip.dto'
import { UipService } from './uip.service'
import { editBrandBank as editBrandBankOp, normalizeSelectedStyleRef } from './uip-brand-operations'
import { extractDebugModelSwitch } from './uip-debug-settings'
import type { SelectUipModelsInput } from './uip-model-selection'
import { brandStylePreviewBusKey, uipSessionBusKey } from './uip-session-event'
import { setStyle as setStyleOp } from './uip-set-style'

const logger = createSubLogger('uip-controller')

@Controller('uip-sessions')
export class UipController {
  constructor(private readonly service: UipService) {}

  // Cache-only preview lookup: lets a reload rehydrate the brand
  // tile with one GET instead of re-running the start/stream SSE flow.
  // `result` is null when nothing was generated for the current inputs yet.
  @Get(':id/brand-style-preview/cached')
  async brandStylePreviewCached(
    @Param('id') id: string,
    @Query('reference_frame_url') referenceFrameUrl?: string,
    @Query('style_text') styleText?: string,
  ) {
    await this.service.assertReadAccess(id)
    const result = await getCachedBrandStylePreview({
      projectId: id,
      referenceFrameUrl: referenceFrameUrl ?? '',
      styleText,
    })
    return { result }
  }

  // Brand-card style preview: start async generation, then read the
  // single `preview` event off the stream. Mirrors the custom-style
  // scene-sample start/stream pattern; gated by UipGuard + read access.
  @Post(':id/brand-style-preview/start')
  async brandStylePreviewStart(@Param('id') id: string, @Body() dto: BrandStylePreviewStartDto) {
    await this.service.assertReadAccess(id)
    const bus = await SSEFactory.getSSEBus(brandStylePreviewBusKey(id))
    if (!bus) {
      throw new InternalServerErrorException(`Failed to start brand-style preview stream for ${id}`)
    }
    bus.safeRun(
      () =>
        streamBrandStylePreview(
          { projectId: id, referenceFrameUrl: dto.reference_frame_url, styleText: dto.style_text },
          bus,
        ),
      { onError: (err) => logger.error({ err, projectId: id }, 'brand style preview failed') },
    )
    return { status: 'started' }
  }

  @Sse(':id/brand-style-preview/stream')
  async brandStylePreviewStream(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    await this.service.assertReadAccess(id)
    const bus = await SSEFactory.getSSEBus(brandStylePreviewBusKey(id))
    if (!bus) {
      throw new InternalServerErrorException(`Failed to open brand-style preview stream for ${id}`)
    }
    const connectionId = randomUUID().slice(0, 8)
    return bus.stream({
      onStart: async () => {
        logger.info(`[${id}] brand-style preview SSE client connected (conn=${connectionId})`)
      },

      onCleanup: () => {
        logger.info(`[${id}] brand-style preview SSE client disconnected (conn=${connectionId})`)
      },
    })
  }

  //
  @Delete(':id/queue/:queueItemId')
  async cancelQueuedItem(@Param('id') id: string, @Param('queueItemId') queueItemId: string) {
    const cancelled = await this.service.cancelQueuedItem(id, queueItemId)
    return { cancelled }
  }

  //
  // The gate token is optional: the projects grid cancels a planning
  // session that has no open review gate. Widening only -- every caller that
  // already sends a token keeps working, and the service is unchanged.
  @Post(':id/cancel')
  async cancelSession(@Param('id') id: string, @Body() dto: CancelSessionDto) {
    const ctx = getReqContext()
    const status = await this.service.cancelSession(
      id,
      dto.gate_token ?? '',
      dto.client_id,
      ctx.user_id,
    )
    return { status }
  }

  // Cancel a single running tool by name. Session stays alive; the
  // workflow no-ops if no matching tool is running.
  @Post(':id/tool-cancellations')
  async cancelTool(@Param('id') id: string, @Body() dto: CancelUipToolDto) {
    const ctx = getReqContext()
    const status = await this.service.cancelTool(id, dto.tool_name, ctx.user_id)
    return { status }
  }

  //
  @Post(':id/confirm-brand-review')
  async confirmBrandReview(@Param('id') id: string, @Body() dto: ConfirmBrandReviewDto) {
    const ctx = getReqContext()
    const selectedStyleRef = normalizeSelectedStyleRef(dto.selected_style_ref)
    const { saved, status } = await this.service.confirmBrandReview(
      id,
      {
        gateToken: dto.gate_token,
        edits: dto.edits,
        ...(dto.save === undefined ? {} : { save: dto.save }),
        ...(dto.style_directive === undefined ? {} : { styleDirective: dto.style_directive }),
        ...(dto.brand_style_text ? { brandStyleText: dto.brand_style_text } : {}),
        ...(dto.brand_style_preview_url
          ? { brandStylePreviewUrl: dto.brand_style_preview_url }
          : {}),
        ...(selectedStyleRef ? { selectedStyleRef } : {}),
      },
      ctx.user_id,
    )
    if (status === 'invalid') {
      throw new BadRequestException(
        'confirm-brand-review: one or more pending edits has a discriminator/body mismatch',
      )
    }
    return { saved, status }
  }

  //
  @Post(':id/confirm-fast')
  async confirmFast(@Param('id') id: string, @Body() dto: ConfirmPlanDto) {
    const ctx = getReqContext()
    const status = await this.service.confirmFast(id, dto.client_id, ctx.user_id)
    return { status }
  }

  //
  @Post(':id/confirm')
  async confirmPlan(@Param('id') id: string, @Body() dto: ConfirmPlanDto) {
    const ctx = getReqContext()
    const status = await this.service.confirmPlan(id, dto.client_id, ctx.user_id)
    return { status }
  }

  //
  @Post(':id/continue-uip-draft')
  async continueUipDraft(@Param('id') id: string, @Body() dto: ReviewGateActionDto) {
    const ctx = getReqContext()
    const status = await this.service.continueUipDraft(
      id,
      dto.gate_token,
      dto.client_id,
      ctx.user_id,
    )
    return { status }
  }

  //
  @Post()
  // Refused like the long-take start while neither fal nor Gemini can make the video.
  @UseGuards(GenerationReadyGuard)
  async createSession(@Body() dto: CreateUipSessionDto) {
    const ctx = getReqContext()
    // eslint-disable-next-line @nx/workspace-no-pii-field-access
    const userEmail = ctx.pii?.email || ''
    const modelSelectorTier = parseModelSelectorAnalyticsTier(dto.model_selector_tier)
    if (dto.model_selector_tier !== undefined && modelSelectorTier === undefined) {
      throw new BadRequestException('model_selector_tier must be a normalized analytics tier')
    }
    return this.service.createSession({
      loginId: ctx.login_id,
      userId: ctx.user_id,
      userEmail,
      orgId: ctx.org_id,
      initialMessage: dto.initial_message,
      brandBriefId: dto.brand_brief_id,
      brandBriefExcludedAssetUris: dto.brand_brief_excluded_asset_uris,
      remixBrandAware: dto.remix_brand_aware,
      remixProjectId: dto.remix_project_id,
      seedStyleInstruction: dto.seed_style_instruction,
      selectedStyleRef: normalizeSelectedStyleRef(dto.selected_style_ref),
      sessionCreationId: dto.session_creation_id,
      styleMode: dto.style_mode,
      uploadedAssets: dto.uploaded_assets,
      audioPath: dto.audio_path,
      audioDurationSeconds: dto.audio_duration_seconds,
      audioTranscript: dto.audio_transcript,
      isMusic: dto.is_music,
      voice: dto.voice,
      aspectRatio: dto.aspect_ratio,
      generationResolution: dto.generation_resolution,
      imageModel: dto.image_model,
      modelSelectorTier,
      // The debug model switch bypasses the video-model selector's enabled
      // checks in getModelName.
      debugSettings: extractDebugModelSwitch(dto.debug_settings),
      transitionVideoModel: dto.transition_video_model,
      customStyle: dto.custom_style,
      enableCaption: dto.enable_caption,
      bgmEnabled: dto.bgm_enabled,
      autoContinueEnabled: dto.auto_continue_enabled,
      entryUseCase: dto.entry_use_case,
    })
  }

  //
  @Post(':id/brand-bank/edit')
  async editBrandBank(@Param('id') id: string, @Body() dto: BrandBankEditDto) {
    // Skips the usual `this.service.editBrandBank` wrapper because
    // uip.service.ts is at the 800-line max-lines cap. The op function
    // already accepts the service instance as its first arg, mirroring
    // the other brand-operations functions; the access-check + signal
    // dispatch all run service-side through the passed-in `this.service`.
    const status = await editBrandBankOp(this.service, id, {
      kind: dto.kind,
      field: dto.field,
      add_asset: dto.add_asset,
      remove_asset: dto.remove_asset,
    })
    if (status === 'rejected') {
      throw new BadRequestException('brand-bank edits are only accepted during brand_review')
    }
    if (status === 'invalid') {
      throw new BadRequestException(
        `brand-bank edit body does not match kind='${dto.kind}' (missing matching sub-body)`,
      )
    }
    return { status }
  }

  //
  @Post(':id/transcript-voice-preview')
  async generateTranscriptVoicePreview(
    @Param('id') id: string,
    @Body() body: TranscriptVoicePreviewDto,
  ) {
    return this.service.generateTranscriptVoicePreview(id, body)
  }

  //
  @Post(':id/generate-upload-urls')
  async generateUploadUrls(@Param('id') id: string, @Body() dto: GenerateUploadUrlsDto) {
    return this.service.generateUploadUrls(id, dto.files)
  }

  // Declared before `@Get(':id')` so the static path wins route matching.
  @Get('carry-uip-context')
  async getCarryUipContext(
    @Query('source_project_id') sourceProjectId: string,
    @Query('share_id') shareId?: string,
  ) {
    return this.service.getCarryUipContext(sourceProjectId, shareId)
  }

  @Get(':id')
  async getSession(@Param('id') id: string) {
    return this.service.getSession(id)
  }

  //
  @Get(':id/spec/:version')
  async getSpecVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.service.getSpecVersion(id, Number.parseInt(version, 10))
  }

  //
  @Post(':id/gui-update')
  async guiUpdate(@Param('id') id: string, @Body() body: GuiUpdateDto) {
    await this.service.sendGuiUpdate(id, {
      transcript: body.transcript,
      voice: body.voice,
      voicePreviewSpeed: body.voice_preview_speed,
    })
    return { accepted: true }
  }

  @Post(':id/select-models')
  selectModels(@Param('id') id: string, @Body() dto: SelectUipModelsInput) {
    return this.service.selectModels(id, dto)
  }

  //
  @Post(':id/message')
  async sendMessage(@Param('id') id: string, @Body() dto: SendUipMessageDto) {
    // Runtime guard: no global ValidationPipe here, so @IsIn doesn't enforce.
    // ACTIVE_MODAL_KIND_VALUES hand-mirrors the frontend's ActiveModalKind union, so an
    // unrecognized sent_from is dropped (soft-fail) instead of rejecting the send.
    let sentFrom = dto.sent_from
    if (sentFrom !== undefined && !ACTIVE_MODAL_KIND_VALUES.includes(sentFrom)) {
      logger.warn({ projectId: id, sentFrom }, 'dropping unrecognized sent_from on send-message')
      sentFrom = undefined
    }
    const result = await this.service.sendMessage(
      id,
      dto.message,
      dto.uploaded_assets,
      dto.answer_to_message_id,
      dto.client_id,
      dto.brand_draft_edits,
      sentFrom,
    )
    return { answerStatus: result.answerStatus, event: result.timelineEvent, record: result.record }
  }

  // Flip the mutable auto-continue setting mid-session, from the
  // in-session control. POST like the other UIP sub-actions.
  @Post(':id/auto-continue')
  async setAutoContinue(@Param('id') id: string, @Body() dto: SetAutoContinueDto) {
    // Runtime guard, not just the DTO decorator: this API has no global
    // ValidationPipe, so class-validator annotations do not enforce.
    if (typeof dto.auto_continue_enabled !== 'boolean') {
      throw new BadRequestException('auto_continue_enabled must be a boolean')
    }
    await this.service.setAutoContinue(id, dto.auto_continue_enabled)
    return { accepted: true }
  }

  // Explicit user style switch. Skips the usual
  // `this.service.setStyle` wrapper -- uip.service.ts is at the max-lines cap
  // -- mirroring editBrandBank above: the op function takes `this.service` and
  // owns the phase/lock guard + signal dispatch. Throws ConflictException
  // (409) once the session has passed the visual-render lock; NestJS turns
  // that into the HTTP response automatically.
  @Post(':id/style')
  async setStyle(@Param('id') id: string, @Body() dto: SetStyleDto) {
    // Runtime guard, not just the DTO decorator: this API has no global
    // ValidationPipe, so SetStyleDto's @IsNotEmpty/@IsString do not enforce.
    // An empty/missing style_name or style_text would still make it to
    // uip-set-style.ts, which signals the workflow to write style +
    // style_source='auto_switched' -- foldStyleSource then treats that as a
    // user commitment and permanently suppresses auto re-selection for this
    // brief, wedging the session unstyled. Reject before signaling.
    if (typeof dto.style_name !== 'string' || dto.style_name.trim().length === 0) {
      throw new BadRequestException('style_name must be a non-empty string')
    }
    if (typeof dto.style_text !== 'string' || dto.style_text.trim().length === 0) {
      throw new BadRequestException('style_text must be a non-empty string')
    }
    // Optional, but if present must be a string -- no global ValidationPipe means
    // a non-string thumbnail would otherwise reach the style object and violate
    // the cross-layer schema.
    if (dto.style_thumbnail_url !== undefined && typeof dto.style_thumbnail_url !== 'string') {
      throw new BadRequestException('style_thumbnail_url must be a string')
    }
    await setStyleOp(this.service, id, {
      styleName: dto.style_name,
      styleText: dto.style_text,
      styleThumbnailUrl: dto.style_thumbnail_url,
    })
    return { accepted: true }
  }

  // SSE stream fed by in-process pushes. `batch_changes` deltas
  // (`uip-session-lock.ts`) carry the same `state` and `timeline` shapes the
  // initial GET returns, and the client applies them without refetching.
  @Sse(':id/stream')
  async streamSession(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    await this.service.assertReadAccess(id)
    const bus = await SSEFactory.getSSEBus(uipSessionBusKey(id))
    if (!bus) {
      throw new Error(`Failed to get SSE bus for UIP session ${id}`)
    }

    const connectionId = randomUUID().slice(0, 8)
    return bus.stream({
      onStart: async () => {
        logger.info(`[${id}] SSE client connected (conn=${connectionId})`)
      },

      onCleanup: () => {
        logger.info(`[${id}] SSE client disconnected (conn=${connectionId})`)
      },
    })
  }

  //
  @Post(':id/brand-brief/submit')
  async submitBrandBrief(@Param('id') id: string, @Body() dto: BrandBriefSubmitDto) {
    await this.service.submitBrandBrief(id, {
      answerToMessageId: dto.answer_to_message_id,
      kind: dto.kind,
      text: dto.text,
      uploadedAssets: dto.uploaded_assets,
      url: dto.url,
    })
    return { accepted: true }
  }

  // Summary artifact edit channel.
  @Post(':id/summary')
  async summaryUpdate(@Param('id') id: string, @Body() dto: SummaryUpdateDto) {
    await this.service.sendSummaryUpdate(id, {
      globalConstraints: dto.globalConstraints,
      requestId: dto.requestId,
    })
    return { accepted: true }
  }

  //
  @Post(':id/transcript-editing-state')
  async transcriptEditingState(@Param('id') id: string, @Body() body: TranscriptEditingStateDto) {
    return this.service.updateTranscriptEditingState(id, body.active, body.client_id)
  }

  @Post(':id/image-model/update')
  async updateImageModel(@Param('id') id: string, @Body() dto: UpdateImageModelDto) {
    await this.service.updateImageModel(id, dto.image_model ?? null)
    return { accepted: true }
  }

  @Post(':id/script-review/update')
  async updateScriptReview(@Param('id') id: string, @Body() dto: UpdateScriptReviewDto) {
    await this.service.updateScriptReview(id, {
      gateToken: dto.gate_token,
      script: dto.script,
      globalConstraints: dto.global_constraints as Record<string, unknown> | undefined,
    })
    return { accepted: true }
  }

  @Post(':id/transition-video-model/update')
  async updateTransitionVideoModel(
    @Param('id') id: string,
    @Body() dto: UpdateTransitionVideoModelDto,
  ) {
    await this.service.updateTransitionVideoModel(id, dto.transition_video_model ?? null)
    return { accepted: true }
  }

  @Post(':id/user-operation-heartbeat')
  async userOperationHeartbeat(@Param('id') id: string, @Body() body: UserOperationHeartbeatDto) {
    return this.service.updateUserOperationHeartbeat(id, body.client_id)
  }
}
