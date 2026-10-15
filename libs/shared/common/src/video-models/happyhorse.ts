import type { ModelCapabilities } from './types'

/**
 * Happy Horse 1.1 image-to-video. Kept so projects that stored this id still
 * resolve (the registry maps it onto a `video.*` role); this is the vendor's
 * envelope: 720P/1080P only (no 480P), 3-15s, single
 * first-frame input (no last-frame variant exists -- the prompt route
 * compensates), output aspect ratio inherited from the input frame.
 */
export const HappyHorseModels = ['happyhorse-1.1-i2v'] as const

export type HappyHorseModel = (typeof HappyHorseModels)[number]

/**
 * Capped at 720p on purpose: the vendor has no 480p tier (a 480p
 * request is clamped UP to 720P) and its 1080P tier costs ~29%
 * more ($0.18/s vs $0.14/s) -- the cost basis is 720p, so the cap
 * keeps a project-wide 1080p request from silently buying the premium tier.
 * Raise to '1080p' only with a deliberate pricing decision.
 *
 * Takes no aspect-ratio parameter -- output inherits the input frame's ratio;
 * the vendor accepts any input with H/W 0.40-2.50 (live-API verified). The
 * listed ratios are the buckets in that envelope. Durations are live-API
 * verified: the vendor rejects anything outside with a typed InvalidParameter.
 */
export const HAPPY_HORSE_CAPABILITIES = {
  'happyhorse-1.1-i2v': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '720p',
  },
} as const satisfies Record<HappyHorseModel, ModelCapabilities>

/**
 * Returns true for any Happy Horse model id. Prefix-based so it keeps matching
 * if a versioned variant is added later. The `happyhorse` prefix is
 * deliberately distinct from the fal-hosted `happy-horse-` family, so the two
 * can never be mistaken for each other.
 */
export function isHappyHorseModel(model: null | string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('happyhorse')
}
