import { Body, Controller, Get, Put } from '@nestjs/common'

import {
  SourcePreferenceResponseDto,
  UpdateSourcePreferenceDto,
  YoutubeFilterType,
} from './source-preferences.dto'
import { SourcePreferencesService } from './source-preferences.service'

@Controller('source-preferences')
export class SourcePreferencesController {
  constructor(private readonly sourcePreferencesService: SourcePreferencesService) {}

  @Get()
  async getSourcePreferences(): Promise<SourcePreferenceResponseDto> {
    const preference = await this.sourcePreferencesService.getOrCreate()

    return {
      id: preference.id,
      userId: preference.userId,
      youtubeFilter: preference.youtubeFilter as YoutubeFilterType,
      blockedSites: preference.blockedSites,
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    }
  }

  @Put()
  async updateSourcePreferences(
    @Body() updateDto: UpdateSourcePreferenceDto,
  ): Promise<SourcePreferenceResponseDto> {
    const preference = await this.sourcePreferencesService.upsert(updateDto)

    return {
      id: preference.id,
      userId: preference.userId,
      youtubeFilter: preference.youtubeFilter as YoutubeFilterType,
      blockedSites: preference.blockedSites,
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    }
  }
}
