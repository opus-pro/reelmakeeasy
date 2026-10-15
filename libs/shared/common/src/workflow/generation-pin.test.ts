import {
  currentGenerationProvider,
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationProviderPin,
} from '@reelmakeeasy/llm/registry'

import { getReqContext, hasContext, runWithContext } from '../utils/req-ctx'

import { runContextPropagator } from './engine-setup'
import { pinnedGenerationProvider } from './generation-pin'

beforeEach(() => setGenerationProviderPin(pinnedGenerationProvider))
afterEach(() => resetGenerationProviderForTesting())

describe('a run keeps the generation provider it started with', () => {
  it('stays on Gemini when Setup switches to fal mid-run', async () => {
    setGenerationProvider('google')
    const started = runContextPropagator.capture()
    setGenerationProvider('fal')
    const inRun = await runContextPropagator.run(started, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return currentGenerationProvider()
    })
    expect(inRun).toBe('google')
    expect(currentGenerationProvider()).toBe('fal')
  })

  it('still carries the request identity when there is one', () => {
    const started = runWithContext({ user_id: 'u1' }, () => runContextPropagator.capture())
    const seen = runContextPropagator.run(started, () => ({
      provider: currentGenerationProvider(),
      user: getReqContext().user_id,
    }))
    expect(seen).toEqual({ provider: 'fal', user: 'u1' })
    expect(runContextPropagator.run(runContextPropagator.capture(), () => hasContext())).toBe(false)
  })
})
