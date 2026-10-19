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
} from '@shared/types/api/ranking'

import { RankingPatchError } from './ranking-patch'
import { RankingInputError, RankingNotFoundError, RankingService } from './ranking.service'

/** Turns the service's errors into 400 / 404 with the message the studio shows. */
function answer<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof RankingNotFoundError) throw new NotFoundException(error.message)
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
  constructor(private readonly ranking: RankingService) {}

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

  /** Starts a render: `{ bandHeight, overlays: [png base64 per segment] }`. */
  @Post('projects/:id/render')
  render(@Param('id') id: string, @Body() body: unknown): RankingRenderStatus {
    return answer(() => this.ranking.startRender(id, body))
  }

  @Get('renders/:renderId')
  renderStatus(@Param('renderId') renderId: string): RankingRenderStatus {
    return answer(() => this.ranking.renderStatus(renderId))
  }
}
