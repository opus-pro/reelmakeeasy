import { BadRequestException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'

import { resolveLongTakeRequestVoice } from './long-take-voice-guard.util'

const ENV = { ...process.env }
const deps = {
  logger: { warn: jest.fn() },
  prisma: { userVoiceClone: { findMany: async () => [] } } as unknown as PrismaService,
}

afterEach(() => {
  process.env = ENV
})

describe('a Gemini voice on a video start', () => {
  it('is refused in plain words without GEMINI_API_KEY, before anything runs', async () => {
    process.env = { ...ENV, FAL_KEY: 'f' }
    delete process.env['GEMINI_API_KEY']
    const start = resolveLongTakeRequestVoice(deps, 'gemini-kore', undefined)
    await expect(start).rejects.toBeInstanceOf(BadRequestException)
    await expect(start).rejects.toThrow('Needs a Gemini key: add it in Setup')
  })

  it('is kept with GEMINI_API_KEY, whoever makes the videos', async () => {
    process.env = { ...ENV, FAL_KEY: 'f', GEMINI_API_KEY: 'g' }
    await expect(
      resolveLongTakeRequestVoice(deps, 'gemini-kore', undefined),
    ).resolves.toMatchObject({
      validatedVoiceId: 'gemini-kore',
      voiceOverJson: { provider: 'gemini', type: 'voice-over', voiceId: 'gemini-kore' },
    })
  })

  it('leaves other voices alone without GEMINI_API_KEY', async () => {
    process.env = { ...ENV, FAL_KEY: 'f' }
    delete process.env['GEMINI_API_KEY']
    await expect(
      resolveLongTakeRequestVoice(deps, 'kokoro-af_heart', undefined),
    ).resolves.toMatchObject({ validatedVoiceId: 'kokoro-af_heart' })
  })
})
