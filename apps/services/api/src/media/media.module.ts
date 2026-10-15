import { forwardRef, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { ProjectsModule } from '../projects/projects.module'

import { MediaController } from './media.controller'
import { MediaService } from './media.service'
import { StyleAnalyzerService } from './style-analyzer.service'
import { StyleConfigService } from './style-config.service'
import { StylePreviewService } from './style-preview.service'
import { StyleTextService } from './style-text.service'

@Module({
  controllers: [MediaController],
  exports: [MediaService, StyleAnalyzerService],
  providers: [
    MediaService,
    StyleConfigService,
    StyleTextService,
    StylePreviewService,
    StyleAnalyzerService,
  ],
  // The ProjectsModule <-> MediaModule module cycle is fine (proven by the boot
  // regression test); what once crashed boot was media.controller.ts importing
  // ProjectService as a VALUE. It now imports only the PROJECT_ACCESS token.
  imports: [PrismaModule, forwardRef(() => ProjectsModule)],
})
export class MediaModule {}
