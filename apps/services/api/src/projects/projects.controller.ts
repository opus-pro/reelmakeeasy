import { Asset } from '@agent-lib/types/storyloader'
import { logger } from '@reelmakeeasy/common/logger'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { PaginatedResponse } from '@shared/types/api/common/pagination'
import {
  EnhancePromptBody,
  type EnhancePromptBodyType,
  type EnhancePromptResponseType,
} from '@shared/types/api/enhancer'
import {
  PROJECT_LIST_QUERY_TYPE,
  PROJECT_LIST_SORT_TYPE,
  ProjectCreateRequestBody,
  ProjectEnv,
  ProjectForBackend,
  ProjectListQueryType,
  ProjectListSortType,
  ProjectVoiceOverJson,
} from '@shared/types/api/project'

import { ProjectSceneService } from '../project-scene/projectScene.service'
import { applyUipSpecStyleFallback } from '../uip/uip-style-fallback.util'
import { parsePaginationConfig, toPaginationConfig } from '../util/pagination'
import {
  parseNonNegativeIntegerQuery,
  parsePositiveIntegerQuery,
  parseProjectListFilters,
} from '../util/project-list-query'

import { getProjectEnv } from './get-project-env'
import { deriveVoiceoverAudioUrl } from './project-media-url.util'
import { ProjectSearchService } from './project-search.service'
import { ProjectSearchFeatureGuard } from './project-search-feature.guard'
import { extractSearchSnippet } from './project-search-snippet'
import { ProjectService } from './projects.service'
import { normalizeProjectListItem, stripLifecycleAnchorFields } from './projects-list.util'

