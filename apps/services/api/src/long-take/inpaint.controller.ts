import type { InpaintReference, InpaintRegion } from '@reelmakeeasy/common/inpaint/public-state'
import {
  INPAINT_REFERENCE_PREFIX,
  isAllowedInpaintReferencePath,
  isOwnedScopeReferencePath,
  ownsInpaintReferencePath,
} from '@reelmakeeasy/common/inpaint/reference-path'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { INPAINT_ESCALATION_MODEL_FAMILY } from '@reelmakeeasy/common/video-models/inpaint'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common'
import type { InpaintTimelineEventsResponse } from '@shared/types/api/long-take'
import type { Observable } from 'rxjs'

import {
  type CreateEditContextParams,
  type GenerateEditVideoParams,
  InpaintService,
  type RestoreTransitionParams,
  type RestoreTransitionsParams,
  type UpdateEditContextParams,
} from './inpaint.service'

// Ownership, checked here rather than inside the containment helper: this is the
// only layer with a caller to check against. Containment answers "may the editor
// read this at all"; this answers "is it yours", and only a request knows that.
function assertReferenceOwnership(
  references: InpaintReference[] | null | undefined,
  ownerId: string | undefined,
): void {
  if (!Array.isArray(references)) {
    return
  }
  for (const ref of references) {
    // Without a verified identity the owned scope is unusable, rather than
    // falling back to containment -- otherwise the scope name would itself be a
    // way to opt out of the check it exists to add.
    if (
      isOwnedScopeReferencePath(ref?.fileUri) &&
      (!ownerId || !ownsInpaintReferencePath(ref.fileUri, ownerId))
    ) {
      throw new BadRequestException('references must be uploads owned by the caller')
    }
  }
}

// Shared by create/update: both carry the optional reference + region payload.
// Only store paths are accepted, never image bytes, so the workflow state stays small.
// The update route also allows null (clear); the create path has no removal semantics
// and passes allowNullClear=false so a null still 400s there.
function assertValidReferencesAndRegion(
  projectId: string,
  body: {
    references?: InpaintReference[] | null
    region?: InpaintRegion | null
  },
  allowNullClear: boolean,
  ownerId?: string,
): void {
  // An empty list means "no references", which the client expresses by omitting the
  // field -- same rule the transitionIds check applies to ranges. null means "clear",
  // but only where allowNullClear permits it.
  if (
    body.references !== undefined &&
    !(allowNullClear && body.references === null) &&
    (!Array.isArray(body.references) ||
      body.references.length === 0 ||
      !body.references.every((ref) => isAllowedInpaintReferencePath(ref?.fileUri, projectId)))
  ) {
    throw new BadRequestException(
      `references must be a non-empty array of { fileUri } under ${INPAINT_REFERENCE_PREFIX}/ or this project's durable reference folder`,
    )
  }
  assertReferenceOwnership(body.references, ownerId)
  if (body.region !== undefined && !(allowNullClear && body.region === null)) {
    const region: unknown = body.region
    const isExtent = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0
    const isOrigin = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    const bbox: unknown =
      typeof region === 'object' && region !== null
        ? (region as Record<string, unknown>).bbox
        : undefined
    const tsMs: unknown =
      typeof region === 'object' && region !== null
        ? (region as Record<string, unknown>).tsMs
        : undefined
    const side = (key: string) =>
      typeof bbox === 'object' && bbox !== null ? (bbox as Record<string, unknown>)[key] : undefined
    // The bbox is normalized to the frame, so a box must also fit inside it: sides
    // that are individually in range still describe an off-frame box once summed.
    // The tolerance absorbs float drift in the client's drag math (0.9 + 0.1 sums
    // to just over 1), which is not the same thing as an out-of-frame box.
    const EDGE_TOLERANCE = 1e-6
    const fits = (origin: unknown, extent: unknown) =>
      (origin as number) + (extent as number) <= 1 + EDGE_TOLERANCE
    if (
      !isOrigin(tsMs) ||
      !isExtent(side('h')) ||
      !isExtent(side('w')) ||
      !isOrigin(side('x')) ||
      !isOrigin(side('y')) ||
      !fits(side('x'), side('w')) ||
      !fits(side('y'), side('h'))
    ) {
      throw new BadRequestException(
        'region must be { bbox: { h, w, x, y }, tsMs } with a positive-area bbox',
      )
    }
  }
}

