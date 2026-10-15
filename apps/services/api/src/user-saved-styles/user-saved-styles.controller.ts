import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common'

import {
  CreateUserSavedStyleDto,
  RecordStyleUseDto,
  UpdateUserSavedStyleDto,
} from './user-saved-styles.dto'
import { UserSavedStylesService } from './user-saved-styles.service'

@Controller('user-saved-styles')
export class UserSavedStylesController {
  constructor(private readonly userSavedStylesService: UserSavedStylesService) {}

  @Post()
  async create(@Body() dto: CreateUserSavedStyleDto) {
    return this.userSavedStylesService.create(dto)
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.userSavedStylesService.delete(id)
  }

  @Get()
  async findAllByUser() {
    return this.userSavedStylesService.findAllByUser()
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const style = await this.userSavedStylesService.findById(id)
    if (!style) {
      throw new NotFoundException('Saved style not found')
    }
    return style
  }

  // Record that this style produced a project. Sub-resource noun so
  // the link is addressable later (reuse depth).
  @Post(':id/uses')
  async recordUse(@Param('id') id: string, @Body() dto: RecordStyleUseDto) {
    // No global ValidationPipe, so the DTO decorator is decorative -- check here.
    if (typeof dto?.projectId !== 'string' || !dto.projectId.trim()) {
      throw new BadRequestException('projectId is required')
    }
    return this.userSavedStylesService.recordUse(id, dto.projectId)
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserSavedStyleDto) {
    return this.userSavedStylesService.update(id, dto)
  }

  @Post(':id/thumbnail')
  async updateThumbnail(@Param('id') id: string, @Body() body: { imageDataUrl?: string }) {
    if (!body.imageDataUrl?.trim()) {
      throw new BadRequestException('imageDataUrl is required')
    }
    return this.userSavedStylesService.updateThumbnail(id, body.imageDataUrl)
  }

  @Post(':id/thumbnail-url')
  async updateThumbnailFromUrl(@Param('id') id: string, @Body() body: { thumbnailUrl?: string }) {
    if (!body.thumbnailUrl?.trim()) {
      throw new BadRequestException('thumbnailUrl is required')
    }
    return this.userSavedStylesService.updateThumbnailFromUrl(id, body.thumbnailUrl)
  }
}
