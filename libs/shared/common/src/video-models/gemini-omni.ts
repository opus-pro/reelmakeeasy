import type { ModelCapabilities } from './types'

/**
 * Gemini Omni Flash. Stable internal id used for routing, capability
 * records, circuit breaker, and metrics. The real provider model string is
 * resolved from the model registry at call time and is never hardcoded here.
 */
export const GeminiOmniModels = ['gemini-omni-flash'] as const

export type GeminiOmniModel = (typeof GeminiOmniModels)[number]

/**
 * 3-10s at 1s increments, 16:9 or 9:16 only.
 *
 * The resolution cap is kept at 1080p like the other primary models so a
 * project-wide resolution (and any higher-capped fallback clip) is not
 * downgraded by Omni's own ceiling. Omni itself outputs 720p natively;
 * transition generation requests 720p at the call site instead of relying on
 * this cap.
 */
export const GEMINI_OMNI_CAPABILITIES = {
  'gemini-omni-flash': {
    aspectRatios: ['16:9', '9:16'],
    durationsSec: [3, 4, 5, 6, 7, 8, 9, 10],
    maxResolution: '1080p',
  },
} as const satisfies Record<GeminiOmniModel, ModelCapabilities>

/**
 * Returns true for any Gemini Omni model id. Prefix-based so it keeps matching
 * if a versioned variant is added later.
 */
export function isGeminiOmniModel(model: null | string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('gemini-omni')
}
