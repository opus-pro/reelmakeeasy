import { Module } from '@nestjs/common'

import { SoundLibraryModule } from '../sound-library/sound-library.module'
import { SoundLibraryService } from '../sound-library/sound-library.service'

import { RankingController } from './ranking.controller'
import { RankingService } from './ranking.service'
import { RankingTemplateService } from './ranking-template.service'

@Module({
  controllers: [RankingController],
  exports: [RankingService, RankingTemplateService],
  imports: [SoundLibraryModule],
  providers: [
    {
      inject: [SoundLibraryService],
      provide: RankingService,
      useFactory: (sounds: SoundLibraryService) => new RankingService(sounds),
    },
    {
      inject: [SoundLibraryService],
      provide: RankingTemplateService,
      useFactory: (sounds: SoundLibraryService) => new RankingTemplateService(sounds),
    },
  ],
})
export class RankingModule {}
