import type { ModelCapabilities } from './types'

/**
 * MiniMax Hailuo 3, served via the
 * MiniMax `/v2` async video flow. The id is the SDK/upstream `model` string
 * (case-sensitive). t2v is prompt-only, and boundary frames select frame-guided
 * mode: a first frame, a last frame, or both (the story-mode transition case,
 * `first_frame` + `last_frame` content blocks). `MiniMax-Hailuo-2.3` (the
 * legacy `/v1` flow) is deliberately NOT registered.
 */
export const MinimaxModels = ['MiniMax-H3'] as const

export type MinimaxModel = (typeof MinimaxModels)[number]

/**
 * Hailuo 3 capability envelope. Any integer duration 5-15s. In frame-guided mode the output
 * ratio adapts to the supplied frame(s), so the ratio list is advisory there.
 * H3 outputs exactly two tiers -- 768P and 2K: the lib maps a 480p/720p request
 * to 768P and 1080p to 2K, so the cap stays at the 1080p class like the other
 * primary models.
 */
const MINIMAX_H3: ModelCapabilities = {
  aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  durationsSec: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  maxResolution: '1080p',
}

export const MINIMAX_CAPABILITIES = {
  'MiniMax-H3': MINIMAX_H3,
} as const satisfies Record<MinimaxModel, ModelCapabilities>

/**
 * Returns true for any MiniMax video model id. Matches the provider-family
 * prefix (not the H3 generation) so a future generation ('MiniMax-H4') keeps
 * resolving to the minimax provider for breaker/metrics attribution, mirroring
 * the other family helpers. Also matches registry
 * keys for Hailuo video on fal (`minimax-h3-max-turbo`), which get the same
 * Hailuo 3 transition prompt.
 */
export function isMinimaxModel(model: null | string | undefined): boolean {
  return typeof model === 'string' && (model.startsWith('MiniMax') || /^minimax-h\d/.test(model))
}
