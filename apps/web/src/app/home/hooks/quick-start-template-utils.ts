import type { PaginatedResponse } from '@shared/types/api/common/pagination'
import type { DemoProject } from '@shared/types/api/demo-project'
import type { QuickStartProjectType, QuickStartTemplate } from '@shared/types/assets/quick-start'
import { ProjectInputType } from '@shared/types/enums/project'

import type { FetchOptions, FetchResponse } from '@/hooks/useApi'
import { MAX_DEMO_PROJECT_PAGES } from '@/util/demo-input-type'

const DEFAULT_TIMESTAMP = new Date(0).toISOString()

type DemoProjectListParams = {
  // 'card' drops the long-form text no gallery card renders. Callers that opt
  // in must hydrate before showing or reusing it (useHydratedDemoTemplate).
  fields?: 'card'
  goal?: string
  industry?: string
  page?: number
  pageSize?: number
  projectId?: string
  projectType: QuickStartProjectType
  useCase?: string
}

type FetchApiDomain = <ResData>(
  url: string,
  options?: FetchOptions,
) => Promise<FetchResponse<ResData>>

const EMPTY_PAGINATED_RESPONSE = (pageSize = 20): PaginatedResponse<DemoProject> => ({
  data: [],
  pagination: { page: 1, pageSize, pageTotal: 0, total: 0 },
})

export async function fetchAllDemoProjects(
  fetchApiDomain: FetchApiDomain,
  params: DemoProjectListParams,
): Promise<DemoProject[]> {
  const firstPage = await fetchDemoProjectsPage(fetchApiDomain, { ...params, page: 1 })
  const pageTotal = Math.min(firstPage.pagination?.pageTotal ?? 1, MAX_DEMO_PROJECT_PAGES)

  if (pageTotal <= 1) {
    return firstPage.data ?? []
  }

  const remainingPages = await Promise.all(
    Array.from({ length: pageTotal - 1 }, (_, index) =>
      fetchDemoProjectsPage(fetchApiDomain, { ...params, page: index + 2 }),
    ),
  )

  return [firstPage, ...remainingPages].flatMap((page) => page.data ?? [])
}

export async function fetchDemoProjectsPage(
  fetchApiDomain: FetchApiDomain,
  {
    fields,
    goal,
    industry,
    page = 1,
    pageSize = 20,
    projectId,
    projectType,
    useCase,
  }: DemoProjectListParams,
): Promise<PaginatedResponse<DemoProject>> {
  const queryParams = new URLSearchParams({
    page: String(page),
    projectType,
    q: 'findByProjectType',
    size: String(pageSize),
  })

  if (fields) {
    queryParams.set('fields', fields)
  }
  if (useCase) {
    queryParams.set('useCase', useCase)
  }
  if (goal) {
    queryParams.set('goal', goal)
  }
  if (industry) {
    queryParams.set('industry', industry)
  }
  if (projectId) {
    queryParams.set('projectId', projectId)
  }

  const response = await fetchApiDomain<PaginatedResponse<DemoProject>>(
    `/api/demo-projects?${queryParams.toString()}`,
  )

  return response.data || EMPTY_PAGINATED_RESPONSE(pageSize)
}

export function isStoryModeQuickStartTemplate(
  template: Pick<QuickStartTemplate, 'inputType' | 'projectType'>,
): boolean {
  return template.projectType === 'STORY_MODE' || template.inputType === ProjectInputType.S2V
}

export function mapDemoProjectsToQuickStartTemplates(
  demoProjects: DemoProject[],
): QuickStartTemplate[] {
  return demoProjects.map(mapDemoProjectToQuickStartTemplate)
}

