import { createModelResolver } from '../registry/resolve'
import { parseModelRegistry } from '../registry/schema'
import { rawDefaults } from '../registry/test-helpers'

import { minimaxVideo } from './minimax-video'

const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
const h3 = resolver.resolveModel('video', 'minimax-h3-max-turbo', { mode: 'firstLast' })
const START = 'data:image/png;base64,U1RBUlQ='
const END = 'data:image/png;base64,RU5E'
const firstLast = { endImageUrl: END, prompt: 'p', resolution: '768p', startImageUrl: START }
const duration = (o: Parameters<typeof minimaxVideo.buildRequest>[2]) =>
  minimaxVideo.buildRequest(h3, 'firstLast', o).input['duration']

describe('Hailuo 3 on fal', () => {
  it('still asks for 5 s for a 3.8 s long-take slot (whole seconds from 5 to 15)', () => {
    expect(duration({ ...firstLast, durationSeconds: 3.8 })).toBe(5)
    expect(duration({ ...firstLast, durationSeconds: 6.2 })).toBe(7)
    expect(duration(firstLast)).toBe(5)
  })

  it("sends a loop's exact 4 s, first and last frame, at 768P with fal's prompt expansion off", () => {
    expect(
      minimaxVideo.buildRequest(h3, 'firstLast', {
        ...firstLast,
        durationSeconds: 3.8,
        exactDurationSeconds: 4,
      }),
    ).toEqual({
      endpoint: 'minimax/h3-max-turbo/image-to-video',
      input: {
        duration: 4,
        end_image_url: END,
        image_url: START,
        prompt: 'p',
        prompt_expansion_mode: 'disabled',
        resolution: '768P',
      },
    })
  })

  it('refuses an exact length outside 0.92 to 15 s instead of changing it', () => {
    expect(() => duration({ ...firstLast, exactDurationSeconds: 0.5 })).toThrow(
      'Model "minimax-h3-max-turbo" can\'t make a clip of exactly 0.5 s: it makes 0.92 to 15 s',
    )
    expect(() => duration({ ...firstLast, exactDurationSeconds: 16 })).toThrow(/exactly 16 s/)
  })
})
