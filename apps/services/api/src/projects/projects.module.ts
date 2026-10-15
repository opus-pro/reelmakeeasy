import { forwardRef, Module } from '@nestjs/common'

import { MediaModule } from '../media/media.module'
import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsSceneModule } from '../project-scene/projectScene.module'
import { SharedModule } from '../shared/shared.module'
import { VideoScriptModule } from '../video-script/video-script.module'

import { PROJECT_ACCESS } from './project-access.token'
import { ProjectDownloadRetentionService } from './project-download-retention.service'
import { ProjectProcessingController } from './project-processing.controller'
import { ProjectSearchService } from './project-search.service'
import { ProjectSearchFeatureGuard } from './project-search-feature.guard'
import { ProjectController } from './projects.controller'
import { ProjectService } from './projects.service'

@Module({
  controllers: [ProjectController, ProjectProcessingController],
  exports: [PROJECT_ACCESS, ProjectService],
  imports: [
    PrismaModule,
    ProjectsSceneModule,
    forwardRef(() => MediaModule),
    VideoScriptModule,
    forwardRef(() => SharedModule),
  ],
  providers: [
    ProjectService,
    // Alias, so a consumer can depend on the check without importing the class
    // as a value. See project-access.token.ts.
    { provide: PROJECT_ACCESS, useExisting: ProjectService },
    ProjectDownloadRetentionService,
    ProjectSearchFeatureGuard,
    ProjectSearchService,
  ],
})
export class ProjectsModule {}
