import { Controller, Get, Param, Query } from '@nestjs/common'
import { TtsEnginesResponse, VoiceOverOptionsResponse } from '@shared/types/api/voice-over'

import { VoiceOverService } from './voice-over.service'

@Controller('voice-over')
export class VoiceOverController {
  constructor(private readonly voiceOverService: VoiceOverService) {}

  @Get(':voiceId/preview')
  async getPresignedPreviewUrl(
    @Param('voiceId') voiceId: string,
  ): Promise<{ expiresAt: string; signedUrl: string }> {
    return this.voiceOverService.generatePresignedUrl(voiceId)
  }

  /** Where Kokoro, Qwen3 and ElevenLabs voices run (free on this machine, or paid). */
  @Get('engines')
  async getTtsEngines(): Promise<TtsEnginesResponse> {
    return this.voiceOverService.getTtsEngines()
  }

  @Get('')
  async getVoiceOverOptions(
    @Query('provider') provider: string,
  ): Promise<VoiceOverOptionsResponse> {
    return this.voiceOverService.getOptions(provider)
  }
}
