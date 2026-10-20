import { Module } from '@nestjs/common'

import { SoundLibraryModule } from '../sound-library/sound-library.module'
import { SoundLibraryService } from '../sound-library/sound-library.service'

import { RankingController } from './ranking.controller'
import { RankingService } from './ranking.service'

@Module({
  controllers: [RankingController],
  imports: [SoundLibraryModule],
  providers: [
    {
      inject: [SoundLibraryService],
      provide: RankingService,
      useFactory: (sounds: SoundLibraryService) => new RankingService(sounds),
    },
  ],
})
export class RankingModule {}
