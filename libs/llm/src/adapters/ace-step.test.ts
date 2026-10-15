import type { ResolvedModel } from '../registry/resolve'

import { aceStep } from './ace-step'

const model = {
  adapter: 'ace-step',
  endpoints: { generate: 'fal-ai/ace-step' },
  input: {},
  key: 'ace-step',
  kind: 'music',
  label: 'ACE-Step',
} as unknown as ResolvedModel

describe('ace-step adapter', () => {
  it('sends style tags, the instrumental marker and the length', () => {
    const r = aceStep.buildRequest(model, 'generate', {
      durationSec: 25.2,
      prompt: 'Warm lo-fi with electric piano. Instrumental.',
      tags: 'lo-fi hip hop, chill, electric piano, 82 bpm, instrumental',
    })
    expect(r.endpoint).toBe('fal-ai/ace-step')
    expect(r.input).toEqual({
      duration: 26,
      lyrics: '[instrumental]',
      tags: 'lo-fi hip hop, chill, electric piano, 82 bpm, instrumental',
    })
  })

  it('uses the prompt when there are no tags, and keeps the length within 5-240 s', () => {
    const at = (durationSec?: number) =>
      aceStep.buildRequest(model, 'generate', { durationSec, prompt: 'warm piano' }).input
    expect(at(2)).toMatchObject({ duration: 5, tags: 'warm piano' })
    expect(at(999).duration).toBe(240)
    expect(at(undefined).duration).toBe(60)
  })

  it('reads the audio url out of the response', () => {
    expect(aceStep.parseOutput?.({ audio: { url: 'https://f/a.wav' } })).toBe('https://f/a.wav')
  })
})
