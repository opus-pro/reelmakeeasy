import { SourcePreference } from '@reelmakeeasy/api-db'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

import { UpdateSourcePreferenceDto, YoutubeFilterType } from './source-preferences.dto'

@Injectable()
export class SourcePreferencesService {
  constructor(private prisma: PrismaService) {}

  async create(): Promise<SourcePreference> {
    return this.prisma.sourcePreference.create({
      data: {
        orgId: getReqContext().org_id,
        userId: getReqContext().login_id,
        youtubeFilter: YoutubeFilterType.ALL,
        blockedSites: [],
      },
    })
  }

  async findByOrgId(): Promise<null | SourcePreference> {
    return this.prisma.sourcePreference.findUnique({
      where: { orgId: getReqContext().org_id },
    })
  }

  async getOrCreate(): Promise<SourcePreference> {
    const existing = await this.findByOrgId()
    if (existing) {
      return existing
    }
    return this.create()
  }

  async upsert(updateDto: UpdateSourcePreferenceDto): Promise<SourcePreference> {
    return this.prisma.sourcePreference.upsert({
      where: { orgId: getReqContext().org_id },
      update: {
        youtubeFilter: updateDto.youtubeFilter,
        blockedSites: updateDto.blockedSites,
        updatedAt: new Date(),
      },
      create: {
        orgId: getReqContext().org_id,
        userId: getReqContext().login_id,
        youtubeFilter: updateDto.youtubeFilter ?? YoutubeFilterType.ALL,
        blockedSites: updateDto.blockedSites ?? [],
      },
    })
  }
}
