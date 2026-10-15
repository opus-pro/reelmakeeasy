import type { ResolvedModel } from '../registry/resolve'

import { elevenlabsMusic } from './elevenlabs-music'

const model = {
  adapter: 'elevenlabs-music',
  endpoints: { generate: 'fal-ai/elevenlabs/music' },
  input: {},
  key: 'eleven-music',
  kind: 'music',
  label: 'ElevenLabs Music',
} as unknown as ResolvedModel

describe('elevenlabs-music adapter', () => {
  it('builds an instrumental request at the requested length', () => {
    const r = elevenlabsMusic.buildRequest(model, 'generate', {
      durationSec: 32.4,
      negativePrompt: 'vocals',
      prompt: 'warm piano',
    })
    expect(r.endpoint).toBe('fal-ai/elevenlabs/music')
    expect(r.input).toEqual({
      force_instrumental: true,
      music_length_ms: 32_400,
      output_format: 'mp3_44100_128',
      prompt: 'warm piano',
    })
  })

  it('clamps the length to what the model takes, and omits it when none is asked', () => {
    const at = (durationSec?: number) =>
      elevenlabsMusic.buildRequest(model, 'generate', { durationSec, prompt: 'x' }).input
    expect(at(1).music_length_ms).toBe(3000)
    expect(at(9999).music_length_ms).toBe(600_000)
    expect(at(undefined)).not.toHaveProperty('music_length_ms')
  })

  it('reads the audio url out of the response', () => {
    expect(elevenlabsMusic.parseOutput?.({ audio: { url: 'https://f/a.mp3' } })).toBe(
      'https://f/a.mp3',
    )
  })
})
