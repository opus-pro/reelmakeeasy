import type { ModelCapabilities } from './types'

/**
 * fal-hosted models. This is a HOSTING-provider group, not a model brand: it
 * deliberately mixes vendors (pixverse, grok, a fal-served Seedance 2.0, a
 * fal-served Kling o3 Pro) because provider attribution for the circuit breaker
 * and metrics keys off where the call actually goes. Do not re-group these by
 * brand.
 */
export const FalModels = [
  'pixverse-v6',
  'grok-imagine-video',
  'seedance-2-0-v2v',
  'seedance-2-0-i2v',
  'kling-o3-pro-v2v',
  'kling-o3-pro-i2v',
] as const

export type FalModel = (typeof FalModels)[number]

/**
 * kling-o3-pro's v2v endpoint only accepts 3-10s durations, so 10 is also its
 * reference-clip bound; its i2v endpoint accepts up to 15s.
 */
export const FAL_CAPABILITIES = {
  'pixverse-v6': {
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
    durationsSec: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
  'grok-imagine-video': {
    aspectRatios: ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'],
    durationsSec: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    maxResolution: '720p',
  },
  'seedance-2-0-v2v': {
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
  'seedance-2-0-i2v': {
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
  'kling-o3-pro-v2v': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10],
    maxResolution: '1080p',
    referenceVideoSec: { max: 10, min: 3 },
  },
  'kling-o3-pro-i2v': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
} as const satisfies Record<FalModel, ModelCapabilities>
