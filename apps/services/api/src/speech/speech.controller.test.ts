import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'

import { MAX_DICTATION_BYTES, SpeechController } from './speech.controller'
import {
  DictationFailedError,
  DictationUnavailableError,
  type SpeechService,
} from './speech.service'

function controller(overrides: Partial<SpeechService> = {}) {
  const speech = {
    prewarm: jest.fn().mockResolvedValue({ engine: 'local', warming: true }),
    setSetting: jest.fn(),
    status: jest.fn().mockResolvedValue({ engine: 'gemini', options: [], setting: 'auto' }),
    transcribe: jest.fn().mockResolvedValue({ engine: 'gemini', text: 'hello there' }),
    ...overrides,
  } as unknown as SpeechService
  return { api: new SpeechController(speech), speech }
}

const audio = Buffer.from('fake webm bytes').toString('base64')

describe('SpeechController', () => {
  it('transcribes base64 audio on the engine in use', async () => {
    const { api, speech } = controller()
    await expect(api.transcribe({ audio })).resolves.toEqual({
      engine: 'gemini',
      text: 'hello there',
    })
    expect(speech.transcribe).toHaveBeenCalledWith(Buffer.from('fake webm bytes'), undefined)
  })

  it('passes a requested engine through, and refuses an unknown one', async () => {
    const { api, speech } = controller()
    await api.transcribe({ audio, engine: 'fal' })
    expect(speech.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'fal')
    await expect(api.transcribe({ audio, engine: 'siri' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('refuses a missing or too-long recording', async () => {
    const { api } = controller()
    await expect(api.transcribe({})).rejects.toBeInstanceOf(BadRequestException)
    await expect(api.transcribe({ audio: '' })).rejects.toBeInstanceOf(BadRequestException)
    const tooLong = Buffer.alloc(MAX_DICTATION_BYTES + 1).toString('base64')
    await expect(api.transcribe({ audio: tooLong })).rejects.toThrow(/under two minutes/)
  })

  it('answers 409 when voice typing is off or runs in the browser', async () => {
    const { api } = controller({
      transcribe: jest
        .fn()
        .mockRejectedValue(new DictationUnavailableError('Voice typing is off.')),
    })
    await expect(api.transcribe({ audio })).rejects.toBeInstanceOf(ConflictException)
  })

  it('answers 503 in plain words when the engine fails', async () => {
    const { api } = controller({
      transcribe: jest
        .fn()
        .mockRejectedValue(new DictationFailedError("Couldn't turn that into text on fal.")),
    })
    await expect(api.transcribe({ audio })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('saves a known setting and refuses others', async () => {
    const { api, speech } = controller()
    await api.setSetting({ setting: 'local' })
    expect(speech.setSetting).toHaveBeenCalledWith('local')
    await expect(api.setSetting({ setting: 'whisper' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(api.setSetting(undefined)).rejects.toBeInstanceOf(BadRequestException)
  })
})
