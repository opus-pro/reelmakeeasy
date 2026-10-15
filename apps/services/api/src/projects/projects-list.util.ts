import type { Prisma } from '@reelmakeeasy/api-db'
import { isStoreUri, storedFileUrl } from '@reelmakeeasy/common/storage/stored-files'
import type {
  ProjectEnv,
  ProjectForBackend,
  ProjectListSortType,
  ProjectSeenFilter,
  ProjectStageFilter,
  UipCardStatus,
} from '@shared/types/api/project'
import { PROJECT_SEEN_FILTER, PROJECT_STAGE_FILTER } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import { deriveBrandTelemetry } from '../uip/uip-brand-telemetry'
import { normalizeTimeline } from '../uip/uip-timeline-transformers'
import { parsePaginationConfig } from '../util/pagination'

import { applyProjectSeenFilter, buildCreatedAtDateFilter } from './projects-lifecycle.util'
import { rawCount } from './projects-raw-count.util'

// The lifecycle anchor columns (lifecycleStatus/expiresAt/lockedAt/hardDeleteAt/expiryPlanTier/
// purgedAt) and storageBytes/storageBytesUpdatedAt are internal: strip them from any client-facing
// project response. storageBytes is a BigInt -- if it reaches a client-facing full-row response it
// crashes JSON.stringify ("Do not know how to serialize a BigInt"), so it MUST be stripped here.
const LIFECYCLE_ANCHOR_FIELDS = [
  'expiresAt',
  'expiryPlanTier',
  'hardDeleteAt',
  'lifecycleStatus',
  'lockedAt',
  'purgedAt',
  'storageBytes',
  'storageBytesUpdatedAt',
] as const

export function stripLifecycleAnchorFields<T extends ProjectForBackend>(project: T): T {
  const next = { ...project } as Record<string, unknown>
  for (const field of LIFECYCLE_ANCHOR_FIELDS) {
    delete next[field]
  }
  return next as T
}

/**
 * Field selection for project list queries.
 * Only fetches fields needed by the list view, skipping heavy fields like
 * `script`, `brandkit`, `scenes`, `modelSwitch`, etc. `debugSettings` is a
 * small flag object and IS selected: the web card reads
 * `debugSettings.transitionVideoModel` for download tracking.
 */
export const PROJECT_LIST_SELECT = {
  id: true,
  name: true,
  stage: true,
  // The card's "Agent" tag and its "Open chat" item (agent mode).
  agentSessionId: true,
  createdVia: true,
  // BGM state for the card's project.downloaded tracking (has_bgm /
  // music_model / bgm_regenerated). Scalars plus bgmVersions -- bounded in
  // practice: each entry is a user-triggered regenerate.
  // bgmRun + processingSeenAt drive the card status pill.
  bgmBedCdnUrl: true,
  bgmEnabled: true,
  bgmModel: true,
  bgmRun: true,
  bgmVersions: true,
  bgmVolume: true,
  createdAt: true,
  processingSeenAt: true,
  debugSettings: true,
  duration: true,
  updatedAt: true,
  isLongTake: true,
  isUip: true,
  isDeleted: true,
  modelSelectorTier: true,
  orgId: true,
  owner: true,
  ownerEmail: true,
  previewThumbnail: true,
  resultVideo: true,
  resultVideoThumbnail: true,
  // 4K export state for the card's status badge.
  // upscale4k answers "complete": the finalize activity writes variantKeys, and
  // a variant key IS the record that a 4K file exists. It does NOT answer
  // "processing" - despite the shape allowing workflowId/completedAt, finalize
  // writes neither - so upscale4kRun carries the in-flight state, the same way
  // bgmRun does above. Both are small bounded sub-documents, and neither costs
  // a per-card request.
  upscale4k: true,
  upscale4kRun: true,
  // The card's 4K DOWNLOAD needs more than the badge's "a variant exists".
  // Without these three the grid's submenu could never reach the
  // `ready` phase, so the free re-download was dead from /projects: the click
  // fell through to the POST, whose variantReady branch only downloads when the
  // client already holds a url - it did not - so nothing downloaded, nothing
  // was tracked, and export_4k_confirmed fired for a re-download
  // that never happened.
  //
  // enableCaption is load-bearing for the same reason and one step worse: with
  // it absent, resolve4kCaptionEnabled falls back to the legacy
  // `enableCaption !== false` rule and calls EVERY grid project captioned, so a
  // captions-off export started here recorded the wrong variant slot on its
  // ownership grant and the auto-deliverer waited on `captioned` for a run that
  // only ever fills `nocaption` - the file was never handed over at all.
  //
  // Three scalars on a payload that already carries resultVideo and both
  // upscale4k sub-documents; no extra query.
  enableCaption: true,
  resultVideo4k: true,
  resultVideo4kNocaption: true,
  watermarkVideo: true,
  style: true,
  env: true,
  rerunFrom: true,
  rerunTo: true,
  initPrompt: true,
  userId: true,
  voiceOverJson: true,
  lifecycleStatus: true,
  expiresAt: true,
  hardDeleteAt: true,
  purgedAt: true,
} as const satisfies Prisma.ProjectSelect

