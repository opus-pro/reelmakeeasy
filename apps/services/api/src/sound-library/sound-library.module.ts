import { Module } from '@nestjs/common'

import { SoundLibraryController } from './sound-library.controller'
import { SoundLibraryService } from './sound-library.service'

@Module({
  controllers: [SoundLibraryController],
  exports: [SoundLibraryService],
  providers: [{ provide: SoundLibraryService, useFactory: () => new SoundLibraryService() }],
})
export class SoundLibraryModule {}
