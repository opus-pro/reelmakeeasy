import fs from 'node:fs'

import { presetPackUrl, presetPath } from '@reelmakeeasy/common/storage/presets'
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common'
import type { PaginatedResponse } from '@shared/types/api/common/pagination'
import type { DemoProject } from '@shared/types/api/demo-project'

const DEMOS_FILE = 'story-mode/demos.json'

/** Pack-relative paths become URLs; anything else (null, '') passes through. */
const packUrl = <T extends null | string | undefined>(value: T): T =>
  (value ? presetPackUrl(value) : value) as T

function loadDemos(): DemoProject[] {
  const { demos } = JSON.parse(fs.readFileSync(presetPath(DEMOS_FILE), 'utf8')) as {
    demos: DemoProject[]
  }
  return demos
    .filter((demo) => demo.isActive)
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || String(b.createdAt).localeCompare(String(a.createdAt)),
    )
    .map(withUrls)
}

function withUrls(demo: DemoProject): DemoProject {
  return {
    ...demo,
    assets: demo.assets.map((asset) => ({ ...asset, url: packUrl(asset.url) })),
    audioUrl: packUrl(demo.audioUrl),
    resultVideo: packUrl(demo.resultVideo),
    styleThumbnailUrl: packUrl(demo.styleThumbnailUrl),
    thumbnail: packUrl(demo.thumbnail),
    ...(demo.voiceOverJson?.previewAudioUrl
      ? {
          voiceOverJson: {
            ...demo.voiceOverJson,
            previewAudioUrl: packUrl(demo.voiceOverJson.previewAudioUrl),
          },
        }
      : {}),
  }
}

/**
 * The home page demo gallery, read from `presets/story-mode/demos.json` with
 * media in the preset pack. Same query shape as the hosted API it replaces.
 */
@Controller('demo-projects')
export class DemoProjectsController {
  @Get(':projectId')
  get(@Param('projectId') projectId: string): DemoProject {
    const demo = loadDemos().find((d) => d.projectId === projectId)
    if (!demo) throw new NotFoundException('Demo project not found')
    return demo
  }

  @Get()
  list(
    @Query()
    query: {
      fields?: string
      goal?: string
      industry?: string
      page?: string
      projectId?: string
      projectType?: string
      q?: string
      size?: string
      useCase?: string
    },
  ): PaginatedResponse<DemoProject> {
    if (query.q !== 'findByProjectType') throw new BadRequestException('Invalid query parameter')
    if (!query.projectType) throw new BadRequestException('projectType is required')
    const fields = query.fields?.trim()
    if (fields && fields !== 'card')
      throw new BadRequestException(`Unsupported fields value: ${fields}`)
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.size ?? '20', 10) || 20))

    const matches = loadDemos().filter(
      (d) =>
        d.projectType === query.projectType &&
        (!query.projectId || d.projectId === query.projectId) &&
        (!query.useCase || d.useCases.includes(query.useCase)) &&
        (!query.goal || d.goals.includes(query.goal)) &&
        (!query.industry || d.industries.includes(query.industry)),
    )
    const data = matches
      .slice((page - 1) * pageSize, page * pageSize)
      // Cards never render the prompt or transcript; the detail route has them.
      .map((d) => (fields === 'card' ? { ...d, initPrompt: '', transcript: null } : d))

    return {
      data,
      pagination: {
        page,
        pageSize,
        pageTotal: Math.ceil(matches.length / pageSize),
        total: matches.length,
      },
    }
  }
}