// Narrow type for the UipSession fields read during enrichment.
export interface ProjectListDeps {
  prisma: UipSessionPrisma & {
    project: {
      findMany: (args: unknown) => Promise<unknown[]>
    }
  }
}

type UipSessionPrisma = {
  uipSession: {
    findMany: (args: {
      select: { phase: true; projectId: true; state: true; status: true }
      where: { projectId: { in: string[] } }
    }) => Promise<{ phase: null | string; projectId: string; state: unknown; status: string }[]>
  }
}

type UipStateFields = {
  is_idle?: boolean
  is_running_planner_loop?: boolean
  phase?: string
  review_gate?: {
    token?: string
  }
}

// Narrow type for the UipSession fields read during brand-video enrichment.
type BrandVideoSessionPrisma = {
  uipSession: {
    findMany: (args: {
      select: { projectId: true; timeline: true }
      where: { projectId: { in: string[] } }
    }) => Promise<{ projectId: string; timeline: unknown }[]>
  }
}

/**
 * Derives and attaches UipCardStatus to each UIP_PLANNING project in the list.
 * Skips the DB call entirely when no UIP_PLANNING+isUip projects are present.
 */
export async function enrichWithUipStatus(
  prisma: UipSessionPrisma,
  projects: ProjectForBackend[],
): Promise<void> {
  const uipIds = projects
    .filter((p) => p.isUip === true && p.stage === PROJECT_STAGE.UIP_PLANNING)
    .map((p) => p.id)

  if (uipIds.length === 0) {
    return
  }

  const sessions = await prisma.uipSession.findMany({
    select: { phase: true, projectId: true, state: true, status: true },
    where: { projectId: { in: uipIds } },
  })

  const statusMap = new Map<string, UipCardStatus>()
  for (const row of sessions) {
    if (row.status !== 'active') {
      continue
    }
    const s = row.state as null | UipStateFields | undefined
    const phase = row.phase ?? (typeof s?.phase === 'string' ? s.phase : null)
    const thinking = s?.is_running_planner_loop === true
    // is_idle alone is not user-actionable: it is also true while the workflow
    // is parked waiting on an internal child step (bootstrap/refinement). Only an
    // open review gate, or an awaiting clarify in mode_confirmation, means the user must act.
    const needsInput =
      Boolean(s?.review_gate?.token) || (phase === 'mode_confirmation' && s?.is_idle === true)
    statusMap.set(row.projectId, { needsInput, phase, thinking })
  }

  for (const project of projects) {
    const status = statusMap.get(project.id)
    if (status !== undefined) {
      project.uip = status
    }
  }
}

/**
 * Derives and attaches isBrandVideo to every project in the list, from the
 * same uip session source as the single-project /metadata endpoint
 * (deriveProjectIsBrandVideo in projects-query.util.ts). Every project is
 * stamped `false` up front -- a project with no uip session is never a brand
 * video, matching deriveProjectIsBrandVideo's semantics -- then isUip
 * projects are overwritten with their derived value from the batched query.
 * The false-stamping happens even when the DB call is skipped (no isUip
 * projects present). A malformed/legacy timeline shape is defended with a
 * try/catch so one bad row can't reject the whole batch and 500 the grid.
 */
