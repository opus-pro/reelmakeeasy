import {
  resetGenerationProviderForTesting,
  resetModelRegistryForTesting,
  setGenerationProvider,
} from '@reelmakeeasy/llm/registry'

import { getDefaultVideoModelId, getVideoModelFallbackChain } from '../veo3/video-model-selection'

import {
  emitsNativeAudio,
  getMaxSupportedVideoDurationSeconds,
  validDuration,
  videoProviderOf,
} from './registry'

beforeEach(() => {
  resetModelRegistryForTesting()
  setGenerationProvider('google')
})

afterEach(() => resetGenerationProviderForTesting())

describe('clips on the google provider', () => {
  it('strip the sound Veo and Omni always make, so only narration and music are heard', () => {
    for (const key of [
      'veo-3.1-fast-google',
      'veo-3.1-lite-google',
      'veo-3.1-google',
      'omni-flash-google',
    ]) {
      expect(emitsNativeAudio(key)).toBe(true)
    }
  })

  it('plan transitions within 10 s on Omni Flash by default, at any length from 3 to 10 s', () => {
    expect(getDefaultVideoModelId()).toBe('omni-flash-google')
    expect(getMaxSupportedVideoDurationSeconds()).toBe(10)
    expect(validDuration()).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('plan transitions within 8 s on a Veo model picked in the menu', () => {
    for (const key of ['veo-3.1-fast-google', 'veo-3.1-lite-google', 'veo-3.1-google']) {
      expect(getMaxSupportedVideoDurationSeconds(key)).toBe(8)
      expect(validDuration(key)).toEqual([4, 6, 8])
    }
  })

  it('fall back from Omni Flash to Veo 3.1 Fast, never to fal', () => {
    expect(getVideoModelFallbackChain('omni-flash-google')).toEqual(['veo-3.1-fast-google'])
    expect(getVideoModelFallbackChain(null)).toEqual([])
  })

  it('report the provider that runs the clip', () => {
    expect(videoProviderOf()).toBe('google')
    expect(videoProviderOf('veo-3.1-fast-google')).toBe('google')
    setGenerationProvider('fal')
    expect(videoProviderOf('minimax-h3-max-turbo')).toBe('fal')
  })
})
