import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import type { SetupStatus } from '@shared/types/api/setup'

import { LoopbackOnlyGuard } from '../agent/loopback-only.guard'

import { SetupSettingsService } from './setup-settings.service'
import {
  GENERATION_PROVIDERS,
  isGenerationProvider,
  isLlmProvider,
  LLM_PROVIDERS,
} from './setup-status'

@Controller('setup')
// Setup reports which keys and agents this computer has and switches the AI that writes and
// plans: only this computer may call it (see the guard).
@UseGuards(LoopbackOnlyGuard)
export class SetupController {
  constructor(private readonly settings: SetupSettingsService) {}

  /** `PUT /api/setup/generation { provider }`: 400 for an unknown id, 409 when its key is
   *  missing; otherwise saves it and returns the new status. A video already being made keeps
   *  the provider it started with; the next one uses this. Only the keys matter here, so it
   *  reads the last probe (`currentStatus()`, keys re-read) and never re-runs the agents' CLIs. */
  @Put('generation')
  async setGeneration(@Body() body: undefined | { provider?: unknown }): Promise<SetupStatus> {
    const provider = body?.provider
    if (!isGenerationProvider(provider)) {
      throw new BadRequestException(`provider must be one of: ${GENERATION_PROVIDERS.join(', ')}`)
    }
    const current = await this.settings.currentStatus()
    const option = current.generation.options.find((o) => o.id === provider)
    if (!option?.available) {
      throw new ConflictException(
        `${option?.label ?? provider} can't be used: ${option?.reason ?? 'check Setup'}`,
      )
    }
    this.settings.setGenerationProvider(provider)
    return this.settings.currentStatus()
  }

  /** `PUT /api/setup/llm { provider }`: 400 for an unknown id, 409 when that AI isn't ready
   *  (checked live, not from the agents' 30 s cache); otherwise saves it and returns the new
   *  status, built from that same check. */
  @Put('llm')
  async setLlm(@Body() body: undefined | { provider?: unknown }): Promise<SetupStatus> {
    const provider = body?.provider
    if (!isLlmProvider(provider)) {
      throw new BadRequestException(`provider must be one of: ${LLM_PROVIDERS.join(', ')}`)
    }
    const current = await this.settings.refresh({ refresh: true })
    const option = current.llm.options.find((o) => o.id === provider)
    if (!option?.available) {
      throw new ConflictException(
        `${option?.label ?? provider} isn't ready: ${option?.reason ?? 'check Setup'}`,
      )
    }
    this.settings.setLlmProvider(provider)
    return this.settings.currentStatus()
  }

  /** `GET /api/setup/status[?refresh=1]`: the keys (set or not, never their values), Codex and
   *  Claude Code, and the AI and generation choices. A plain GET answers from the last check of
   *  the agents (startup, then every minute), with the keys and choices read again, so it never
   *  waits on their CLIs. `refresh=1` re-checks them now, bypassing their 30 s cache. */
  @Get('status')
  status(@Query('refresh') refresh?: string): Promise<SetupStatus> {
    return refresh === '1' || refresh === 'true'
      ? this.settings.refresh({ refresh: true })
      : this.settings.currentStatus()
  }
}