export async function enrichWithBrandVideo(
  prisma: BrandVideoSessionPrisma,
  projects: ProjectForBackend[],
): Promise<void> {
  for (const project of projects) {
    project.isBrandVideo = false
  }

  const uipIds = projects.filter((p) => p.isUip === true).map((p) => p.id)

  if (uipIds.length === 0) {
    return
  }

  const sessions = await prisma.uipSession.findMany({
    select: { projectId: true, timeline: true },
    where: { projectId: { in: uipIds } },
  })

  const brandVideoMap = new Map<string, boolean>()
  for (const row of sessions) {
    let isBrandVideo = false
    try {
      isBrandVideo = row.timeline
        ? deriveBrandTelemetry(normalizeTimeline(row.timeline)).isBrandVideo
        : false
    } catch {
      isBrandVideo = false
    }
    brandVideoMap.set(row.projectId, isBrandVideo)
  }

  for (const project of projects) {
    if (project.isUip === true) {
      project.isBrandVideo = brandVideoMap.get(project.id) ?? false
    }
  }
}

export async function listProjectsByOwnerQuery(
  deps: ProjectListDeps,
  {
    createdAfter,
    createdBefore,
    createdFrom,
    createdTo,
    env,
    seenFilter = PROJECT_SEEN_FILTER.ALL,
    stageFilter = PROJECT_STAGE_FILTER.ALL,
    isLongTake,
    orgId,
    userSub,
    page = 1,
    pageSize = 50,
    sort = 'createdAt',
    withCount = true,
  }: {
    createdAfter?: Date
    createdBefore?: Date
    createdFrom?: Date
    createdTo?: Date
    env?: ProjectEnv
    isLongTake?: boolean
    orgId?: string
    page?: number
    pageSize?: number
    seenFilter?: ProjectSeenFilter
    sort?: ProjectListSortType
    stageFilter?: ProjectStageFilter
    userEmail?: string
    userSub?: string
    withCount?: boolean
  } = {},
): Promise<{
  data: ProjectForBackend[]
  total: number
}> {
  const { skip, take } = parsePaginationConfig({ page, pageSize, maxPageSize: 200 })

  const where: Prisma.ProjectWhereInput = { isDeleted: false }
  if (userSub) {
    where.owner = userSub
  }
  if (orgId) {
    where.orgId = orgId
  }
  if (env) {
    where.env = env
  }
  applyIsLongTakeFilter(where, isLongTake)
  const createdAtFilter = buildCreatedAtDateFilter({
    createdAfter,
    createdBefore,
    createdFrom,
    createdTo,
  })
  if (createdAtFilter) {
    where.createdAt = createdAtFilter
  }
  applyProjectSeenFilter(where, { seenFilter, stageFilter })

  const getList = async () => {
    const data = (await deps.prisma.project.findMany({
      orderBy: { [sort]: 'desc' },
      select: PROJECT_LIST_SELECT,
      skip,
      take,
      where,
    })) as ProjectForBackend[]

    await enrichWithUipStatus(deps.prisma, data)
    await enrichWithBrandVideo(deps.prisma as unknown as BrandVideoSessionPrisma, data)
    return data.map((p) => normalizeProjectListItem(p))
  }

  const getCount = () => rawCount(deps.prisma.project, where as Record<string, unknown>)

  if (take === 0) {
    if (!withCount) {
      // withCount=false: total=-1 is an intentional placeholder, not real total size.
      return { data: [], total: -1 }
    }
    const total = await getCount()
    return { data: [], total }
  }

  if (!withCount) {
    const data = await getList()
    return { data, total: -1 }
  }

  const [data, total] = await Promise.all([getList(), getCount()])
  return { data, total }
}

