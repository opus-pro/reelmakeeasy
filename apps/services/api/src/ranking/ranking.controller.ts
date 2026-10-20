import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import type {
  RankingProject,
  RankingProjectSummary,
  RankingRenderStatus,
  RankingTemplate,
} from '@shared/types/api/ranking'
import { applyRankingTemplate } from '@reelmakeeasy/common/ranking/ranking-template'

import { RankingPatchError } from './ranking-patch'
import { RankingInputError, RankingNotFoundError, RankingService } from './ranking.service'
import { RankingTemplateNotFoundError, RankingTemplateService } from './ranking-template.service'

/** Turns the service's errors into 400 / 404 with the message the studio shows. */
function answer<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof RankingNotFoundError || error instanceof RankingTemplateNotFoundError)
      throw new NotFoundException(error.message)
    if (error instanceof RankingInputError || error instanceof RankingPatchError)
      throw new BadRequestException(error.message)
    throw error
  }
}

async function answerAsync<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    return answer(() => {
      throw error
    })
  }
}

/** Ranking Builder: projects, clips and renders (`/api/ranking/...`). */
@Controller('ranking')
export class RankingController {
  constructor(
    private readonly ranking: RankingService,
    private readonly templates: RankingTemplateService,
  ) {}

  @Get('projects')
  list(): RankingProjectSummary[] {
    return this.ranking.list()
  }

  @Post('projects')
  create(@Body() body: { name?: unknown }): RankingProject {
    return this.ranking.create(typeof body?.name === 'string' ? body.name : undefined)
  }

  @Get('projects/:id')
  get(@Param('id') id: string): RankingProject {
    return answer(() => this.ranking.get(id))
  }

  @Put('projects/:id')
  update(@Param('id') id: string, @Body() body: unknown): RankingProject {
    return answer(() => this.ranking.update(id, body))
  }

  @Delete('projects/:id')
  @HttpCode(204)
  delete(@Param('id') id: string): void {
    answer(() => this.ranking.delete(id))
  }

  /** Puts an uploaded video (`{ fileUri, name }` from a signed upload) under a rank. */
  @Post('projects/:id/items/:itemId/clip')
  setClip(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { fileUri?: unknown; name?: unknown },
  ): Promise<RankingProject> {
    return answerAsync(() => this.ranking.setClip(id, itemId, body?.fileUri, body?.name))
  }

  /** Stores an uploaded picture (`{ fileUri, name }`) for a sticker; answers `{ imageUrl }`. */
  @Post('projects/:id/sticker-images')
  addStickerImage(
    @Param('id') id: string,
    @Body() body: { fileUri?: unknown; name?: unknown },
  ): Promise<{ imageUrl: string }> {
    return answerAsync(() => this.ranking.addStickerImage(id, body?.fileUri, body?.name))
  }

  /** Starts a render: `{ bandHeight, overlays: [png base64 per segment] }`. */
  @Post('projects/:id/render')
  render(@Param('id') id: string, @Body() body: unknown): RankingRenderStatus {
    return answer(() => this.ranking.startRender(id, body))
  }

  /** Exports without a studio open (headless): answers the render's status to poll. */
  @Post('projects/:id/export')
  exportHeadless(@Param('id') id: string): Promise<RankingRenderStatus> {
    return answerAsync(() => this.ranking.exportHeadless(id))
  }

  /** Gives a ranking a saved style's look and sounds (`{ styleId }`). */
  @Post('projects/:id/apply-style')
  applyStyle(@Param('id') id: string, @Body() body: { styleId?: unknown }): RankingProject {
    return answer(() =>
      this.ranking.update(id, applyRankingTemplate(this.ranking.get(id), this.templates.get(String(body?.styleId)))),
    )
  }

  /** Saved ranking styles, newest first. */
  @Get('styles')
  styles(): RankingTemplate[] {
    return this.templates.list()
  }

  @Post('styles')
  createStyle(@Body() body: unknown): RankingTemplate {
    return answer(() => this.templates.create(body))
  }

  @Get('styles/:id')
  style(@Param('id') id: string): RankingTemplate {
    return answer(() => this.templates.get(id))
  }

  /** Changes any part of a style (whole fields). */
  @Put('styles/:id')
  updateStyle(@Param('id') id: string, @Body() body: unknown): RankingTemplate {
    return answer(() => this.templates.update(id, body))
  }

  @Delete('styles/:id')
  @HttpCode(204)
  deleteStyle(@Param('id') id: string): void {
    answer(() => this.templates.delete(id))
  }

  @Get('renders/:renderId')
  renderStatus(@Param('renderId') renderId: string): RankingRenderStatus {
    return answer(() => this.ranking.renderStatus(renderId))
  }
}
