import { Module } from '@nestjs/common'

import { MediaModule } from '../media/media.module'
import { MusicModule } from '../music/music.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'

import { BeatLoopService } from './beat-loop.service'
import { InpaintController } from './inpaint.controller'
import { InpaintService } from './inpaint.service'
import { LongTakeController } from './long-take.controller'
import { LongTakeService } from './long-take.service'

@Module({
  imports: [ProjectsModule, MediaModule, PrismaModule, MusicModule],
  controllers: [LongTakeController, InpaintController],
  providers: [LongTakeService, InpaintService, BeatLoopService],
  exports: [LongTakeService, BeatLoopService],
})
export class LongTakeModule {}
