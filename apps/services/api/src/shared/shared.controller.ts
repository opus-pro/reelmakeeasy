import { UserInfo } from '@reelmakeeasy/common/types/user'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { Project } from '@shared/types/api/project'
import {
  CreateSharedProjectBodyType,
  CreateSharedProjectResponse,
  SharedProjectFullResponse,
  SharedProjectResponse,
  UpdateAccessLevelBodyType,
} from '@shared/types/api/shared'

import { SharedService } from './shared.service'

@Controller('shared')
export class SharedController {
  constructor(private readonly sharedService: SharedService) {}

  // create a shared project
  @Post('')
  async createSharedProject(
    @Body() body: CreateSharedProjectBodyType,
  ): Promise<CreateSharedProjectResponse> {
    const user = {
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
      sub: getReqContext().login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
    } as UserInfo
    const sharedProjectId = await this.sharedService.createSharedProject(body.projectId, user)
    return { data: { sharedProjectId } }
  }

  @Delete(':sharedProjectId')
  async deleteSharedProject(@Param('sharedProjectId') sharedProjectId: string): Promise<void> {
    const user = {
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
      sub: getReqContext().login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
    } as UserInfo
    await this.sharedService.deleteSharedProject(sharedProjectId, user)
  }

  // get real project id by shared project id
  /** no auth needed, but optionally uses auth to allow owner access to private projects */
  @Get(':sharedProjectId')
  async getRealProjectId(
    @Param('sharedProjectId') sharedProjectId: string,
  ): Promise<SharedProjectFullResponse> {
    const loginId = getReqContext().login_id
    const res = (await this.sharedService.getProjectByShareId(
      sharedProjectId,
      loginId || undefined,
    )) as Project
    return { data: { ...res, sharedProjectId } }
  }

  @Get('search-by-project-id/:projectId')
  async searchByProjectId(@Param('projectId') projectId: string): Promise<SharedProjectResponse> {
    const res = await this.sharedService.searchByProjectId(projectId)
    return { data: res }
  }

  @Put(':sharedProjectId')
  async updateAccessLevel(
    @Param('sharedProjectId') sharedProjectId: string,
    @Body() body: UpdateAccessLevelBodyType,
  ): Promise<void> {
    const user = {
      orgId: getReqContext().org_id,
      userId: getReqContext().user_id,
      sub: getReqContext().login_id,
      // eslint-disable-next-line @nx/workspace-no-pii-field-access
      email: getReqContext().pii?.email || '',
    } as UserInfo
    await this.sharedService.updateAccessLevel(sharedProjectId, body.accessLevel, user)
  }
}
