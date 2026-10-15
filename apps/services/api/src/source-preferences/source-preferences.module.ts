import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { SourcePreferencesController } from './source-preferences.controller'
import { SourcePreferencesService } from './source-preferences.service'

@Module({
  imports: [PrismaModule],
  controllers: [SourcePreferencesController],
  providers: [SourcePreferencesService],
  exports: [SourcePreferencesService],
})
export class SourcePreferencesModule {}
