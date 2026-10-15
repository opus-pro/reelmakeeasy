import { createModelResolver } from '../registry/resolve'
import { parseModelRegistry } from '../registry/schema'
import { rawDefaults } from '../registry/test-helpers'

import { veo } from './veo'

const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
const veoFast = resolver.resolveModel('video', 'veo-3.1-fast', { mode: 'firstLast' })
const START = 'data:image/png;base64,U1RBUlQ='
const END = 'data:image/png;base64,RU5E'

describe('Veo 3.1 Fast on fal', () => {
  it('makes a 4 s first-to-last clip with sound when asked for exactly 4 s with audio', () => {
    expect(
      veo.buildRequest(veoFast, 'firstLast', {
        aspectRatio: '9:16',
        endImageUrl: END,
        exactDurationSeconds: 4,
        generateAudio: true,
        prompt: 'p',
        startImageUrl: START,
      }),
    ).toEqual({
      endpoint: 'fal-ai/veo3.1/fast/first-last-frame-to-video',
      input: {
        aspect_ratio: '9:16',
        duration: '4s',
        first_frame_url: START,
        generate_audio: true,
        last_frame_url: END,
        prompt: 'p',
      },
    })
  })

  it('stays silent by default and snaps other lengths up to 4, 6 or 8 s', () => {
    const input = (durationSeconds?: number) =>
      veo.buildRequest(veoFast, 'text', { durationSeconds, prompt: 'p' }).input
    expect(input(5)).toMatchObject({ duration: '6s', generate_audio: false })
    expect(input(undefined)).toMatchObject({ duration: '8s' })
  })

  it('refuses an exact length it does not make', () => {
    expect(() =>
      veo.buildRequest(veoFast, 'text', { exactDurationSeconds: 5, prompt: 'p' }),
    ).toThrow('Model "veo-3.1-fast" can\'t make a clip of exactly 5 s: it makes 4, 6 or 8 s')
  })
})
