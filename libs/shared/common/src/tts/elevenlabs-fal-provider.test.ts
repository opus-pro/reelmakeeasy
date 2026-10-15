import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'

import { isElevenLabsFalModel } from './elevenlabs-fal'

describe('isElevenLabsFalModel on any generation provider', () => {
  afterEach(() => resetGenerationProviderForTesting())

  it('recognises the fal ElevenLabs model while Gemini makes the videos', () => {
    setGenerationProvider('google')
    expect(isElevenLabsFalModel('eleven-v3-fal')).toBe(true)
    expect(isElevenLabsFalModel('eleven_v3')).toBe(false)
  })
})
