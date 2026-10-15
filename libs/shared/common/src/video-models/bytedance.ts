import type { ModelCapabilities } from './types'

export const ByteDanceModels = [
  'seedance-1-5-pro-251215',
  'seedance-1-0-pro-250528',
  'seedance-1-0-pro-fast-251015',
  'seedance-1-0-lite-i2v-250428',
  'seedance-1-0-lite-t2v-250428',
  'dreamina-seedance-2-0-260128',
  'dreamina-seedance-2-0-fast-260128',
  'dreamina-seedance-2-5-260628',
] as const

export type ByteDanceModel = (typeof ByteDanceModels)[number]

const SEEDANCE_25_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30,
]
const SEEDANCE_25_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']

/**
 * Seedance 1.0 lite 1080p support is inconsistently documented; capped at 720p
 * until verified against Ark. Seedance 2.5 currently documents 480p/720p output
 * only.
 *
 * `referenceVideoSec` minimums: below this the reference clip is too short to
 * drive v2v reliably and the worker falls back to i2v. Maximums: the provider
 * rejects a longer reference outright (Ark returns InvalidParameter on the
 * `reference_video` content part), so an over-length clip can never generate --
 * this must be checked before any generation starts, not just capped for the output
 * request. seedance-2-0's r2v ceiling is observed at 15.2s in testing (0/15
 * generations above it ever resolved, 285/285 at or below did); 15 keeps a
 * tolerance margin. seedance-1-5-pro-251215 takes no reference-video input at
 * all (BytePlus rejects any multimodal reference for this model), so it has no
 * `referenceVideoSec` row. seedance-2-5 (30) is NOT yet probed against real
 * provider rejections -- it is derived from the model's accepted
 * output-duration envelope, a weaker basis. Do not treat it as observed. Third-
 * party docs describe a 30s total across up to 10 video references
 * (unverified); it still needs an empirical check against the API.
 */
export const BYTEDANCE_CAPABILITIES = {
  'seedance-1-5-pro-251215': {
    aspectRatios: ['16:9', '9:16', '1:1', '3:4', '4:3', '21:9', 'adaptive'],
    durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    maxResolution: '1080p',
  },
  'seedance-1-0-pro-250528': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [2, 3, 4, 5, 6, 7, 8],
    maxResolution: '1080p',
  },
  'seedance-1-0-pro-fast-251015': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [2, 3, 4, 5, 6, 7, 8],
    maxResolution: '1080p',
  },
  'seedance-1-0-lite-i2v-250428': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [2, 3, 4, 5, 6, 7, 8],
    maxResolution: '720p',
  },
  'seedance-1-0-lite-t2v-250428': {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationsSec: [2, 3, 4, 5, 6, 7, 8],
    maxResolution: '720p',
  },
  'dreamina-seedance-2-0-260128': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
    // min observed: Ark InvalidParameter "audio duration ... must be
    // greater than or equal to 1.8 for model dreamina-seedance-2-0 in r2v"
    // (2026-08). Not probed on the -fast-
    // or 2.5 variants; do not copy this row to them without a real rejection.
    referenceAudioSec: { min: 1.8 },
    referenceVideoSec: { max: 15, min: 2 },
  },
  'dreamina-seedance-2-0-fast-260128': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durationsSec: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    maxResolution: '1080p',
  },
  'dreamina-seedance-2-5-260628': {
    aspectRatios: SEEDANCE_25_ASPECT_RATIOS,
    durationsSec: SEEDANCE_25_DURATIONS,
    maxResolution: '720p',
    // Both bounds are enforced by Ark, which rejects a reference image outside
    // them: the aspect envelope (e.g. 2.91 or 4.29) and the 300px floor (e.g.
    // a 429x100 anchor).
    referenceImage: { aspectRatio: { max: 2.5, min: 0.4 }, minDimensionPx: 300 },
    referenceVideoSec: { max: 30, min: 2 },
  },
} as const satisfies Record<ByteDanceModel, ModelCapabilities>

/**
 * Canonical Seedance 2.0 transition-video model used when the user toggles
 * "Seedance 2.0" in the Story Mode UI. The `-fast-` variant is available but
 * intentionally not the toggle default.
 */
export const SEEDANCE_2_TRANSITION_VIDEO_MODEL: ByteDanceModel = 'dreamina-seedance-2-0-260128'

/**
 * Seedance 2.5 transition-video model. Kept separate from the Seedance 2.0
 * toggle default so callers can opt in deliberately.
 */
export const SEEDANCE_25_TRANSITION_VIDEO_MODEL: ByteDanceModel = 'dreamina-seedance-2-5-260628'

/**
 * Returns true for Seedance 2.0 models. Prefix-based so it keeps matching
 * dated/fast 2.0 variants without treating newer major prompt/runtime families
 * as the legacy 2.0 selection.
 */
export function isSeedance2Model(model: null | string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('dreamina-seedance-2-0')
}

/**
 * Returns true for Seedance 2.5 models. Prefix-based so prompt routing keeps
 * working if BytePlus publishes a fast or dated 2.5 variant.
 */
export function isSeedance25Model(model: null | string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('dreamina-seedance-2-5')
}

/**
 * Returns true for Seedance 2.x transition-video models. Use this only where
 * 2.0 and 2.5 intentionally share provider/prompt-family behavior.
 */
export function isSeedance2xModel(model: null | string | undefined): boolean {
  return isSeedance2Model(model) || isSeedance25Model(model)
}

export function isSeedanceModel(model: null | string | undefined): boolean {
  return (
    typeof model === 'string' &&
    (model.startsWith('seedance') || model.startsWith('dreamina-seedance'))
  )
}
