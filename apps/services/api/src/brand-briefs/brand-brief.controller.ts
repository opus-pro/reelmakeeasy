import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  type MessageEvent,
  Param,
  Post,
  Put,
  Sse,
  UseGuards,
} from '@nestjs/common'
import { Logger } from '@reelmakeeasy/common/logger'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { normalizeBrandUrl } from '@reelmakeeasy/common/utils/normalize-brand-url'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import type { Observable } from 'rxjs'


import { BrandBriefGuard } from './brand-brief.guard'
import {
  BrandBriefService,
  type CreateManualBrandBriefPayload,
  type UpdateBrandBriefPayload,
} from './brand-brief.service'
import { BrandBriefCreateService, type CreateBrandInput } from './brand-brief-create.service'

// Request body for starting a create-brand run: a website URL OR a text
// description with optional reference-image staging URIs (text+image path).
interface CreateBrandBriefBody {
  images?: string[]
  text?: string
  url?: string
}

// Org-scoped brand-library management (Branding V2). Read, partial-update,
// and delete, plus the async create-in-library extraction (MS2): a
// `/extractions/:sessionId/start` kicks off brand extraction + background style
// gen, streamed over `/extractions/:sessionId/stream`.
// BrandBriefGuard hides the surface while saved brands are off.
@Controller('brand-briefs')
@UseGuards(BrandBriefGuard)
export class BrandBriefController {
  private readonly logger = new Logger(BrandBriefController.name)

  constructor(
    private readonly service: BrandBriefService,
    private readonly createService: BrandBriefCreateService,
  ) {}

  // Manually-entered brand create: the non-AI sibling of
  // extractions/:sessionId/start. No stream -- the brief is built synchronously
  // from the typed fields and returned.
  @Post()
  async create(@Body() payload: CreateManualBrandBriefPayload) {
    return await this.service.createManual(payload)
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.service.delete(id)
  }

  @Post('extractions/:sessionId/start')
  async extractionStart(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateBrandBriefBody,
  ) {
    const input = parseCreateInput(body)
    // Resolve ids synchronously: the run executes in safeRun after this request
    // returns, where the request context is gone.
    const { login_id: userId, org_id: orgId } = getReqContext()
    const bus = await SSEFactory.getSSEBus(`brand-create-${userId}-${sessionId}`)
    if (!bus) {
      throw new InternalServerErrorException(`Failed to start stream for session ${sessionId}`)
    }
    bus.safeRun(
      () =>
        this.createService.runCreate(
          { images: body.images, input, orgId, userId },
          bus,
        ),
      { onError: (err) => this.logger.error({ err, sessionId }, 'brand create run failed') },
    )
    return { sessionId, status: 'started' }
  }

  @Sse('extractions/:sessionId/stream')
  async extractionStream(@Param('sessionId') sessionId: string): Promise<Observable<MessageEvent>> {
    const userId = getReqContext().login_id
    const bus = await SSEFactory.getSSEBus(`brand-create-${userId}-${sessionId}`)
    if (!bus) {
      throw new InternalServerErrorException(`Failed to open stream for session ${sessionId}`)
    }
    return bus.stream()
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return await this.service.get(id)
  }

  @Get()
  async list() {
    return await this.service.list()
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateBrandBriefPayload,
  ) {
    return await this.service.update(id, payload)
  }
}

// Exactly one of url / text. Mirrors the UIP brand-extraction Q&A input shapes.
function parseCreateInput(body: CreateBrandBriefBody): CreateBrandInput {
  // Normalize the scheme so a bare domain (`example.com`) reaches the crawl as a
  // parseable https URL instead of throwing `invalid url` there.
  const url = body.url ? normalizeBrandUrl(body.url) : undefined
  const text = body.text?.trim()
  if (url && text) {
    throw new BadRequestException('Provide either a website URL or a description, not both')
  }
  if (url) {
    return { kind: 'url', url }
  }
  if (text) {
    return { kind: 'freeform', text }
  }
  throw new BadRequestException('A website URL or a brand description is required')
}
