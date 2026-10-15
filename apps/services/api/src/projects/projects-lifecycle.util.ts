import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'

import { FileHub } from '@agent-lib/agents/common/file-hub'
import { Prisma } from '@reelmakeeasy/api-db'
import { MemoryStorage } from '@reelmakeeasy/common/agent/memory/storage'
import { STORYBOARD_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { pushOrgProjectEvent } from '@reelmakeeasy/common/sse/org-project-event'
import { toSavedAddresses } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  downloadStoredFile,
  storedFileExists,
  storedFileSize,
  storeUri,
  workspaceUri,
  workspaceUrl,
} from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import {
  PROJECT_SEEN_FILTER,
  PROJECT_STAGE_FILTER,
  ProjectSeenFilter,
  ProjectStage,
  ProjectStageFilter,
  ProjectVoiceOverJson,
} from '@shared/types/api/project'
import { PROJECT_STAGE, STALE_IN_PROGRESS_THRESHOLD_MS } from '@shared/types/enums/project'

import type { PrismaService } from '../prisma/prisma.service'
import { defaultVoiceOption } from '../voice-over/voice-over'

type CreatedAtFilterOptions = {
  createdAfter?: Date
  createdBefore?: Date
  createdFrom?: Date
  createdTo?: Date
}

export const PROJECT_TERMINAL_STAGES: ProjectStage[] = [
  PROJECT_STAGE.CANCELED,
  PROJECT_STAGE.EDITOR,
  PROJECT_STAGE.FAILED,
  PROJECT_STAGE.FINISHED,
]

export function applyProjectSeenFilter(
  where: Prisma.ProjectWhereInput,
  {
    seenFilter = PROJECT_SEEN_FILTER.ALL,
    stageFilter = PROJECT_STAGE_FILTER.ALL,
  }: {
    seenFilter?: ProjectSeenFilter
    stageFilter?: ProjectStageFilter
  } = {},
): void {
  if (seenFilter === PROJECT_SEEN_FILTER.ALL) {
    applyProjectStageFilter(where, stageFilter)
    return
  }

  if (stageFilter === PROJECT_STAGE_FILTER.ONGOING) {
    where.stage = { notIn: PROJECT_TERMINAL_STAGES }
    appendOngoingFreshnessFloor(where)
    return
  }

  if (stageFilter === PROJECT_STAGE_FILTER.NON_ONGOING) {
    where.stage = { in: PROJECT_TERMINAL_STAGES }
    where.OR = [{ lastSeenAt: null }, { lastSeenAt: { isSet: false } }]
    return
  }

  // The non-terminal leg carries the same freshness floor as ONGOING so the
  // notification badge's allTotal and ongoingTotal age out the same stale
  // projects (a stale project must not migrate to the "done" side of the
  // badge). The terminal leg stays unfloored: old unseen finished projects
  // still count.
  where.OR = [
    { createdAt: { gte: ongoingFreshnessFloor() }, stage: { notIn: PROJECT_TERMINAL_STAGES } },
    {
      AND: [
        { stage: { in: PROJECT_TERMINAL_STAGES } },
        { OR: [{ lastSeenAt: null }, { lastSeenAt: { isSet: false } }] },
      ],
    },
  ]
}

export function applyProjectStageFilter(
  where: Prisma.ProjectWhereInput,
  stageFilter: ProjectStageFilter = PROJECT_STAGE_FILTER.ALL,
): void {
  if (stageFilter === PROJECT_STAGE_FILTER.ALL) {
    return
  }

  where.stage =
    stageFilter === PROJECT_STAGE_FILTER.ONGOING
      ? { notIn: PROJECT_TERMINAL_STAGES }
      : { in: PROJECT_TERMINAL_STAGES }
  if (stageFilter === PROJECT_STAGE_FILTER.ONGOING) {
    appendOngoingFreshnessFloor(where)
  }
}

export function buildCreatedAtDateFilter(
  options: CreatedAtFilterOptions,
): null | Prisma.DateTimeFilter {
  const createdAtFilter: Prisma.DateTimeFilter = {}
  if (options.createdFrom) {
    createdAtFilter.gte = options.createdFrom
  }
  if (options.createdTo) {
    createdAtFilter.lte = options.createdTo
  }
  if (options.createdAfter) {
    createdAtFilter.gt = options.createdAfter
  }
  if (options.createdBefore) {
    createdAtFilter.lt = options.createdBefore
  }

  return Object.keys(createdAtFilter).length > 0 ? createdAtFilter : null
}

