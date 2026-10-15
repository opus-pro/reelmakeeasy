import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'

import { ImageModelsController } from './image-models.controller'

@Module({
  controllers: [ImageModelsController],
  imports: [PrismaModule],
})
export class ImageModelsModule {}
