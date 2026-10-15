import { BRIA_CAPABILITIES, type BriaEraserModel } from './bria'
import { BYTEDANCE_CAPABILITIES, type ByteDanceModel } from './bytedance'
import { ByteDanceModels } from './bytedance'
import { FAL_CAPABILITIES, type FalModel } from './fal'
import { FalModels } from './fal'
import { GEMINI_OMNI_CAPABILITIES, type GeminiOmniModel } from './gemini-omni'
import { HAPPY_HORSE_CAPABILITIES, type HappyHorseModel } from './happyhorse'
import { HappyHorseModels } from './happyhorse'
import { KLING_CAPABILITIES, type KlingModel, KlingModels } from './kling'
import { MINIMAX_CAPABILITIES, type MinimaxModel, MinimaxModels } from './minimax'
import type { ModelCapabilities } from './types'
import { VEO_CAPABILITIES, type VeoModel, VeoModels } from './veo'
import { VIDU_CAPABILITIES, type ViduModel, ViduModels } from './vidu'

export type VideoGenModel =
  | BriaEraserModel
  | ByteDanceModel
  | FalModel
  | GeminiOmniModel
  | HappyHorseModel
  | KlingModel
  | MinimaxModel
  | VeoModel
  | ViduModel

/**
 * The single capability table for every registered video model. A model that is
 * in `VideoGenModel` but missing here is a compile error, and vice versa.
 */
export const VIDEO_MODEL_CAPABILITIES = {
  ...VEO_CAPABILITIES,
  ...BYTEDANCE_CAPABILITIES,
  ...KLING_CAPABILITIES,
  ...FAL_CAPABILITIES,
  ...VIDU_CAPABILITIES,
  ...HAPPY_HORSE_CAPABILITIES,
  ...GEMINI_OMNI_CAPABILITIES,
  ...BRIA_CAPABILITIES,
  ...MINIMAX_CAPABILITIES,
} as const satisfies Record<VideoGenModel, ModelCapabilities>

// GeminiOmniModels is intentionally NOT spread here. AllVideoModels is the
// runtime "selectable / known" set -- it drives the debug model-switch dropdown
// and long-take regen validation. Omni stays type-registered (the VideoGenModel
// union and the capability records) but out of the selectable set until it is
// enabled via the selector config + gate.
// BriaEraserModels is NOT spread here either, for a permanent reason rather
// than a dark-launch one: the eraser needs a reference clip and an erase target
// that only the inpaint eraser path supplies (see its comment in ./bria.ts).
// HappyHorseModels IS spread here (unlike Omni): it follows the Seedance 2.0
// dark-launch pattern -- code-registered and routable, kept dark purely by the
// selector config (`enabled: false` + absent from every fallbackChain).
// Registration means the debug model-switch can reach it, exactly
// as it could Seedance 2.0 while dark.
// MinimaxModels follows the same pattern: code-registered so a selector config
// can expose Hailuo 3; without an entry for it (and with no fallbackChain naming
// it) it stays dark -- validateVideoModelId fails closed there.
export const AllVideoModels = [
  ...VeoModels,
  ...ByteDanceModels,
  ...KlingModels,
  ...FalModels,
  ...ViduModels,
  ...HappyHorseModels,
  ...MinimaxModels,
] as const satisfies readonly VideoGenModel[]

// Per-model duration, aspect-ratio and resolution lookups, the transition max
// duration and the native-audio predicate read the model registry now:
// `./registry` (server only, not re-exported from this browser-safe barrel).