export function isProjectTerminalStage(stage: null | ProjectStage | undefined): boolean {
  return !!stage && PROJECT_TERMINAL_STAGES.includes(stage)
}

/**
 * ONGOING means "work may still be in flight". A non-terminal project older than
 * the staleness threshold is permanently stuck (its writer is gone; nothing
 * self-heals it), so it must not count as ongoing anywhere the filter
 * is used (activity pill rows and count, MCP listings). Appended as an AND
 * condition because callers may already carry their own createdAt filter.
 */
function appendOngoingFreshnessFloor(where: Prisma.ProjectWhereInput): void {
  const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []
  and.push({ createdAt: { gte: ongoingFreshnessFloor() } })
  where.AND = and
}

function ongoingFreshnessFloor(): Date {
  return new Date(Date.now() - STALE_IN_PROGRESS_THRESHOLD_MS)
}

/**
 * Write picked hook file (V1 - uses FileHub for local filesystem)
 */
export async function writePickedHookFile(projectId: string, hookId: string) {
  const hookSummaryEntry = FileHub.hookSummary(projectId)
  const pickedHookEntry = FileHub.pickedHook(projectId)

  if (!(await hookSummaryEntry.exists())) {
    throw new NotFoundException('Hook summary file not found')
  }

  const hookSummary = await hookSummaryEntry.read()
  if (!Array.isArray(hookSummary) || hookSummary.length === 0) {
    throw new NotFoundException('No hooks available in hook_summary.json')
  }

  const selectedHook = hookSummary.find((hook) => hook.hook_id === hookId)

  if (!selectedHook) {
    throw new NotFoundException(`Hook with id "${hookId}" not found`)
  }

  await pickedHookEntry.write(selectedHook)
  logger.info(`Written picked_hook.json with hook: ${selectedHook.hook_id}`)

  try {
    const typeName = typeof selectedHook.type_name === 'string' ? selectedHook.type_name : ''
    if (typeName) {
      await MemoryStorage.addMessage(
        {
          role: 'assistant',
          content: `The user picked a ${typeName} hook`,
          type: 'text',
          createdAt: new Date().toISOString(),
          id: randomUUID(),
        },
        projectId,
      )
      logger.debug('[MEM][API] Saved assistant memory for user-picked hook', { projectId })
    }
  } catch (memErr) {
    logger.warn(
      {
        projectId,
        error: ensureError(memErr),
      },
      '[MEM][API] Failed to save memory for user-picked hook',
    )
  }
}

/**
 * Write picked hook file (V2 - uses createStorage for storage/local compatibility)
 */
export async function getDefaultVoiceConfigFromDB(
  prisma: PrismaService,
): Promise<ProjectVoiceOverJson> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'default_voice' },
    })

    if (config?.value) {
      const voiceConfig = config.value as ProjectVoiceOverJson

      if (!voiceConfig.voiceId || typeof voiceConfig.voiceId !== 'string') {
        logger.warn('Invalid default voice config: missing or invalid voiceId', {
          config: voiceConfig,
        })
        throw new Error('Invalid voiceId in database config')
      }

      if (!voiceConfig.name || typeof voiceConfig.name !== 'string') {
        logger.warn('Invalid default voice config: missing or invalid name', {
          config: voiceConfig,
        })
        throw new Error('Invalid name in database config')
      }

      if (!voiceConfig.type || !['voice-cloned', 'voice-over'].includes(voiceConfig.type)) {
        logger.warn('Invalid default voice config: missing or invalid type', {
          config: voiceConfig,
        })
        throw new Error('Invalid type in database config')
      }

      if (voiceConfig.labels && !Array.isArray(voiceConfig.labels)) {
        logger.warn('Invalid default voice config: labels should be an array', {
          config: voiceConfig,
        })
        throw new Error('Invalid labels format in database config')
      }

      if (voiceConfig.previewAudioUrl && typeof voiceConfig.previewAudioUrl !== 'string') {
        logger.warn('Invalid default voice config: previewAudioUrl should be a string', {
          config: voiceConfig,
        })
        throw new Error('Invalid previewAudioUrl format in database config')
      }

      return voiceConfig
    }
  } catch (error) {
    logger.error(
      { error: ensureError(error) },
      'Failed to fetch or validate default voice from database, using preset fallback',
    )
  }

  const fallback = defaultVoiceOption()
  return {
    labels: fallback.labels,
    name: fallback.name,
    previewAudioUrl: fallback.previewAudioUrl,
    type: 'voice-over',
    voiceId: fallback.voiceId,
    voiceProfile: fallback.voiceProfile,
  }
}