@Controller('project')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly projectSceneService: ProjectSceneService,
    private readonly projectSearchService: ProjectSearchService,
  ) {}

  private static parseOptionalBooleanQuery(name: string, value: string | undefined) {
    if (value === undefined) {
      return undefined
    }
    if (value === 'true') {
      return true
    }
    if (value === 'false') {
      return false
    }
    throw new BadRequestException(`${name} must be "true" or "false"`)
  }

  @Post()
  async createProject(@Body() body: ProjectCreateRequestBody): Promise<ProjectForBackend> {
    return stripLifecycleAnchorFields(await this.projectService.createProject(body))
  }

  @Post(':id/delete')
  async deleteProject(@Param('id') id: string): Promise<ProjectForBackend> {
    const deleted = await this.projectService.deleteProject(id, {
      sub: getReqContext().login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email,
      orgId: getReqContext().org_id,
    } as UserInfo)
    return stripLifecycleAnchorFields(deleted)
  }

  /**
   * Enhance user prompt
   * POST /project/enhance-prompt
   *
   * @param body - Request body containing the prompt to enhance
   * @returns Enhanced prompt
   */
  @Post('enhance-prompt')
  async enhancePrompt(@Body() body: EnhancePromptBodyType): Promise<EnhancePromptResponseType> {
    const parseResult = EnhancePromptBody.safeParse(body)
    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error.errors[0]?.message || 'Invalid request body')
    }
    const enhancedPrompt = await this.projectService.enhancePrompt(parseResult.data.prompt)
    return { enhancedPrompt }
  }

  @Get('system/defaults/voice')
  async getDefaultVoice() {
    return this.projectService.getDefaultVoice()
  }

  @Get(':id')
  async getProject(
    @Param('id') id: string,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
  ): Promise<null | ProjectForBackend> {
    let project: null | ProjectForBackend = null

    // from shared project
    if (headerShareId) {
      project = await this.projectService.getProjectWithShareId(id, headerShareId)
    } else {
      project = await this.resolveProjectAccess(id)
    }

    // Unified check for deleted projects
    if (!project || project.isDeleted) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }

    // Failed/canceled (and other pre-confirm) projects never persisted their
    // selected style to the row, so a remix would carry no style.
    // Recover it from the durable UIP spec; no-op when a style is already set.
    project = await applyUipSpecStyleFallback(project)

    // Derive the voice-over URL here rather than letting the browser
    // assemble it.
    project = { ...project, voiceoverAudioUrl: deriveVoiceoverAudioUrl(id) }

    // Strip the internal lifecycle anchor columns before they reach the client.
    return stripLifecycleAnchorFields(project)
  }

  @Get(':id/assets')
  async getProjectAssets(@Param('id') id: string): Promise<Asset[]> {
    return this.projectService.getProjectAssets(id)
  }

  @Get(':id/metadata')
  async getProjectMetadata(
    @Param('id') id: string,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
  ) {
    // Verify project access
    let project: null | ProjectForBackend = null
    if (headerShareId) {
      project = await this.projectService.getProjectWithShareId(id, headerShareId)
    } else {
      project = await this.resolveProjectAccess(id)
    }

    if (!project || project.isDeleted) {
      throw new NotFoundException(`Project with ID ${id} not found`)
    }

    return this.projectService.getProjectMetadata(id)
  }

  /**
   * Scene rows for the editor canvas.
   *
   * The check here authorized the CALLER without ever binding them to
   * THIS project -- "signed in, or presenting some share id" -- so any signed-in
   * user could read any org's scene list by id. `canVisitProject` is the same
   * owner / same-org / valid-share check the sibling media routes use, and
   * share-link viewers keep working because the share id it takes is the one they
   * already send.
   *
   * The denial is 404 rather than 403 because project ids are short enough to
   * enumerate, so a distinguishable response is an existence oracle.
   */
  @Get(':id/scene')
  async getSceneList(
    @Param('id') projectId: string,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
    @Query('shareId') shareId?: string,
  ) {
    if (!(await this.projectService.canVisitProject(projectId, headerShareId ?? shareId))) {
      throw new NotFoundException(`Project with ID ${projectId} not found`)
    }
    return this.projectSceneService.getSceneList(projectId)
  }

  @Get(':id/download-url')
  async getVideoDownloadUrl(
    @Param('id') projectId: string,
    @Query('lipSync') lipSync: string | undefined,
    @Query('watermark') watermark: string,
  ): Promise<{ filename: string; url: string }> {
    return this.projectService.generateVideoDownloadUrl(
      projectId,
      watermark === 'true',
      ProjectController.parseOptionalBooleanQuery('lipSync', lipSync),
      getReqContext().user_id,
    )
  }

  @Get(':id/video-script')
  async getVideoScript(@Param('id') id: string): Promise<VideoScript> {
    return this.projectService.getProjectVideoScript(id)
  }

  @Get()
  @UseGuards(ProjectSearchFeatureGuard)
  async listProjects(
    @Query('q') queryType?: ProjectListQueryType,
    @Query('user') userSub?: string,
    @Query('env') env?: ProjectEnv,
    // Pagination:
    // - page: positive integer, 1-based.
    // - pageSize: non-negative integer; 0 is allowed for count-only requests
    //   (skip list payload, return pagination/total only).
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
    @Query('sort') sort: ProjectListSortType = PROJECT_LIST_SORT_TYPE.CREATED_AT,
    // Time filters (ISO date-time string):
    // - createdFrom => createdAt >= createdFrom  (inclusive lower bound)
    // - createdTo => createdAt <= createdTo      (inclusive upper bound)
    // - createdAfter => createdAt > createdAfter (exclusive lower bound)
    // - createdBefore => createdAt < createdBefore (exclusive upper bound)
    // Note: filters are combined with AND; if both ends are set, lower bound must be <= upper bound.
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('createdBefore') createdBefore?: string,
    // Stage filter: optional enum value from PROJECT_STAGE_FILTER; defaults to ALL.
    @Query('stageFilter') stageFilter?: string,
    @Query('seenFilter') seenFilter?: string,
    @Query('withCount') withCount?: string,
    @Query('isLongTake') isLongTake?: string,
    @Query('search') search?: string,
    @Req() req?: { searchEnabled?: boolean },
  ): Promise<PaginatedResponse<ProjectForBackend>> {
    const validatedPage = parsePositiveIntegerQuery('page', page, 1)
    const validatedPageSize = parseNonNegativeIntegerQuery('pageSize', pageSize, 50)
    const { page: pageNumber, pageSize: pageSizeNumber } = parsePaginationConfig({
      page: validatedPage,
      pageSize: validatedPageSize,
      maxPageSize: 100,
    })
    env = env || getProjectEnv()

    const trimmedSearch = (search ?? '').trim()
    if (req?.searchEnabled && trimmedSearch.length > 0) {
      return this.runProjectSearch(trimmedSearch, pageNumber, pageSizeNumber, () =>
        this.projectService.listProjectsByOwner({
          page: pageNumber,
          pageSize: pageSizeNumber,
          orgId: getReqContext().org_id,
          // eslint-disable-next-line @nx/workspace-no-pii-field-access
          userEmail: getReqContext().pii?.email,
        }),
      )
    }

    if (queryType === PROJECT_LIST_QUERY_TYPE.BY_USER && !userSub) {
      throw new BadRequestException('userSub is required')
    }

    let result: { data: ProjectForBackend[]; total: number } = { data: [], total: 0 }
    const {
      createdAtFilter,
      isLongTake: parsedIsLongTake,
      stageFilter: parsedStageFilter,
      seenFilter: parsedSeenFilter,
      withCount: parsedWithCount,
    } = parseProjectListFilters({
      createdAfter,
      createdBefore,
      createdFrom,
      createdTo,
      seenFilter,
      stageFilter,
      withCount,
      isLongTake,
    })

    const commonOpts = {
      page: pageNumber,
      pageSize: pageSizeNumber,
      env,
      sort,
      ...createdAtFilter,
      seenFilter: parsedSeenFilter,
      stageFilter: parsedStageFilter,
      withCount: parsedWithCount,
      isLongTake: parsedIsLongTake,
    } as const

    if (queryType === PROJECT_LIST_QUERY_TYPE.ME) {
      result = await this.projectService.listProjectsByOwner({
        ...commonOpts,
        orgId: getReqContext().org_id,
        // eslint-disable-next-line @nx/workspace-no-pii-field-access
        userEmail: getReqContext().pii?.email,
      })
    } else if (queryType === PROJECT_LIST_QUERY_TYPE.BY_USER) {
      result = await this.projectService.listProjectsByOwner({
        ...commonOpts,
        userSub,
      })
    } else if (queryType === PROJECT_LIST_QUERY_TYPE.STORY_MODE) {
      result = await this.projectService.listProjects({
        ...commonOpts,
        isLongTake: true,
      })
    } else {
      result = await this.projectService.listProjects({
        ...commonOpts,
      })
    }

    return {
      data: result.data,
      pagination: toPaginationConfig({
        skip: (pageNumber - 1) * pageSizeNumber,
        take: pageSizeNumber,
        total: result.total,
      }),
    }
  }

  @Post('mark-seen')
  async markSeen(
    @Body() body: { ids?: string[] },
  ): Promise<{ changedCount: number; skippedCount: number }> {
    return this.projectService.markProjectsSeen(body.ids ?? [], getReqContext().org_id)
  }

  @Put(':id/name')
  async renameProject(
    @Param('id') id: string,
    @Body() body: { name: string },
  ): Promise<ProjectForBackend> {
    return stripLifecycleAnchorFields(
      await this.projectService.renameProject(id, getReqContext().org_id, body.name),
    )
  }

  @Put('system/defaults/voice')
  async setDefaultVoice(@Body() voiceConfig: ProjectVoiceOverJson) {
    return this.projectService.setDefaultVoice(voiceConfig)
  }

  @Put(':id')
  async updateProject(
    @Param('id') id: string,
    @Body() body: ProjectCreateRequestBody,
  ): Promise<ProjectForBackend> {
    return stripLifecycleAnchorFields(
      await this.projectService.updateProject(id, getReqContext().org_id, body),
    )
  }

  /**
   * Resolve project access for the current user. ReelMakeEasy is single-user, so
   * every project on the instance is readable.
   */
  private async resolveProjectAccess(id: string): Promise<null | ProjectForBackend> {
    return this.projectService.getProject(id)
  }

  private async runProjectSearch(
    search: string,
    page: number,
    pageSize: number,
    fallbackToOwnerList: () => Promise<{ data: ProjectForBackend[]; total: number }>,
  ): Promise<PaginatedResponse<ProjectForBackend> & { searchDegraded?: boolean }> {
    if (search.length > 200) {
      throw new BadRequestException('SEARCH_QUERY_TOO_LONG')
    }
    const ownerId = getReqContext().login_id ?? ''
    try {
      const searchResult = await this.projectSearchService.search({
        ownerId,
        search,
        page,
        pageSize,
      })
      const projects = await this.projectSearchService.findProjectsByIds(
        searchResult.items.map((i) => i.projectId),
      )
      const byId = new Map(projects.map((p) => [p.id, p]))
      const data: ProjectForBackend[] = []
      for (const item of searchResult.items) {
        const project = byId.get(item.projectId)
        if (!project) {
          continue
        }
        const snippet = extractSearchSnippet({
          matchedField: item.matchedField,
          nameText: project.name ?? '',
          initPromptText: project.initPrompt ?? '',
          scriptText: project.script ?? '',
          query: search,
        })
        // Drop the heavy `script` from the response payload; the regular list
        // pipeline (PROJECT_LIST_SELECT) excludes it for the same reason.
        // The snippet (extracted above) is what callers should render instead.
        const { script: _script, ...projectForList } = project
        data.push({
          ...projectForList,
          searchMeta: {
            score: item.score,
            matchedField: item.matchedField,
            snippet,
          },
        })
      }
      // Same contract as the non-search owner list: normalizeProjectListItem, not a
      // bare strip, so the SAME project hands back the same urls from the list and
      // from search. It strips the lifecycle anchors itself.
      const normalizedData = data.map((p) => normalizeProjectListItem(p))
      return {
        data: normalizedData,
        pagination: toPaginationConfig({
          skip: (page - 1) * pageSize,
          take: pageSize,
          total: searchResult.total,
        }),
      }
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error({
        event: 'project_search.query_failed',
        errorType,
        errorMessage,
        searchLength: search.length,
      })
      const fallback = await fallbackToOwnerList()
      return {
        data: fallback.data,
        pagination: toPaginationConfig({
          skip: (page - 1) * pageSize,
          take: pageSize,
          total: fallback.total,
        }),
        searchDegraded: true,
      }
    }
  }
}

export function bucketQueryLength(length: number): '1-3' | '4-10' | '11+' {
  if (length <= 3) {
    return '1-3'
  }
  if (length <= 10) {
    return '4-10'
  }
  return '11+'
}

export function bucketResultCount(count: number): '0' | '1-10' | '11+' {
  if (count === 0) {
    return '0'
  }
  if (count <= 10) {
    return '1-10'
  }
  return '11+'
}
