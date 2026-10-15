import { localAsrEnabled } from '@reelmakeeasy/common/asr/asr-backend'
import { falSpeechToText } from '@reelmakeeasy/common/asr/fal-scribe'
import { geminiDictate, toSpeechMp3 } from '@reelmakeeasy/common/asr/gemini-dictate'
import { localSpeechToText } from '@reelmakeeasy/common/asr/local-asr'
import { Logger } from '@reelmakeeasy/common/logger'
import { localTtsHealth } from '@reelmakeeasy/common/tts/local-tts'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable } from '@nestjs/common'
import type { DictationEngine, DictationSetting, DictationStatus } from '@shared/types/api/setup'

import { SetupSettingsService } from '../setup/setup-settings.service'
import { readKeys } from '../setup/setup-status'

import { DICTATION_LABEL, type DictationInputs, dictationStatus } from './dictation'

/** Half a second of 16 kHz mono silence: enough to make the local server load Whisper. */
export class DictationUnavailableError extends Error {}

function silentWav(seconds = 0.5, rate = 16_000): Buffer {
  const samples = Math.round(seconds * rate)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples * 2, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples * 2, 40)
  return Buffer.concat([header, Buffer.alloc(samples * 2)])
}

/** The engine was reached but failed (a provider error, a bad recording). */
export class DictationFailedError extends Error {}

/** Voice typing: which engine turns speech into text, and doing it. */
@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name)
  private warming: null | Promise<void> = null

  constructor(private readonly settings: SetupSettingsService) {}

  /** Loads Whisper ahead of a recording when it's the engine in use, so the first one is quick.
   *  Answers at once; one load at a time. */
  async prewarm(): Promise<{ engine: DictationEngine | null; warming: boolean }> {
    const { engine } = await this.status()
    if (engine !== 'local') return { engine, warming: false }
    this.warming ??= localSpeechToText(new Blob([silentWav()], { type: 'audio/wav' }), {
      languageCode: 'en',
    })
      .then(() => undefined)
      .catch((error) => this.logger.warn(`Couldn't load Whisper: ${ensureError(error).message}`))
      .finally(() => {
        this.warming = null
      })
    return { engine, warming: true }
  }

  setSetting(setting: DictationSetting): void {
    this.settings.setDictation(setting)
  }

  async status(): Promise<DictationStatus> {
    return dictationStatus(await this.inputs())
  }

  /**
   * The text in a recording, on the engine in use (or `requested`, when it's available). The
   * browser engine never reaches here: the page recognises speech itself.
   */
  async transcribe(
    audio: Buffer,
    requested?: DictationEngine,
  ): Promise<{ engine: DictationEngine; text: string }> {
    const status = await this.status()
    const available = (engine: DictationEngine) =>
      status.options.find((o) => o.id === engine)?.available === true
    const engine = requested && available(requested) ? requested : status.engine
    if (!engine) throw new DictationUnavailableError('Voice typing is off. Turn it on in Setup.')
    if (engine === 'browser') {
      throw new DictationUnavailableError(
        'Voice typing uses your browser here: the page recognises speech itself.',
      )
    }
    const started = Date.now()
    let text: string
    try {
      text = await this.run(engine, audio)
    } catch (error) {
      this.logger.warn(`Voice typing on ${engine} failed: ${ensureError(error).message}`)
      throw new DictationFailedError(
        `Couldn't turn that into text on ${DICTATION_LABEL[engine]}. Try again, or pick another engine.`,
      )
    }
    this.logger.log(
      `Voice typing on ${engine}: ${text.length} characters in ${Date.now() - started}ms`,
    )
    return { engine, text }
  }

  private async inputs(): Promise<DictationInputs> {
    const env = process.env
    const health = await localTtsHealth()
    const keys = readKeys(env)
    return {
      keys: { fal: keys.fal, gemini: keys.gemini },
      local: health
        ? {
            device: health.stt?.device ?? health.backend,
            transcribe: Boolean(health.stt?.transcribe),
          }
        : null,
      localAsrOff: !localAsrEnabled(env),
      setting: this.settings.stored().dictation ?? 'auto',
    }
  }

  private async run(engine: Exclude<DictationEngine, 'browser'>, audio: Buffer): Promise<string> {
    switch (engine) {
      case 'fal': {
        // fal's Scribe takes mp3, wav, m4a, ogg, flac or aac, not the browser's WebM.
        const mp3 = await toSpeechMp3(audio)
        const file = new Blob([mp3], { type: 'audio/mpeg' })
        return (
          await falSpeechToText(file, { languageCode: 'en', tagAudioEvents: false })
        ).text.trim()
      }
      case 'gemini': {
        return geminiDictate(audio)
      }
      case 'local': {
        return (await localSpeechToText(new Blob([audio]), { languageCode: 'en' })).text.trim()
      }
    }
  }
}
