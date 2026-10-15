import {
  GENERATION_NOT_SET_UP_MESSAGE,
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { ConflictException } from '@nestjs/common'

import { LongTakeService } from './long-take.service'

const REASON = 'Add FAL_KEY or GEMINI_API_KEY to .env, then restart'
/** Phase 3's refusal: `generationNotReadyMessage()` with the reason. */
const REFUSAL = `${GENERATION_NOT_SET_UP_MESSAGE}. ${REASON}`

function makeService() {
  return new LongTakeService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
}

describe('LongTakeService when nothing can make the video', () => {
  afterEach(() => resetGenerationProviderForTesting())

  it('assertCanStart answers as the start does, for callers that start later', () => {
    const svc = makeService()
    setGenerationProvider('fal')
    expect(() => svc.assertCanStart()).not.toThrow()
    setGenerationUnavailable(REASON)
    expect(() => svc.assertCanStart()).toThrow(ConflictException)
    expect(() => svc.assertCanStart()).toThrow(REFUSAL)
  })
})
