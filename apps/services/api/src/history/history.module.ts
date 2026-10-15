import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'

import { HistoryController } from './history.controller'
import { HistoryService } from './history.service'

@Module({
  controllers: [HistoryController],
  exports: [HistoryService],
  imports: [PrismaModule, ProjectsModule],
  providers: [HistoryService],
})
export class HistoryModule {}