export async function parseVoiceOverJson(
  voiceConfig: null | ProjectVoiceOverJson,
  prisma: PrismaService,
): Promise<ProjectVoiceOverJson> {
  if (!voiceConfig) {
    return await getDefaultVoiceConfigFromDB(prisma)
  }
  // The browser sends back the preview it played as a served URL; the project keeps its address.
  const voice = toSavedAddresses(voiceConfig)

  if (voice.type !== 'voice-cloned' || voice.voiceProfile) {
    return voice
  }

  const voiceProfile = await readSavedVoiceCloneProfile(voice, prisma)
  return voiceProfile ? { ...voice, voiceProfile } : voice
}

export async function writePickedHookFileV2(projectId: string, hookId: string) {
  const storage = await createStorage(projectId)

  const pickedHookPath = 'picked_hook.json'
  const hookSummaryPath = 'hook_summary.json'

  // Read hook candidates from hook_summary.json
  const hookSummary = await storage.readJsonFile<unknown>(hookSummaryPath)
  let candidates: unknown[] = []

  if (Array.isArray(hookSummary)) {
    candidates = hookSummary
  } else if (hookSummary && typeof hookSummary === 'object' && 'hooks' in hookSummary) {
    candidates = Array.isArray(hookSummary.hooks) ? hookSummary.hooks : []
  }

  if (candidates.length === 0) {
    throw new NotFoundException('No hooks available')
  }

  const selectedHook = candidates.find((hook: unknown) => {
    const hookObj = hook as Record<string, unknown>
    return hookObj.hook_id === hookId || hookObj.hookId === hookId
  })

  if (!selectedHook) {
    throw new NotFoundException(`Hook with id "${hookId}" not found`)
  }

  // Write selected hook to hook/picked_hook.json (same path as write_picked_hook tool)
  await storage.writeJsonFile(pickedHookPath, selectedHook)
  logger.info(`Written ${pickedHookPath} with hook: ${hookId} (V2)`)

  // Try to save memory, but don't block or fail if it doesn't work
  const selectedHookObj = selectedHook as Record<string, unknown>
  const typeName = typeof selectedHookObj.type_name === 'string' ? selectedHookObj.type_name : ''
  if (typeName) {
    MemoryStorage.addMessage(
      {
        content: `The user picked a ${typeName} hook`,
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        role: 'assistant',
        type: 'text',
      },
      projectId,
    ).catch((err) => {
      logger.warn(`[writePickedHookFileV2] Failed to save memory for project ${projectId}`, err)
    })
  }
}

async function readSavedVoiceCloneProfile(
  voiceConfig: ProjectVoiceOverJson,
  prisma: PrismaService,
): Promise<ProjectVoiceOverJson['voiceProfile']> {
  const voiceClone = await prisma.userVoiceClone.findFirst({
    where: {
      orgId: getReqContext().org_id,
      ...(voiceConfig.voiceCloneId
        ? { id: voiceConfig.voiceCloneId }
        : {
            provider: voiceConfig.provider,
            voiceId: voiceConfig.voiceId,
          }),
    },
  })

  if (!voiceClone) {
    return undefined
  }

  const providerKey = voiceClone.provider?.trim() || 'unknown'
  const fileUri = storeUri(
    `voice-clones/${voiceClone.userId}/profiles/${providerKey}/profile-${encodeURIComponent(voiceClone.voiceId)}.json`,
  )
  if (!(await storedFileExists(fileUri))) {
    return undefined
  }

  const tempFilePath = path.join(
    '/tmp',
    `voice-profile-${Date.now()}-${encodeURIComponent(voiceClone.voiceId)}.json`,
  )

  try {
    await downloadStoredFile(fileUri, tempFilePath)
    const raw = await readFile(tempFilePath, 'utf8')
    return JSON.parse(raw) as ProjectVoiceOverJson['voiceProfile']
  } catch (error) {
    logger.warn(
      {
        error: ensureError(error),
        fileUri,
        voiceCloneId: voiceClone.id,
        voiceId: voiceClone.voiceId,
      },
      'Failed to backfill saved voice clone profile into voiceOverJson',
    )
    return undefined
  } finally {
    await rm(tempFilePath, { force: true }).catch(() => undefined)
  }
}