export function mapDemoProjectToQuickStartTemplate(demoProject: DemoProject): QuickStartTemplate {
  const transcript =
    getNonEmptyString(demoProject.transcript) ??
    getNonEmptyString(demoProject.s2vLandingPageMeta?.transcript)
  const sourceProjectId = getNonEmptyString(demoProject.sourceProjectId) ?? demoProject.projectId
  const sourceUserId = getNonEmptyString(demoProject.sourceUserId) ?? ''
  const previewVideo = resolveDemoProjectPreviewVideo(demoProject)
  const resultVideo = resolveDemoProjectResultVideo(demoProject)
  const thumbnail = resolveDemoProjectThumbnail(demoProject)

  const templateBase = {
    aspectRatio:
      (demoProject.aspectRatio as '1:1' | '9:16' | '16:9') ??
      (demoProject.projectType === 'STORY_MODE' ? ('9:16' as const) : undefined),
    assets: demoProject.assets ?? [],
    audioUrl: demoProject.audioUrl ?? null,
    createdAt: toTimestamp(demoProject.createdAt),
    description: demoProject.description,
    displayOrder: demoProject.displayOrder,
    goals: demoProject.goals ?? [],
    // Carry the MongoDB model snapshot through verbatim (keep null vs undefined
    // distinct) so the detail page can render the badges instantly instead of
    // waiting on a live project fetch. `transitionVideoModel` is exposed as
    // `videoModel` to match the ModelBadges/DetailPanel prop name.
    imageModel: demoProject.imageModel,
    industries: demoProject.industries ?? [],
    initPrompt: demoProject.initPrompt,
    inputType: getTemplateInputType(demoProject),
    isActive: demoProject.isActive,
    motionDescription: demoProject.motionDescription,
    previewVideo,
    projectId: demoProject.projectId,
    resultVideo,
    s2vLandingPageMeta: demoProject.s2vLandingPageMeta,
    shotDescription: demoProject.shotDescription,
    source: demoProject.source,
    sourceProjectId,
    sourceUserId,
    styleText: demoProject.styleText,
    styleName: demoProject.styleName,
    styleThumbnailUrl: demoProject.styleThumbnailUrl,
    styleDescription: demoProject.styleDescription,
    thumbnail,
    title: getTemplateTitle(demoProject),
    transcript,
    updatedAt: toTimestamp(demoProject.updatedAt),
    useCases: demoProject.useCases ?? [],
    videoModel: demoProject.transitionVideoModel,
    voiceOverJson: demoProject.voiceOverJson ?? null,
  }

  return {
    ...templateBase,
    presetId: demoProject.presetId ?? undefined,
    projectType: demoProject.projectType,
  }
}

function getNonEmptyString(value: null | string | undefined): null | string {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getStoryModeTitle(demoProject: DemoProject): string {
  return (
    getNonEmptyString(demoProject.title) ??
    getNonEmptyString(demoProject.description) ??
    getNonEmptyString(demoProject.initPrompt) ??
    'Untitled'
  )
}

function getTemplateInputType(demoProject: DemoProject): string {
  const explicitInputType = getNonEmptyString(demoProject.inputType)
  if (explicitInputType) {
    return explicitInputType
  }

  if (demoProject.projectType === 'STORY_MODE') {
    return ProjectInputType.S2V
  }

  return ProjectInputType.A2V
}

function getTemplateTitle(demoProject: DemoProject): string {
  if (demoProject.projectType === 'STORY_MODE') {
    return getStoryModeTitle(demoProject)
  }

  return (
    getNonEmptyString(demoProject.title) ??
    getNonEmptyString(demoProject.description) ??
    getNonEmptyString(demoProject.initPrompt) ??
    'Untitled'
  )
}

// Demo media all comes from the preset pack, whose video is small enough to
// double as the card's hover preview.
function resolveDemoProjectPreviewVideo(demoProject: DemoProject): null | string {
  return resolveDemoProjectResultVideo(demoProject)
}

function resolveDemoProjectResultVideo(demoProject: DemoProject): string {
  return demoProject.resultVideo
}

function resolveDemoProjectThumbnail(demoProject: DemoProject): string {
  return demoProject.thumbnail
}

function toTimestamp(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  const normalized = getNonEmptyString(value)
  return normalized ?? DEFAULT_TIMESTAMP
}
