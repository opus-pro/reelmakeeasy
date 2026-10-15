import { Module } from '@nestjs/common'

import { BrandBriefModule } from '../brand-briefs/brand-brief.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'
import { ScheduledJobModule } from '../scheduled-job/scheduled-job.module'
import { UserSavedStylesModule } from '../user-saved-styles/user-saved-styles.module'
import { VoiceOverModule } from '../voice-over/voice-over.module'

import { UipController } from './uip.controller'
import { UipService } from './uip.service'
import { UipInternalController } from './uip-internal.controller'
import { UipScheduledJobService } from './uip-scheduled-job.service'

@Module({
  imports: [
    PrismaModule,
    BrandBriefModule,
    ProjectsModule,
    ScheduledJobModule,
    UserSavedStylesModule,
    VoiceOverModule,
  ],
  controllers: [UipController, UipInternalController],
  providers: [UipService, UipScheduledJobService],
})
export class UipModule {}
