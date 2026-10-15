import type { ModelCapabilities } from './types'

export const KlingModels = ['kling-3.0', 'kling-3.0-pro'] as const

export type KlingModel = (typeof KlingModels)[number]

/**
 * Kling has no resolution API parameter at all: the standard tier outputs
 * ~720p-class and the pro tier ~1080p-class natively, so the caps mirror what
 * each tier actually emits.
 */
export const KLING_CAPABILITIES = {
  'kling-3.0': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '720p',
  },
  'kling-3.0-pro': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
} as const satisfies Record<KlingModel, ModelCapabilities>
