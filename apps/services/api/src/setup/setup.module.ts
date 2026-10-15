import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { LlmNotSetUpFilter } from './llm-not-set-up.filter'
import { SetupController } from './setup.controller'
import { SetupSettingsService } from './setup-settings.service'

/** `/api/setup`: which keys and agents this computer has, and the AI and generation choices.
 *  Exports the settings service for the LLM routing (AgentModule). */
@Module({
  controllers: [SetupController],
  exports: [SetupSettingsService],
  providers: [
    SetupSettingsService,
    // Requests whose LLM step has no AI set up answer 409 in plain words.
    { provide: APP_FILTER, useClass: LlmNotSetUpFilter },
  ],
})
export class SetupModule {}
