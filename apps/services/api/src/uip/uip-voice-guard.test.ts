import { BadRequestException } from '@nestjs/common'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type { PrismaService } from '../prisma/prisma.service'
import type { ProjectService } from '../projects/projects.service'
import type { UserSavedStylesService } from '../user-saved-styles/user-saved-styles.service'
import type { VoiceOverService } from '../voice-over/voice-over.service'

import { UipService } from './uip.service'
import { assertUipVoiceUsable } from './uip-voice-guard'

const ENV = { ...process.env }
const NEEDS_GEMINI_KEY = 'Needs a Gemini key: add it in Setup'
const GEMINI_VOICE = { type: 'voice-over', voiceId: 'gemini-kore' } as ProjectVoiceOverJson

/** A UipService whose session row is `session`; records every write and workflow signal. */
function makeService(session: Record<string, unknown>) {
  const prisma = {
    $transaction: jest.fn(),
    project: { update: jest.fn() },
    uipSession: {
      findUnique: jest.fn(async () => session),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  const service = new UipService(
    prisma as unknown as PrismaService,
    {} as ProjectService,
    {} as VoiceOverService,
    {} as UserSavedStylesService,
  )
  jest.spyOn(service, 'assertUipAccess').mockResolvedValue()
  const signal = jest.spyOn(service, 'signalWorkflow').mockResolvedValue()
  return { prisma, service, signal }
}

function withoutGeminiKey() {
  process.env = { ...ENV, FAL_KEY: 'f' }
  delete process.env['GEMINI_API_KEY']
}

afterEach(() => {
  process.env = ENV
  jest.restoreAllMocks()
})

describe('a Gemini voice on an Easy (UIP) session without GEMINI_API_KEY', () => {
  beforeEach(withoutGeminiKey)

  it('is refused when the voice is changed during script review, before anything is saved or signalled', async () => {
    const { prisma, service, signal } = makeService({
      phase: 'script_review',
      state: {},
      status: 'active',
    })
    const update = service.sendGuiUpdate('p1', { voice: GEMINI_VOICE })
    await expect(update).rejects.toBeInstanceOf(BadRequestException)
    await expect(update).rejects.toThrow(NEEDS_GEMINI_KEY)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.uipSession.update).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  })

  it('is refused at confirm-fast, before the video is queued', async () => {
    const { prisma, service, signal } = makeService({
      phase: 'script_review',
      status: 'active',
      voiceId: 'gemini-kore',
    })
    const confirm = service.confirmFast('p1')
    await expect(confirm).rejects.toBeInstanceOf(BadRequestException)
    await expect(confirm).rejects.toThrow(NEEDS_GEMINI_KEY)
    expect(prisma.uipSession.updateMany).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  })

  it('is refused at confirm, before the video is queued', async () => {
    const { prisma, service, signal } = makeService({
      phase: 'refinement',
      state: {},
      status: 'active',
      timeline: [],
      voiceId: 'gemini-kore',
    })
    const confirm = service.confirmPlan('p1')
    await expect(confirm).rejects.toBeInstanceOf(BadRequestException)
    await expect(confirm).rejects.toThrow(NEEDS_GEMINI_KEY)
    expect(prisma.uipSession.updateMany).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  })
})

describe('assertUipVoiceUsable', () => {
  it('refuses a Gemini voice without the key, in the voice list words', () => {
    withoutGeminiKey()
    expect(() => assertUipVoiceUsable('gemini-kore')).toThrow(NEEDS_GEMINI_KEY)
  })

  it('lets a Gemini voice through with the key, whoever makes the videos', () => {
    process.env = { ...ENV, FAL_KEY: 'f', GEMINI_API_KEY: 'g' }
    expect(() => assertUipVoiceUsable('gemini-kore')).not.toThrow()
  })

  it('leaves other voices and no voice alone', () => {
    withoutGeminiKey()
    expect(() => assertUipVoiceUsable('kokoro-af_heart')).not.toThrow()
    expect(() => assertUipVoiceUsable(null)).not.toThrow()
    expect(() => assertUipVoiceUsable(undefined)).not.toThrow()
  })
})
