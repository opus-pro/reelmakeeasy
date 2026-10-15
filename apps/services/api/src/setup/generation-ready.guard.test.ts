import {
  GENERATION_NOT_SET_UP_MESSAGE,
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { ConflictException } from '@nestjs/common'

import { GenerationReadyGuard } from './generation-ready.guard'

const REASON =
  'Gemini is chosen in Setup but GEMINI_API_KEY is missing: add it to .env and restart, or pick fal'

describe('GenerationReadyGuard', () => {
  afterEach(() => resetGenerationProviderForTesting())

  it('lets a start through while fal or Gemini can make the video', () => {
    setGenerationProvider('google')
    expect(new GenerationReadyGuard().canActivate()).toBe(true)
  })

  it('refuses with the same words and reason as the long-take start', () => {
    setGenerationProvider('google')
    setGenerationUnavailable(REASON)
    const guard = new GenerationReadyGuard()
    expect(() => guard.canActivate()).toThrow(ConflictException)
    expect(() => guard.canActivate()).toThrow(`${GENERATION_NOT_SET_UP_MESSAGE}. ${REASON}`)
  })
})
