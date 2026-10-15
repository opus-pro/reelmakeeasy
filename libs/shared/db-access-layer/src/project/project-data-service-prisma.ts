import type { PrismaClient } from '@reelmakeeasy/api-db'
import { zodGetKeys } from '@reelmakeeasy/common/zod-helpers/get-keys'
import { zodToSelect } from '@reelmakeeasy/common/zod-helpers/to-select'
import type {
  ProjectAttachmentItemDto,
  ProjectCreateData,
  ProjectDataService,
  ProjectMetadata,
  ResolvedAvatarInfo,
  SelectedLongTakeProjectInfo,
  SourcePreferenceDto,
} from '@shared/types/api/domain-services/project-data-service'
import type { ProjectForBackend } from '@shared/types/api/project'
import { ProjectAttachmentItemDtoSchema } from '@shared/types/api/project-attachment.zod'
import { SourcePreferenceDtoSchema } from '@shared/types/api/source-preference.zod'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { pick } from 'lodash-es'

import { getDefaultPrisma } from '../get-prisma'

/**
 * ProjectDataService implementation backed by Prisma.
 */
export function getProjectDataServicePrisma(prisma?: PrismaClient): ProjectDataService {
  return createPrismaProjectDataService(prisma)
}

/** later will be replaced by an API-backed implementation */
function createPrismaProjectDataService(prisma?: PrismaClient): ProjectDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async createProject(data: ProjectCreateData): Promise<void> {
      // NOTE(project-expiry): this path bypasses ProjectService.createProject, so it does NOT set
      // the lifecycle anchor (lifecycleStatus/expiresAt/expiryPlanTier). It is currently unused
      // (long-take local test scaffold) and has no req-context. If it ever creates real user
      // projects, resolve + write the anchor here too (or route through ProjectService).
      await db.project.create({
        data: {
          id: data.id,
          initPrompt: data.initPrompt,
          name: data.name,
          owner: data.owner ?? undefined,
          ownerEmail: data.ownerEmail ?? undefined,
          isLongTake: data.isLongTake ?? undefined,
          stage: data.stage as 'INITIALIZING' | undefined,
          lastSeenAt: null,
        },
      })
    },

    async getProject(projectId: string): Promise<null | ProjectForBackend> {
      const row = await db.project.findUnique({
        where: { id: projectId },
      })
      return row as unknown as null | ProjectForBackend
    },

    async getLongTakeProjectsByCreatedDateRange(
      conditions: { fromDate: Date; toDate: Date } | { fromDate: Date } | { toDate: Date },
    ): Promise<SelectedLongTakeProjectInfo[]> {
      const { fromDate, toDate } = { fromDate: undefined, toDate: undefined, ...conditions }
      const createdAtFilter = { gte: fromDate, lte: toDate }
      const selectedFields: Partial<Record<keyof ProjectForBackend, boolean>> = {
        id: true,
        name: true,
        createdAt: true,
        style: true,
        styleText: true,
        owner: true,
      }
      const res = await db.project.findMany({
        where: { isLongTake: true, createdAt: createdAtFilter },
        select: selectedFields,
        orderBy: { createdAt: 'desc' },
      })
      return res as SelectedLongTakeProjectInfo[]
    },

    async getSourcePreference(userId: string): Promise<null | SourcePreferenceDto> {
      const row = await db.sourcePreference.findUnique({
        where: { userId },
      })
      if (!row) {
        return null
      }
      return pick(row, zodGetKeys(SourcePreferenceDtoSchema))
    },

    async getProjectAttachments(projectId: string): Promise<ProjectAttachmentItemDto[]> {
      return await db.projectAttachment.findMany({
        where: { projectId },
        select: zodToSelect(ProjectAttachmentItemDtoSchema),
      })
    },

    async getProjectMetadata(
      projectId: string,
      fields: (keyof ProjectMetadata)[],
    ): Promise<null | Partial<ProjectMetadata>> {
      const select = Object.fromEntries(fields.map((field) => [field, true]))
      const row = await db.project.findUnique({
        where: { id: projectId },
        select,
      })
      return row as null | Partial<ProjectMetadata>
    },

    async resolveAvatarInfo(avatarId: null | string | undefined): Promise<ResolvedAvatarInfo> {
      if (!avatarId) {
        return { avatarId: 'none', avatarType: 'none', avatarName: undefined }
      }

      // Check stockAvatar table first
      const stockAvatar = await db.stockAvatar?.findUnique({
        where: { id: avatarId },
        select: { displayName: true },
      })
      if (stockAvatar) {
        return {
          avatarId,
          avatarType: 'stock',
          avatarName: stockAvatar.displayName || undefined,
        }
      }

      // Fallback to aiAvatar table (user-generated)
      const aiAvatar = await db.aiAvatar.findUnique({
        where: { id: avatarId },
        select: { displayName: true },
      })
      if (aiAvatar) {
        return {
          avatarId,
          avatarType: 'user',
          avatarName: aiAvatar.displayName || undefined,
        }
      }

      // Avatar ID exists but not found in either table
      return { avatarId, avatarType: 'none', avatarName: undefined }
    },

    async updateProjectName(
      projectId: string,
      newName: string,
      placeholders: readonly string[],
    ): Promise<number> {
      const result = await db.project.updateMany({
        where: {
          id: projectId,
          name: { in: Array.from(placeholders) },
        },
        data: { name: newName },
      })
      return result.count
    },

    async replaceProjectName(projectId: string, newName: string): Promise<void> {
      await db.project.update({
        where: { id: projectId },
        data: { name: newName },
      })
    },

    async getScriptRefId(projectId: string): Promise<null | string> {
      const row = await db.project.findUnique({
        where: { id: projectId },
        select: { scriptRefId: true },
      })
      return row?.scriptRefId || null
    },
    async updateScriptRefId(projectId: string, scriptRefId: string): Promise<null | string> {
      const row = await db.project.update({
        where: { id: projectId },
        data: { scriptRefId },
        select: { scriptRefId: true },
      })
      return row?.scriptRefId || null
    },

    async updateProjectStage(projectId: string, stage: keyof typeof PROJECT_STAGE): Promise<void> {
      await db.project.update({
        where: { id: projectId },
        data: { stage },
      })
    },
    async updateScriptConfirmed(projectId: string, confirmed: boolean): Promise<void> {
      await db.project.update({
        where: { id: projectId },
        data: { scriptConfirmed: confirmed },
      })
    },
    async updateFirstMessageReplySent(projectId: string, sent: boolean): Promise<void> {
      await db.project.update({
        where: { id: projectId },
        data: { firstMessageReplySent: sent },
      })
    },
  }
}
