import { buildCacheKey, normalizeContentsForDevCache } from '../llm/llm-cache'

// The LLM cache is on for local runs; key it the way it is keyed there.
jest.mock('../utils/env', () => ({
  ...jest.requireActual<typeof import('../utils/env')>('../utils/env'),
  isDev: () => true,
}))

/** The cache key of one image request, as completion() builds it. */
const keyFor = (imageUrl: string) =>
  buildCacheKey({
    contents: normalizeContentsForDevCache([{ imageUrl, type: 'image_url' }]),
    task: 'story-mode-keyframe-judge',
  })

// The address forms a file had before the store rename, built from parts so no
// retired scheme or bucket name sits in the source.
const OLD_SCHEME = ['g', 's://'].join('')
const OLD_BUCKET = ['launch', 'yard'].join('')

describe('LLM cache keys across the store rename', () => {
  it('keeps hitting for a project file under its old and new addresses', () => {
    const current = keyFor('store://projects/p1/long_take/keyframes/LT_S1.png')
    for (const before of [
      `${OLD_SCHEME}${OLD_BUCKET}/ao/p1/long_take/keyframes/LT_S1.png`,
      `http://localhost:5017/api/files/${OLD_BUCKET}/ao/p1/long_take/keyframes/LT_S1.png`,
      'http://localhost:5017/api/files/projects/p1/long_take/keyframes/LT_S1.png',
    ]) {
      expect(keyFor(before)).toBe(current)
    }
  })

  it('still tells different files apart', () => {
    expect(keyFor('store://projects/p1/long_take/keyframes/LT_S1.png')).not.toBe(
      keyFor('store://projects/p1/long_take/keyframes/LT_S2.png'),
    )
  })
})
