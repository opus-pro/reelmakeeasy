const mockWorkflowStart = jest.fn(async () => undefined)
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { start: mockWorkflowStart } }),
}))

import {
  GENERATION_NOT_SET_UP_MESSAGE,
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { ConflictException } from '@nestjs/common'

import { LongTakeService } from './long-take.service'

const REASON =
  'Gemini is chosen in Setup but GEMINI_API_KEY is missing: add it to .env and restart, or pick fal'

describe('starting a video when the generation provider cannot run', () => {
  afterEach(() => resetGenerationProviderForTesting())

  it('is refused with the Setup message and the reason, before anything is created', async () => {
    setGenerationProvider('google')
    setGenerationUnavailable(REASON)
    const projectsService = { getProject: jest.fn() }
    const prisma = { project: { create: jest.fn(), findUnique: jest.fn() } }
    const svc = new LongTakeService(
      projectsService as never,
      {} as never,
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
    )
    const user = { email: '', orgId: 'o', sub: 'u', userId: 'u' }
    const start = svc.startWorkflow(user as never, 'a video about honey', 'Honey never goes bad.')
    await expect(start).rejects.toBeInstanceOf(ConflictException)
    await expect(start).rejects.toThrow(`${GENERATION_NOT_SET_UP_MESSAGE}. ${REASON}`)
    expect(projectsService.getProject).not.toHaveBeenCalled()
    expect(prisma.project.create).not.toHaveBeenCalled()
    expect(mockWorkflowStart).not.toHaveBeenCalled()
  })
})
