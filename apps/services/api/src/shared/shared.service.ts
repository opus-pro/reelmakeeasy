import { logger } from '@reelmakeeasy/common/logger'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ProjectForBackend } from '@shared/types/api/project'
import { AccessLevel, SharedProject } from '@shared/types/api/shared'
import { customAlphabet } from 'nanoid'

import { PrismaService } from '../prisma/prisma.service'
import { ProjectService } from '../projects/projects.service'
import { stripLifecycleAnchorFields } from '../projects/projects-list.util'
import { sanitizeCloneVoiceMetadata } from '../projects/sanitize-voice.util'

@Injectable()
export class SharedService {
  private readonly SHARED_PROJECT_ID_LENGTH = 6
  private readonly sharedProjectIdAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz'

  constructor(
    private readonly projectService: ProjectService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create or return existing ProjectShared record (idempotent).
   * New projects get accessLevel: "public" by default.
   */
  async createSharedProject(projectId: string, user: UserInfo): Promise<string> {
    // Check if record already exists (idempotent)
    const existing = await this.prisma.projectShared.findFirst({ where: { projectId } })
    if (existing) {
      return existing.sharedProjectId
    }

    const project = await this.projectService.getProject(projectId)
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`)
    }
    if (!project.orgId || !project.owner) {
      throw new UnauthorizedException('Project owner not found')
    }

    if (project.orgId !== user.orgId) {
      throw new UnauthorizedException('You are not the owner of this project')
    }

    const sharedProjectId = this.generateSharedProjectId()
    await this.prisma.projectShared.create({
      data: {
        projectId,
        sharedProjectId,
        owner: project.owner,
        accessLevel: AccessLevel.PUBLIC,
      },
    })
    return sharedProjectId
  }

  async deleteSharedProject(sharedProjectId: string, user: UserInfo): Promise<void> {
    const sharedProject = await this.prisma.projectShared.findUniqueOrThrow({
      where: { sharedProjectId },
    })
    if (!sharedProject) {
      throw new NotFoundException(`Shared project id not found: ${sharedProjectId}`)
    }

    if (sharedProject.owner !== user.sub) {
      throw new UnauthorizedException('You are not the owner of this shared project')
    }

    await this.prisma.projectShared.delete({ where: { id: sharedProject.id } })
  }

  generateSharedProjectId(): string {
    // generate a url safe string
    return customAlphabet(this.sharedProjectIdAlphabet, this.SHARED_PROJECT_ID_LENGTH)()
  }

  async getProjectByShareId(
    sharedProjectId: string,
    requestingLoginId?: string,
  ): Promise<ProjectForBackend> {
    // findUnique (not findUniqueOrThrow): a missing share must surface as a 404
    // NotFoundException, not an untranslated Prisma P2025 that NestJS returns as 500.
    const sharedProject = await this.prisma.projectShared.findUnique({
      where: { sharedProjectId },
    })
    if (!sharedProject) {
      throw new NotFoundException(`Shared project id not found: ${sharedProjectId}`)
    }

    // Check if access is private (owner can still access their own private project)
    if (
      sharedProject.accessLevel === AccessLevel.PRIVATE &&
      (!requestingLoginId || sharedProject.owner !== requestingLoginId)
    ) {
      throw new ForbiddenException('This project is set to private access')
    }

    const project = await this.projectService.getProject(sharedProject.projectId)
    if (!project) {
      throw new NotFoundException(`Project with ID ${sharedProject.projectId} not found`)
    }
    // Strip the internal lifecycle anchor columns before the project reaches this
    // client-facing surface -- same contract as the project GET/list responses
    // (projects-list.util). storageBytes is a BigInt that crashes JSON.stringify on
    // the way out (a 500), so this must run for owners too.
    const safeProject = stripLifecycleAnchorFields(project)
    // Strip clone-voice metadata for non-owner viewers. The /shared/:id endpoint
    // is unauthenticated, so any cloned-voice project would otherwise leak the
    // creator's clone name, voiceCloneId, provider, and previewAudioUrl.
    if (!requestingLoginId || sharedProject.owner !== requestingLoginId) {
      return {
        ...safeProject,
        voiceOverJson: sanitizeCloneVoiceMetadata(safeProject.voiceOverJson),
      }
    }
    return safeProject
  }

  async replaceProjectId(originProjectId: string, newProjectId: string): Promise<void> {
    const projectShared = await this.prisma.projectShared.findFirst({
      where: { projectId: originProjectId },
    })
    if (!projectShared) {
      return
    }
    await this.prisma.projectShared.update({
      where: { id: projectShared.id },
      data: { projectId: newProjectId },
    })
  }

  /**
   * Get or create a ProjectShared record for a project.
   * For old projects (no record), creates one with accessLevel: "private" to preserve
   * the previous restricted behavior.
   */
  async searchByProjectId(projectId: string): Promise<SharedProject> {
    let sharedProject = await this.prisma.projectShared.findFirst({ where: { projectId } })

    // If no record exists, create one with "private" access (migration for old projects)
    if (!sharedProject) {
      const project = await this.projectService.getProject(projectId)
      if (!project) {
        throw new NotFoundException(`Project with ID ${projectId} not found`)
      }
      if (!project.owner) {
        throw new NotFoundException(`Project owner not found for project ${projectId}`)
      }

      // Create new record with private access (preserves old restricted behavior)
      const sharedProjectId = this.generateSharedProjectId()
      sharedProject = await this.prisma.projectShared.create({
        data: {
          projectId,
          sharedProjectId,
          owner: project.owner,
          accessLevel: AccessLevel.PRIVATE,
        },
      })
      logger.info({ projectId, sharedProjectId }, 'Created ProjectShared record for legacy project')
    }

    const disabled = (sharedProject as { disabled?: boolean }).disabled ?? false
    const accessLevel = (sharedProject.accessLevel as AccessLevel) || AccessLevel.PUBLIC
    return {
      projectId: sharedProject.projectId,
      sharedProjectId: sharedProject.sharedProjectId,
      owner: sharedProject.owner,
      accessLevel,
      disabled,
    }
  }

  async updateAccessLevel(
    sharedProjectId: string,
    accessLevel: AccessLevel,
    user: UserInfo,
  ): Promise<void> {
    const sharedProject = await this.prisma.projectShared.findUniqueOrThrow({
      where: { sharedProjectId },
    })

    // Verify ownership
    if (sharedProject.owner !== user.sub) {
      throw new ForbiddenException('You are not the owner of this project')
    }

    await this.prisma.projectShared.update({
      where: { id: sharedProject.id },
      data: { accessLevel },
    })
  }
}