/**
 * Determine plan type from planId
 */
export function determinePlanType(
  planId: string,
  useAvatar: boolean,
): 'avatar' | 'codegen' | 'fallback' | 'fixed' | 'gen_ai' | undefined {
  if (planId === 'fixed') {
    return useAvatar ? 'avatar' : 'fixed'
  }
  if (planId.startsWith('gen_ai_plan_image')) {
    return 'fallback'
  }
  if (planId.startsWith('gen_ai_plan')) {
    return 'gen_ai'
  }
  if (planId.includes('codegen') || planId.startsWith('codegen_')) {
    return 'codegen'
  }
  return undefined
}

/**
 * Calculate shot statistics from shot_best_plan.json files
 */
export async function calculateShotStatisticsFromBestPlans(
  storage: Awaited<ReturnType<typeof createStorage>>,
  projectId: string,
): Promise<{
  codeGenShotPercentage?: string
  fixTemplateShotPercentage?: string
  genAIShotPercentage?: string
}> {
  const result: {
    codeGenShotPercentage?: string
    fixTemplateShotPercentage?: string
    genAIShotPercentage?: string
  } = {}

  const sceneShotInfoPath = 'storyboard/scene_shot_info.json'
  const sceneShotInfo = await storage.readJsonFile<Record<string, string[]>>(sceneShotInfoPath)

  const storyboardPath = STORYBOARD_PATHS.shotsBaseInfoPath
  const storyboard =
    await storage.readJsonFile<Array<{ scene_id: string; use_avatar?: boolean }>>(storyboardPath)

  const sceneToUseAvatar = new Map<string, boolean>()
  storyboard.forEach((scene) => {
    sceneToUseAvatar.set(scene.scene_id, scene.use_avatar ?? false)
  })

  let fixTemplateShots = 0
  let codeGenShots = 0
  let genAIShots = 0
  let totalShots = 0

  for (const [sceneId, shotIds] of Object.entries(sceneShotInfo)) {
    const useAvatar = sceneToUseAvatar.get(sceneId) ?? false

    for (const shotId of shotIds) {
      try {
        const shotBestPlanPath = STORYBOARD_PATHS.shotBestPlanPath(sceneId, shotId)
        const shotBestPlan = await storage.readJsonFile<{ planId: string }>(shotBestPlanPath)

        if (!shotBestPlan?.planId) {
          continue
        }

        const planType = determinePlanType(shotBestPlan.planId, useAvatar)
        totalShots++

        if (planType === 'fixed' || planType === 'avatar') {
          fixTemplateShots++
        } else if (planType === 'codegen') {
          codeGenShots++
        } else if (planType === 'gen_ai' || planType === 'fallback') {
          genAIShots++
        }
      } catch (shotError) {
        logger.debug(
          { error: ensureError(shotError), projectId, sceneId, shotId },
          'Failed to read shot_best_plan.json',
        )
      }
    }
  }

  if (totalShots > 0) {
    result.fixTemplateShotPercentage = ((fixTemplateShots / totalShots) * 100).toFixed(2)
    result.codeGenShotPercentage = ((codeGenShots / totalShots) * 100).toFixed(2)
    result.genAIShotPercentage = ((genAIShots / totalShots) * 100).toFixed(2)
  }

  return result
}

