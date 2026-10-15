import { Module } from '@nestjs/common'

import { MediaModule } from '../media/media.module'
import { PrismaModule } from '../prisma/prisma.module'
import { UserSavedStylesModule } from '../user-saved-styles/user-saved-styles.module'

import { BrandBriefController } from './brand-brief.controller'
import { BrandBriefService } from './brand-brief.service'
import { BrandBriefCreateService } from './brand-brief-create.service'
import { BrandBriefStyleGenerationService } from './brand-brief-style-generation.service'

@Module({
  controllers: [BrandBriefController],
  exports: [BrandBriefStyleGenerationService],
  imports: [PrismaModule, MediaModule, UserSavedStylesModule],
  providers: [BrandBriefService, BrandBriefCreateService, BrandBriefStyleGenerationService],
})
export class BrandBriefModule {}
