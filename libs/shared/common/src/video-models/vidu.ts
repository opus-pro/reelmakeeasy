import type { ModelCapabilities } from './types'

/**
 * Vidu (Shengshu) Q3 series, served via
 * the official Vidu API. Vidu bakes the capability into the model id
 * (`<tier>-<capability>`): t2v is prompt-only, i2v takes a first frame, and
 * startend takes first + last frames. `viduq3-ref` (reference-to-video) is
 * deliberately NOT registered: it requires 1-7 reference images, which
 * gen-video.ts has no plumbing to pass, so dispatching it could only fail.
 */
export const ViduModels = [
  'viduq3-pro-t2v',
  'viduq3-turbo-t2v',
  'viduq3-pro-i2v',
  'viduq3-turbo-i2v',
  'viduq3-pro-startend',
  'viduq3-turbo-startend',
] as const

export type ViduModel = (typeof ViduModels)[number]

// Vidu Q3 capability envelope, shared by every registered Vidu model.
// i2v/startend infer the output
// ratio from the input frame, so the ratio list is advisory there. Vidu offers
// 540p/720p/1080p output tiers on every endpoint; the lib maps a 480p request to
// Vidu's nearest 540p tier.
const VIDU_Q3: ModelCapabilities = {
  aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  durationsSec: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  maxResolution: '1080p',
}

export const VIDU_CAPABILITIES = {
  'viduq3-pro-t2v': VIDU_Q3,
  'viduq3-turbo-t2v': VIDU_Q3,
  'viduq3-pro-i2v': VIDU_Q3,
  'viduq3-turbo-i2v': VIDU_Q3,
  'viduq3-pro-startend': VIDU_Q3,
  'viduq3-turbo-startend': VIDU_Q3,
} as const satisfies Record<ViduModel, ModelCapabilities>

/**
 * Returns true for any Vidu model id. Matches the provider-family prefix (not
 * the Q3 generation) so a future generation ('viduq4-...') keeps resolving to
 * the vidu provider for breaker/metrics attribution.
 */
export function isViduModel(model: null | string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('vidu')
}
