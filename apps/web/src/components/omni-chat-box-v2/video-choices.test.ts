import type { ModelsResponse } from '@shared/types/api/models'

import {
  effectiveQuality,
  effectiveVideoModel,
  offeredQualities,
  qualityNote,
  videoGenerationParams,
  videoModelChoices,
} from './video-choices'

const caps = (resolutions: string[], usdPerSecond: Record<string, number>) => ({
  aspectRatios: ['16:9', '9:16'],
  audio: true,
  durationsSec: [4, 6, 8],
  maxResolution: '1080p',
  resolutions,
  usdPerSecond,
})

const gemini = {
  generationProvider: 'google',
  models: {
    'omni-flash-google': {
      capabilities: caps(['720p'], { '720p': 0.1 }),
      kind: 'video',
      label: 'Gemini Omni Flash',
      provider: 'google',
    },
    'veo-3.1-fast-google': {
      capabilities: caps(['720p', '1080p'], { '1080p': 0.12, '720p': 0.1 }),
      kind: 'video',
      label: 'Veo 3.1 Fast (Gemini)',
      provider: 'google',
    },
    'veo-3.1-lite-google': {
      capabilities: caps(['720p', '1080p'], { '1080p': 0.08, '720p': 0.05 }),
      kind: 'video',
      label: 'Veo 3.1 Lite (Gemini)',
      provider: 'google',
    },
  },
  roles: { 'video.firstLast': { key: 'omni-flash-google', label: 'Gemini Omni Flash' } },
  videoChoices: ['omni-flash-google', 'veo-3.1-fast-google', 'veo-3.1-lite-google'],
} as unknown as ModelsResponse

const fal = {
  generationProvider: 'fal',
  models: {
    'minimax-h3-max-turbo': {
      capabilities: caps(['480p', '768p', '1080p'], { '768p': 0.04 }),
      kind: 'video',
      label: 'MiniMax Hailuo 3 Max Turbo',
      provider: 'fal',
    },
  },
  roles: {
    'video.firstLast': { key: 'minimax-h3-max-turbo', label: 'MiniMax Hailuo 3 Max Turbo' },
  },
  videoChoices: [],
} as unknown as ModelsResponse

describe('clip model choices', () => {
  it('lists the Gemini clip models with their starting price, the default (Omni Flash) recommended', () => {
    expect(videoModelChoices(gemini)).toEqual([
      {
        key: 'omni-flash-google',
        label: 'Gemini Omni Flash',
        price: 'from $0.1/s',
        recommended: true,
      },
      {
        key: 'veo-3.1-fast-google',
        label: 'Veo 3.1 Fast (Gemini)',
        price: 'from $0.1/s',
        recommended: false,
      },
      {
        key: 'veo-3.1-lite-google',
        label: 'Veo 3.1 Lite (Gemini)',
        price: 'from $0.05/s',
        recommended: false,
      },
    ])
    expect(videoModelChoices(fal)).toEqual([])
  })

  it('uses a stored pick the provider offers, else its default', () => {
    expect(effectiveVideoModel(gemini, 'veo-3.1-lite-google')).toBe('veo-3.1-lite-google')
    expect(effectiveVideoModel(gemini, 'minimax-h3-max-turbo')).toBe('omni-flash-google')
    expect(effectiveVideoModel(gemini, null)).toBe('omni-flash-google')
  })
})

describe('qualities', () => {
  it('follow the chosen clip model', () => {
    const offered = offeredQualities(gemini, 'veo-3.1-fast-google')
    expect(offered).toEqual(['720p', '1080p'])
    expect(effectiveQuality(offered, '768p')).toBe('720p')
    expect(effectiveQuality(offered, '1080p')).toBe('1080p')
    expect(offeredQualities(gemini, 'omni-flash-google')).toEqual(['720p'])
  })

  it('note the recommended, sharpest and cheapest options', () => {
    expect(['720p', '1080p'].map((q) => qualityNote(q as never, ['720p', '1080p']))).toEqual([
      'Recommended',
      'Sharpest',
    ])
    expect(
      ['480p', '768p', '1080p'].map((q) => qualityNote(q as never, ['480p', '768p', '1080p'])),
    ).toEqual(['Cheapest', 'Recommended', 'Sharpest'])
  })
})

describe('videoGenerationParams', () => {
  it('sends the Gemini clip model and a resolution it makes', () => {
    expect(videoGenerationParams(gemini, 'veo-3.1-lite-google', '768p')).toEqual({
      generationResolution: { videoResolution: '720p' },
      transitionVideoModel: 'veo-3.1-lite-google',
    })
  })

  it('sends Omni Flash at 720p on Gemini when nothing is picked', () => {
    expect(videoGenerationParams(gemini, null, '768p')).toEqual({
      generationResolution: { videoResolution: '720p' },
      transitionVideoModel: 'omni-flash-google',
    })
  })

  it('sends only the resolution on fal, as before', () => {
    expect(videoGenerationParams(fal, null, '768p')).toEqual({
      generationResolution: { videoResolution: '768p' },
    })
  })
})
