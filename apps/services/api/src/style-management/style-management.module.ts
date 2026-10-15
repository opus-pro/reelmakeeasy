import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { StyleController } from './style.controller'
import { StyleService } from './style.service'

@Module({
  imports: [PrismaModule],
  controllers: [StyleController],
  providers: [StyleService],
})
export class StyleManagementModule {}