@Controller('long-take-videos')
export class InpaintController {
  constructor(private readonly inpaintService: InpaintService) {}

  @Post(':projectId/inpaint/apply-edit-context')
  async applyEditContext(
    @Param('projectId') projectId: string,
    @Body() body: { clientId?: string; editId: string; runId: string },
  ): Promise<{ accepted: true }> {
    if (!body.runId || !body.editId) {
      throw new BadRequestException('runId, editId are required')
    }
    await this.inpaintService.applyEditContext(projectId, body.runId, body.editId, body.clientId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/continue-as-new')
  async continueAsNew(@Param('projectId') projectId: string): Promise<{ accepted: true }> {
    await this.inpaintService.continueAsNew(projectId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/create-edit-context')
  async createEditContext(
    @Param('projectId') projectId: string,
    @Body() body: CreateEditContextParams,
  ): Promise<{ accepted: true }> {
    if (!body.editId || !body.historyId || !body.transitionId || body.timestampSec == null) {
      throw new BadRequestException('editId, historyId, transitionId, timestampSec are required')
    }
    if (
      body.transitionIds !== undefined &&
      (!Array.isArray(body.transitionIds) ||
        body.transitionIds.length === 0 ||
        !body.transitionIds.every((id) => typeof id === 'string'))
    ) {
      throw new BadRequestException('transitionIds must be a non-empty array of strings')
    }
    if (body.autoApply !== undefined && typeof body.autoApply !== 'boolean') {
      throw new BadRequestException('autoApply must be a boolean')
    }
    assertValidReferencesAndRegion(projectId, body, false, getReqContext().login_id)
    await this.inpaintService.createEditContext(projectId, body)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/finish')
  async finish(@Param('projectId') projectId: string): Promise<{ accepted: true }> {
    await this.inpaintService.finish(projectId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/generate-anchor-image')
  async generateAnchorImage(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      clientId?: string
      editId: string
      nonce: string
    },
  ): Promise<{ accepted: true }> {
    if (!body.nonce || !body.editId) {
      throw new BadRequestException('editId, nonce are required')
    }
    await this.inpaintService.generateAnchorImage(projectId, body.editId, body.nonce, body.clientId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/generate-edit-video')
  async generateEditVideo(
    @Param('projectId') projectId: string,
    @Body() body: GenerateEditVideoParams,
  ): Promise<{ accepted: true }> {
    // modelFamily is intentionally not required here: the server resolves it from
    // source-video provenance (see InpaintService.generateEditVideo), never the client.
    if (!body.anchorId || !body.editId || !body.planRunId) {
      throw new BadRequestException('anchorId, editId, planRunId are required')
    }
    await this.inpaintService.generateEditVideo(projectId, body)
    return { accepted: true }
  }

  @Get(':projectId/inpaint')
  async getState(@Param('projectId') projectId: string): Promise<unknown> {
    return this.inpaintService.getState(projectId)
  }

  @Get(':projectId/inpaint/timeline-events')
  async getTimelineEvents(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('beforeId') beforeId?: string,
  ): Promise<InpaintTimelineEventsResponse> {
    let parsedLimit: number | undefined
    if (limit !== undefined) {
      parsedLimit = Number(limit)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
        throw new BadRequestException('limit must be an integer between 1 and 500')
      }
    }

    let parsedBefore: number | undefined
    if (before !== undefined) {
      parsedBefore = Number(before)
      if (!Number.isInteger(parsedBefore) || parsedBefore <= 0) {
        throw new BadRequestException('before must be a positive timestamp in milliseconds')
      }
    }

    if (beforeId !== undefined && (beforeId === '' || parsedBefore === undefined)) {
      throw new BadRequestException('beforeId must be a non-empty diff id paired with before')
    }

    return await this.inpaintService.getTimelineEvents(
      projectId,
      parsedLimit,
      parsedBefore,
      beforeId,
    )
  }

  @Post(':projectId/inpaint/goto')
  async goto(
    @Param('projectId') projectId: string,
    @Body() body: { targetId: string },
  ): Promise<{ accepted: true }> {
    if (!body.targetId) {
      throw new BadRequestException('targetId is required')
    }
    await this.inpaintService.goto(projectId, body.targetId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/hide-edit-context')
  async hideEditContext(
    @Param('projectId') projectId: string,
    @Body() body: { clientId?: string; editId: string; hidden: boolean },
  ): Promise<{ accepted: true }> {
    if (!body.editId || typeof body.hidden !== 'boolean') {
      throw new BadRequestException('editId, hidden are required')
    }
    await this.inpaintService.hideEditContext(projectId, body.editId, body.hidden, body.clientId)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/restore-transition')
  async restoreTransition(
    @Param('projectId') projectId: string,
    @Body() body: RestoreTransitionParams,
  ): Promise<{ accepted: true }> {
    if (!body.transitionId || !body.versionId) {
      throw new BadRequestException('transitionId, versionId are required')
    }
    await this.inpaintService.restoreTransition(projectId, body)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/restore-transitions')
  async restoreTransitions(
    @Param('projectId') projectId: string,
    @Body() body: RestoreTransitionsParams,
  ): Promise<{ accepted: true }> {
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray(body.clips) ||
      body.clips.length === 0 ||
      !body.clips.every(
        (clip) =>
          typeof clip?.transitionId === 'string' &&
          clip.transitionId !== '' &&
          typeof clip.versionId === 'string' &&
          clip.versionId !== '',
      )
    ) {
      throw new BadRequestException('clips must be a non-empty list of transitionId + versionId')
    }
    await this.inpaintService.restoreTransitions(projectId, body)
    return { accepted: true }
  }

  @Post(':projectId/inpaint/retry-run')
  async retryRun(
    @Param('projectId') projectId: string,
    @Body() body: { modelFamilyOverride?: string; runId: string },
  ): Promise<{ newRunId?: string; retried: boolean }> {
    if (!body.runId) {
      throw new BadRequestException('runId is required')
    }
    const { modelFamilyOverride } = body
    if (
      modelFamilyOverride !== undefined &&
      modelFamilyOverride !== INPAINT_ESCALATION_MODEL_FAMILY
    ) {
      throw new BadRequestException(
        `modelFamilyOverride must be ${INPAINT_ESCALATION_MODEL_FAMILY}`,
      )
    }
    return this.inpaintService.retryRun(projectId, body.runId, modelFamilyOverride)
  }

  @Put(':projectId/inpaint')
  async startSession(@Param('projectId') projectId: string) {
    if (!projectId) {
      throw new BadRequestException('projectId is required')
    }
    return this.inpaintService.startSession(projectId)
  }

  @Sse(':projectId/inpaint/stream')
  async streamInpaintEvents(
    @Param('projectId') projectId: string,
  ): Promise<Observable<MessageEvent>> {
    const bus = await this.inpaintService.getSSEBus(projectId)
    if (!bus) {
      throw new NotFoundException(`No active inpaint session for project ${projectId}`)
    }
    return bus.stream({})
  }

  @Post(':projectId/inpaint/update-edit-context')
  async updateEditContext(
    @Param('projectId') projectId: string,
    @Body() body: UpdateEditContextParams,
  ): Promise<{ accepted: true }> {
    if (!body.editId) {
      throw new BadRequestException('editId is required')
    }
    assertValidReferencesAndRegion(projectId, body, true, getReqContext().login_id)
    await this.inpaintService.updateEditContext(projectId, body)
    return { accepted: true }
  }
}
