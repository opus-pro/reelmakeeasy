import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { VoiceClonesController } from './voice-clones.controller'
import { VoiceClonesService } from './voice-clones.service'

@Module({
  controllers: [VoiceClonesController],
  exports: [VoiceClonesService],
  imports: [PrismaModule],
  providers: [VoiceClonesService],
})
export class VoiceClonesModule {}