export async function markProjectsSeenUtil(
  deps: { prisma: PrismaService },
  ids: string[],
  orgId: null | string | undefined,
): Promise<{ changedCount: number; skippedCount: number }> {
  if (!orgId) {
    throw new UnauthorizedException('User not authenticated')
  }
  if (!Array.isArray(ids)) {
    throw new BadRequestException('ids must be an array')
  }

  const normalizedIds = [...new Set(ids.map((id) => id?.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) {
    return { changedCount: 0, skippedCount: 0 }
  }
  if (normalizedIds.length > 200) {
    throw new BadRequestException('ids must contain at most 200 items')
  }

  const seenAt = new Date()
  const updateResult = await deps.prisma.project.updateMany({
    where: {
      id: { in: normalizedIds },
      orgId,
      isDeleted: false,
      stage: { in: PROJECT_TERMINAL_STAGES },
      OR: [{ lastSeenAt: null }, { lastSeenAt: { isSet: false } }],
    },
    data: { lastSeenAt: seenAt },
  })

  const changedCount = updateResult.count
  const skippedCount = normalizedIds.length - changedCount

  if (changedCount > 0) {
    const changedIds = (
      await deps.prisma.project.findMany({
        where: { id: { in: normalizedIds }, orgId, isDeleted: false, lastSeenAt: seenAt },
        select: { id: true },
      })
    ).map((project) => project.id)

    if (changedIds.length) {
      pushOrgProjectEvent(orgId, {
        resource: 'project',
        action: 'seen-changed',
        lastSeenAt: seenAt.toISOString(),
        projectIds: changedIds,
      })
    }
  }

  return { changedCount, skippedCount }
}

export async function resolveAttachmentAsset(
  projectId: string,
  attachment: { mime: string; name: null | string; uri: string },
): Promise<null | {
  asset: {
    asset_type: string
    asset_url: string
    file_size: number
    filename: string
    mime_type: string
  }
  assetUrl: string
}> {
  const uriWithoutProjectId = attachment.uri.replace(new RegExp(`^${projectId}/`), '')

  if (attachment.mime.startsWith('video/')) {
    return await resolveVideoAttachmentAsset(projectId, attachment, uriWithoutProjectId)
  }
  return await resolveNonVideoAttachmentAsset(projectId, attachment, uriWithoutProjectId)
}
async function resolveNonVideoAttachmentAsset(
  projectId: string,
  attachment: { mime: string; name: null | string; uri: string },
  uriWithoutProjectId: string,
): Promise<null | {
  asset: {
    asset_type: string
    asset_url: string
    file_size: number
    filename: string
    mime_type: string
  }
  assetUrl: string
}> {
  const fileUri = workspaceUri(projectId, uriWithoutProjectId)
  const fileSize = await storedFileSize(fileUri)
  if (fileSize <= 0) {
    logger.info(`Image asset not found for project ${projectId}, attachment: ${attachment.uri}`)
    return null
  }

  const assetType = attachment.mime.split('/')[0]
  const assetUrl = workspaceUrl(projectId, uriWithoutProjectId)
  const filename = attachment.name ?? path.basename(uriWithoutProjectId)
  return {
    asset: {
      asset_type: assetType,
      asset_url: assetUrl,
      filename,
      file_size: fileSize,
      mime_type: attachment.mime,
    },
    assetUrl,
  }
}

async function resolveVideoAttachmentAsset(
  projectId: string,
  attachment: { mime: string; name: null | string; uri: string },
  uriWithoutProjectId: string,
): Promise<null | {
  asset: {
    asset_type: string
    asset_url: string
    file_size: number
    filename: string
    mime_type: string
  }
  assetUrl: string
}> {
  const legacyVideoUri = uriWithoutProjectId.replace(
    new RegExp('^user_uploaded/'),
    'user_uploaded/videos/',
  )
  let resolvedVideoUri = uriWithoutProjectId
  let fileUri = workspaceUri(projectId, resolvedVideoUri)
  let fileSize = await storedFileSize(fileUri)
  if (fileSize <= 0 && legacyVideoUri !== uriWithoutProjectId) {
    resolvedVideoUri = legacyVideoUri
    fileUri = workspaceUri(projectId, resolvedVideoUri)
    fileSize = await storedFileSize(fileUri)
  }
  if (fileSize <= 0) {
    logger.info(`Video asset not found for project ${projectId}, attachment: ${attachment.uri}`)
    return null
  }

  const assetUrl = workspaceUrl(projectId, resolvedVideoUri)
  const filename = attachment.name ?? path.basename(resolvedVideoUri)
  return {
    asset: {
      asset_type: 'video',
      asset_url: assetUrl,
      filename,
      file_size: fileSize,
      mime_type: attachment.mime,
    },
    assetUrl,
  }
}
