import { forwardRef, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'

import { SharedController } from './shared.controller'
import { SharedService } from './shared.service'

@Module({
  controllers: [SharedController],
  exports: [SharedService],
  imports: [PrismaModule, forwardRef(() => ProjectsModule)],
  providers: [SharedService],
})
export class SharedModule {}
