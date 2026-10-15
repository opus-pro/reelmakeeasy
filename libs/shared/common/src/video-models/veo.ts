import type { ModelCapabilities } from './types'

export const VeoModels = [
  'veo-3.0-fast-generate-001',
  'veo-3.1-generate-001',
  'veo-3.0-generate-001',
  'veo-2.0-generate-001',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-fast-generate-001',
] as const

export type VeoModel = (typeof VeoModels)[number]

/**
 * Veo 3.0 supports 1080p only for 16:9; story mode defaults to 9:16, so the cap
 * stays 720p (Veo 3.1 supports 1080p on both).
 */
export const VEO_CAPABILITIES = {
  'veo-2.0-generate-001': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [5, 6, 7, 8],
    maxResolution: '720p',
  },
  'veo-3.0-generate-001': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [4, 6, 8],
    maxResolution: '720p',
  },
  'veo-3.0-fast-generate-001': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [4, 6, 8],
    maxResolution: '720p',
  },
  'veo-3.1-generate-001': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [4, 6, 8],
    maxResolution: '1080p',
  },
  'veo-3.1-fast-generate-preview': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [4, 6, 8],
    maxResolution: '1080p',
  },
  'veo-3.1-fast-generate-001': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [4, 6, 8],
    maxResolution: '1080p',
  },
} as const satisfies Record<VeoModel, ModelCapabilities>
