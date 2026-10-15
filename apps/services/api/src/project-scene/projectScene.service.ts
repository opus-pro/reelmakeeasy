import { Injectable } from '@nestjs/common'
import { SceneListResponse } from '@shared/types/api'
import { ProjectForBackend } from '@shared/types/api/project'

import { PrismaService } from '../prisma/prisma.service'

import parseToSceneDataForCanvasV2 from './adaptor/scene-data-parser-v2'
import sceneDataScannerV2 from './adaptor/scene-data-scanner-v2'

@Injectable()
export class ProjectSceneService {
  constructor(private readonly prisma: PrismaService) {}

  async getSceneList(projectId: string): Promise<SceneListResponse> {
    const sceneDataScannerV2Result = await sceneDataScannerV2(projectId)
    const project = await this.prisma.project.findFirst({ where: { id: projectId } })
    const fullData =
      sceneDataScannerV2Result.storyboard?.map((_, index) =>
        parseToSceneDataForCanvasV2(
          sceneDataScannerV2Result,
          project as unknown as ProjectForBackend,
          index,
        ),
      ) ?? []
    return { data: fullData }
  }
}
