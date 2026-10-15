import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { VideoScriptService } from './video-script.service'

@Module({
  exports: [VideoScriptService],
  imports: [PrismaModule],
  providers: [VideoScriptService],
})
export class VideoScriptModule {}
