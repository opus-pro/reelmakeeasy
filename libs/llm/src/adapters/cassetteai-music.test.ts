import type { ResolvedModel } from '../registry/resolve'

import { cassetteaiMusic } from './cassetteai-music'

const model = {
  adapter: 'cassetteai-music',
  endpoints: { generate: 'cassetteai/music-generator' },
  input: {},
  key: 'cassette-music',
  kind: 'music',
  label: 'CassetteAI Music',
} as unknown as ResolvedModel

describe('cassetteai-music adapter', () => {
  it('asks for the requested length in whole seconds', () => {
    const r = cassetteaiMusic.buildRequest(model, 'generate', {
      durationSec: 25.4,
      negativePrompt: 'vocals',
      prompt: 'warm piano. Instrumental.',
    })
    expect(r.endpoint).toBe('cassetteai/music-generator')
    expect(r.input).toEqual({ duration: 26, prompt: 'warm piano. Instrumental.' })
  })

  it('clamps the length to 10-180 s and asks for 30 s when none is given', () => {
    const at = (durationSec?: number) =>
      cassetteaiMusic.buildRequest(model, 'generate', { durationSec, prompt: 'x' }).input.duration
    expect(at(3)).toBe(10)
    expect(at(900)).toBe(180)
    expect(at(undefined)).toBe(30)
  })

  it('reads the audio_file url out of the response', () => {
    expect(cassetteaiMusic.parseOutput?.({ audio_file: { url: 'https://f/a.wav' } })).toBe(
      'https://f/a.wav',
    )
  })
})
