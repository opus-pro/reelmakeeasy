import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { VoiceOverController } from './voice-over.controller'
import { VoiceOverService } from './voice-over.service'

@Module({
  controllers: [VoiceOverController],
  exports: [VoiceOverService],
  imports: [PrismaModule],
  providers: [VoiceOverService],
})
export class VoiceOverModule {}
