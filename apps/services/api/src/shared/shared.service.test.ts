import { UserInfo } from '@reelmakeeasy/common/types/user'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { AccessLevel } from '@shared/types/api/shared'

import { SharedService } from './shared.service'

const owner = { email: 'owner@example.com', orgId: 'org-owner', sub: 'owner' } as UserInfo
// No email domain gets special rights: only the owner manages share links.
const other = { email: 'someone@example.org', orgId: 'org-other', sub: 'other' } as UserInfo

function makeService() {
  const shared = { id: 's1', owner: 'owner', projectId: 'p1', sharedProjectId: 'abc123' }
  const prisma = {
    projectShared: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(shared),
      update: jest.fn(),
    },
  }
  const projectService = {
    getProject: jest.fn().mockResolvedValue({ id: 'p1', orgId: 'org-owner', owner: 'owner' }),
  }
  return { prisma, service: new SharedService(projectService as never, prisma as never) }
}

describe('SharedService ownership', () => {
  it('lets the owner create, re-scope and delete a share link', async () => {
    const { prisma, service } = makeService()
    await expect(service.createSharedProject('p1', owner)).resolves.toHaveLength(6)
    await service.updateAccessLevel('abc123', AccessLevel.PRIVATE, owner)
    await service.deleteSharedProject('abc123', owner)
    expect(prisma.projectShared.create).toHaveBeenCalledTimes(1)
    expect(prisma.projectShared.update).toHaveBeenCalledTimes(1)
    expect(prisma.projectShared.delete).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-owner, whatever their email', async () => {
    const { prisma, service } = makeService()
    await expect(service.createSharedProject('p1', other)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    await expect(
      service.updateAccessLevel('abc123', AccessLevel.PUBLIC, other),
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.deleteSharedProject('abc123', other)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(prisma.projectShared.create).not.toHaveBeenCalled()
    expect(prisma.projectShared.update).not.toHaveBeenCalled()
    expect(prisma.projectShared.delete).not.toHaveBeenCalled()
  })
})
