import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { MusicController } from './music.controller'
import { MusicService } from './music.service'

@Module({
  controllers: [MusicController],
  exports: [MusicService],
  imports: [PrismaModule],
  providers: [MusicService],
})
export class MusicModule {}
