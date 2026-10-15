import { Module } from '@nestjs/common'

import { SetupModule } from '../setup/setup.module'

import { SpeechController } from './speech.controller'
import { SpeechService } from './speech.service'

/** `/api/speech`: voice typing, speech to text for the chat boxes. */
@Module({
  controllers: [SpeechController],
  imports: [SetupModule],
  providers: [SpeechService],
})
export class SpeechModule {}
