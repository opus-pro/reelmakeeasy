import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import type { DictationEngine, DictationStatus } from '@shared/types/api/setup'

import { LoopbackOnlyGuard } from '../agent/loopback-only.guard'
import { DICTATION_SETTINGS, isDictationSetting } from '../setup/setup-status'

import { DICTATION_ENGINES } from './dictation'
import { DictationFailedError, DictationUnavailableError, SpeechService } from './speech.service'

/** About two minutes of browser-recorded Opus, with room to spare. */
export const MAX_DICTATION_BYTES = 6 * 1024 * 1024

@Controller('speech')
// Voice typing spends the user's Gemini or fal key and reads their microphone's recording:
// only this computer may call it (see the guard).
@UseGuards(LoopbackOnlyGuard)
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}

  /** `POST /api/speech/prewarm`: loads Whisper ahead of a recording when it's in use. */
  @HttpCode(200)
  @Post('prewarm')
  prewarm(): Promise<{ engine: DictationEngine | null; warming: boolean }> {
    return this.speech.prewarm()
  }

  /** `PUT /api/speech/dictation { setting }`: `auto`, an engine, or `off`. */
  @Put('dictation')
  async setSetting(@Body() body: undefined | { setting?: unknown }): Promise<DictationStatus> {
    const setting = body?.setting
    if (!isDictationSetting(setting)) {
      throw new BadRequestException(`setting must be one of: ${DICTATION_SETTINGS.join(', ')}`)
    }
    this.speech.setSetting(setting)
    return this.speech.status()
  }

  /** `GET /api/speech/dictation`: the engine voice typing uses, and every engine's availability. */
  @Get('dictation')
  status(): Promise<DictationStatus> {
    return this.speech.status()
  }

  /**
   * `POST /api/speech/transcribe { audio, engine? }`: `audio` is the recording, base64 (any
   * format FFmpeg reads: the browser sends WebM/Opus). Answers `{ text, engine }`. 409 when
   * voice typing is off or runs in the browser.
   */
  @HttpCode(200)
  @Post('transcribe')
  async transcribe(
    @Body() body: undefined | { audio?: unknown; engine?: unknown },
  ): Promise<{ engine: DictationEngine; text: string }> {
    const audio = typeof body?.audio === 'string' ? Buffer.from(body.audio, 'base64') : null
    if (!audio?.length) throw new BadRequestException('audio is required (base64)')
    if (audio.length > MAX_DICTATION_BYTES) {
      throw new BadRequestException('That recording is too long: keep it under two minutes.')
    }
    const engine = body?.engine
    if (engine !== undefined && !DICTATION_ENGINES.includes(engine as DictationEngine)) {
      throw new BadRequestException(`engine must be one of: ${DICTATION_ENGINES.join(', ')}`)
    }
    try {
      return await this.speech.transcribe(audio, engine as DictationEngine | undefined)
    } catch (error) {
      if (error instanceof DictationUnavailableError) throw new ConflictException(error.message)
      if (error instanceof DictationFailedError)
        throw new ServiceUnavailableException(error.message)
      throw error
    }
  }
}
