import type { ModelCapabilities } from './types'

/**
 * Bria object removal, fal-hosted. Its input
 * clip must be <= 5s and its prompt is the object to erase, not a scene
 * description; the output inherits the input's duration and aspect ratio, so
 * aspectRatio/durationSeconds are not forwarded. Deliberately kept OUT of
 * `AllVideoModels`: the generic generateVideo path has no plumbing for a
 * reference clip plus an erase target, so a debug-dropdown or long-take-regen
 * selection could only send an invalid request. Type-registered only (the
 * VideoGenModel union and the capability records), reachable solely via the
 * editor's inpaint eraser routing -- the same posture as Gemini Omni.
 */
export const BriaEraserModels = ['bria-video-eraser'] as const

export type BriaEraserModel = (typeof BriaEraserModels)[number]

/**
 * Takes no duration, aspect-ratio, or resolution parameter -- the output
 * inherits the input clip, which the vendor caps at 5s. The resolution cap must
 * therefore not downgrade it.
 */
export const BRIA_CAPABILITIES = {
  'bria-video-eraser': {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durationsSec: [1, 2, 3, 4, 5],
    maxResolution: '1080p',
  },
} as const satisfies Record<BriaEraserModel, ModelCapabilities>
