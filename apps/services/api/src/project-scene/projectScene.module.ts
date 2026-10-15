import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { ProjectSceneService } from './projectScene.service'

@Module({
  exports: [ProjectSceneService],
  imports: [PrismaModule],
  providers: [ProjectSceneService],
})
export class ProjectsSceneModule {}
