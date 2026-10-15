import { Module } from '@nestjs/common'

import { DemoProjectsController } from './demo-projects.controller'
import { PresetsController } from './presets.controller'
import { StoryModeStylesController } from './story-mode-styles.controller'

@Module({ controllers: [PresetsController, StoryModeStylesController, DemoProjectsController] })
export class PresetsModule {}
