import type { ResolvedModel } from '../registry/resolve'

import { MINIMAX_INSTRUMENTAL_LYRICS, minimaxMusic } from './minimax-music'

const model = {
  adapter: 'minimax-music',
  endpoints: { generate: 'fal-ai/minimax-music/v2' },
  input: {},
  key: 'minimax-music-v2',
  kind: 'music',
  label: 'MiniMax Music 2.0',
} as unknown as ResolvedModel

describe('minimax-music adapter', () => {
  it('sends the description with instrumental-only song tags in place of lyrics', () => {
    const r = minimaxMusic.buildRequest(model, 'generate', {
      durationSec: 26,
      negativePrompt: 'vocals',
      prompt: 'French house, playful, 122 BPM. Instrumental.',
    })
    expect(r.endpoint).toBe('fal-ai/minimax-music/v2')
    expect(r.input).toEqual({
      audio_setting: { bitrate: 256_000, format: 'mp3', sample_rate: 44_100 },
      lyrics_prompt: MINIMAX_INSTRUMENTAL_LYRICS,
      prompt: 'French house, playful, 122 BPM. Instrumental.',
    })
    expect(MINIMAX_INSTRUMENTAL_LYRICS).toContain('[Instrumental]')
  })

  it('keeps the description within the 10-2000 characters the model takes', () => {
    const at = (prompt: string) =>
      minimaxMusic.buildRequest(model, 'generate', { prompt }).input.prompt as string
    expect(at('x'.repeat(2500))).toHaveLength(2000)
    expect(at('lofi').length).toBeGreaterThanOrEqual(10)
  })

  it('reads the audio url out of the response', () => {
    expect(minimaxMusic.parseOutput?.({ audio: { url: 'https://f/a.mp3' } })).toBe(
      'https://f/a.mp3',
    )
  })
})