export async function listProjectsQuery(
  deps: ProjectListDeps,
  options?: {
    createdAfter?: Date
    createdBefore?: Date
    createdFrom?: Date
    createdTo?: Date
    env?: ProjectEnv
    isLongTake?: boolean
    page?: number
    pageSize?: number
    seenFilter?: ProjectSeenFilter
    sort?: ProjectListSortType
    stageFilter?: ProjectStageFilter
    withCount?: boolean
  },
): Promise<{ data: ProjectForBackend[]; total: number }> {
  const defaultOptions = { page: 1, pageSize: 50 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { skip, take } = parsePaginationConfig({ ...mergedOptions, maxPageSize: 200 })

  const where: Prisma.ProjectWhereInput = { isDeleted: false }
  if (mergedOptions.env) {
    where.env = mergedOptions.env
  }
  applyIsLongTakeFilter(where, mergedOptions.isLongTake)
  const createdAtFilter = buildCreatedAtDateFilter(mergedOptions)
  if (createdAtFilter) {
    where.createdAt = createdAtFilter
  }
  applyProjectSeenFilter(where, {
    seenFilter: mergedOptions.seenFilter,
    stageFilter: mergedOptions.stageFilter,
  })

  const getList = async () =>
    (await deps.prisma.project.findMany({
      orderBy: { [mergedOptions.sort ?? 'createdAt']: 'desc' },
      select: PROJECT_LIST_SELECT,
      skip,
      take,
      where,
    })) as unknown as ProjectForBackend[]

  const getCount = () => rawCount(deps.prisma.project, where as Record<string, unknown>)

  if (take === 0) {
    if (mergedOptions.withCount === false) {
      // withCount=false: total=-1 is an intentional placeholder, not real total size.
      return { data: [], total: -1 }
    }
    const total = await getCount()
    return { data: [], total }
  }

  if (mergedOptions.withCount === false) {
    const data = await getList()
    // withCount=false: total=-1 is an intentional placeholder, not real total size.
    await enrichWithUipStatus(deps.prisma, data)
    return { data: data.map((p) => normalizeProjectListItem(p)), total: -1 }
  }

  const [data, total] = await Promise.all([getList(), getCount()])

  await enrichWithUipStatus(deps.prisma, data)
  return { data: data.map((p) => normalizeProjectListItem(p)), total }
}

export function normalizeProjectListItem<T extends ProjectForBackend>(project: T): T {
  const resultVideo = normalizeProjectListMediaUrl(project.resultVideo)
  const resultVideoThumbnail = normalizeProjectListMediaUrl(project.resultVideoThumbnail)
  const previewThumbnail = normalizeProjectListMediaUrl(project.previewThumbnail)
  const watermarkVideo = normalizeProjectListMediaUrl(project.watermarkVideo)
  // Stored as storage keys exactly like resultVideo above, so they need the
  // same rewrite: handing the card a raw store:// address gives the download anchor
  // an href the browser cannot fetch.
  const resultVideo4k = normalizeProjectListMediaUrl(project.resultVideo4k)
  const resultVideo4kNocaption = normalizeProjectListMediaUrl(project.resultVideo4kNocaption)

  const resolvedThumbnail =
    previewThumbnail ?? resultVideoThumbnail ?? deriveProjectListThumbnailUrl(resultVideo)

  return stripLifecycleAnchorFields({
    ...project,
    previewThumbnail: previewThumbnail ?? resolvedThumbnail,
    resultVideo,
    resultVideo4k,
    resultVideo4kNocaption,
    resultVideoThumbnail: resultVideoThumbnail ?? resolvedThumbnail,
    watermarkVideo,
  })
}

/** Also used by the agent chat list to normalize its sidebar thumbnail the same way
 *  (agent-session-list.ts). */
export function normalizeProjectListMediaUrl(url?: null | string): string | undefined {
  if (!url) {
    return undefined
  }
  if (!isStoreUri(url)) {
    return url
  }
  return storedFileUrl(url) ?? url
}

function appendWhereAndCondition(
  where: Prisma.ProjectWhereInput,
  condition: Prisma.ProjectWhereInput,
): void {
  if (!where.AND) {
    where.AND = [condition]
    return
  }

  where.AND = Array.isArray(where.AND) ? [...where.AND, condition] : [where.AND, condition]
}

function applyIsLongTakeFilter(
  where: Prisma.ProjectWhereInput,
  isLongTake: boolean | undefined,
): void {
  if (isLongTake === undefined) {
    return
  }

  if (isLongTake) {
    where.isLongTake = true
    return
  }

  appendWhereAndCondition(where, {
    OR: [{ isLongTake: false }, { isLongTake: null }, { isLongTake: { isSet: false } }],
  })
}

function deriveProjectListThumbnailUrl(resultVideo?: string): string | undefined {
  if (!resultVideo) {
    return undefined
  }

  const normalizedResultVideo = normalizeProjectListMediaUrl(resultVideo)
  if (!normalizedResultVideo || !normalizedResultVideo.endsWith('.mp4')) {
    return undefined
  }

  if (normalizedResultVideo.endsWith('/final_video.mp4')) {
    return normalizedResultVideo.replace(/\/final_video\.mp4$/, '/_thumbnail/final_video.mp4.jpg')
  }

  const lastSlashIndex = normalizedResultVideo.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return undefined
  }

  const directory = normalizedResultVideo.slice(0, lastSlashIndex)
  const fileName = normalizedResultVideo.slice(lastSlashIndex + 1)
  return `${directory}/_thumbnail/${fileName}.jpg`
}
