import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { StyleGenericizeService } from './style-genericize.service'
import { StyleRealismService } from './style-realism.service'
import { UserSavedStylesController } from './user-saved-styles.controller'
import { UserSavedStylesService } from './user-saved-styles.service'

@Module({
  controllers: [UserSavedStylesController],
  exports: [UserSavedStylesService],
  imports: [PrismaModule],
  providers: [StyleGenericizeService, StyleRealismService, UserSavedStylesService],
})
export class UserSavedStylesModule {}
