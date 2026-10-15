import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { ProjectsModule } from '../projects/projects.module'

import { AssetsController } from './assets.controller'
import { AssetsService } from './assets.service'

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, PrismaService],
  exports: [AssetsService],
  imports: [PrismaModule, ProjectsModule],
})
export class AssetsModule {}
