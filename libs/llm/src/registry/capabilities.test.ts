import { beatLoopVideoKeys, exactDuration, takesDuration } from './capabilities'
import { parseModelRegistry, type VideoCaps } from './schema'
import { defaultRegistry, rawDefaults } from './test-helpers'

const video = (key: string): VideoCaps => {
  const entry = defaultRegistry().models[key]
  if (entry?.kind !== 'video') throw new Error(`${key} is not a video model`)
  return entry.capabilities
}

describe('exact clip lengths', () => {
  const listed = { durationsSec: [4, 6, 8] }
  const ranged = { durationRangeSec: [0.92, 15] as [number, number], durationsSec: [5, 6, 7] }

  it('takes a listed length, or any length inside durationRangeSec', () => {
    expect([4, 6, 8, 5, 4.5].map((s) => takesDuration(listed, s))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
    expect([0.92, 4, 4.46, 15, 0.9, 15.5].map((s) => takesDuration(ranged, s))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ])
  })

  it('returns the exact length, or says which lengths the model makes', () => {
    expect(exactDuration(ranged, 4, 'h3')).toBe(4)
    expect(() => exactDuration(listed, 5, 'veo')).toThrow(
      'Model "veo" can\'t make a clip of exactly 5 s: it makes 4, 6 or 8 s',
    )
    expect(() => exactDuration(ranged, 16, 'h3')).toThrow(
      'Model "h3" can\'t make a clip of exactly 16 s: it makes 0.92 to 15 s',
    )
  })

  it('lets loops ask H3 for exactly 4 s while long-take lengths stay whole seconds from 5 s', () => {
    const h3 = video('minimax-h3-max-turbo')
    expect(h3.durationRangeSec).toEqual([0.92, 15])
    expect(Math.min(...h3.durationsSec)).toBe(5)
    expect(exactDuration(h3, 4, 'minimax-h3-max-turbo')).toBe(4)
  })
})

describe('loop clip models', () => {
  const registry = defaultRegistry()

  it('tries H3 on fal, then Omni Flash on Gemini, and never fal Veo (it missed the beat on every test clip)', () => {
    expect(registry.beatLoop?.video).toEqual(['minimax-h3-max-turbo', 'omni-flash-google'])
    expect(beatLoopVideoKeys(registry, () => true)).toEqual([
      'minimax-h3-max-turbo',
      'omni-flash-google',
    ])
    expect(registry.beatLoop?.video).not.toContain('veo-3.1-fast')
  })

  it('keeps only the models whose provider has its key', () => {
    expect(beatLoopVideoKeys(registry, (p) => p === 'google')).toEqual(['omni-flash-google'])
    expect(beatLoopVideoKeys(registry, (p) => p === 'fal')).toEqual(['minimax-h3-max-turbo'])
    expect(beatLoopVideoKeys(registry, () => false)).toEqual([])
    expect(beatLoopVideoKeys({ models: registry.models }, () => true)).toEqual([])
  })

  it('makes every loop model a 4 s first-to-last clip with sound', () => {
    for (const key of registry.beatLoop?.video ?? []) {
      const entry = registry.models[key]
      expect(entry?.kind === 'video' && entry.endpoints.firstLast).toBeTruthy()
      expect(takesDuration(video(key), 4)).toBe(true)
      expect(video(key).emitsNativeAudio).toBe(true)
    }
  })

  it('prices a 4 s loop clip as test clips were billed: H3 768P $0.16, Omni Flash about $0.415', () => {
    expect(4 * (video('minimax-h3-max-turbo').usdPerSecond?.['768p'] ?? 0)).toBeCloseTo(0.16, 3)
    expect(4 * (video('omni-flash-google').usdPerSecond?.['720p'] ?? 0)).toBeCloseTo(0.415, 2)
  })
})

describe('registry checks', () => {
  it('refuses a loop model that is unknown, not a clip model, or has no first-to-last mode', () => {
    const withLoop = (keys: string[]) => {
      const raw = rawDefaults()
      raw['beatLoop'] = { video: keys }
      return raw
    }
    expect(() => parseModelRegistry(withLoop(['nope']))).toThrow(
      /beatLoop\.video\.0 -> "nope" is not a model key/,
    )
    expect(() => parseModelRegistry(withLoop(['ace-step']))).toThrow(
      /beatLoop\.video\.0 -> "ace-step" is a music model; loops need video models/,
    )
    const raw = withLoop(['minimax-h3-max-turbo'])
    delete raw['models']['minimax-h3-max-turbo']['endpoints']['firstLast']
    raw['roles']['video.firstLast'] = 'veo-3.1-fast'
    expect(() => parseModelRegistry(raw)).toThrow(
      /beatLoop\.video\.0 -> "minimax-h3-max-turbo" has no endpoints\.firstLast/,
    )
  })

  it('refuses a duration range that ends before it starts', () => {
    const raw = rawDefaults()
    raw['models']['minimax-h3-max-turbo']['capabilities']['durationRangeSec'] = [15, 0.92]
    expect(() => parseModelRegistry(raw)).toThrow(
      /models\.minimax-h3-max-turbo\.capabilities\.durationRangeSec -> starts after it ends/,
    )
  })
})
