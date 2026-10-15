/**
 * Re-export shim. The model registry and every capability table moved to
 * `../video-models`; this file exists so the ~84 modules importing
 * `@reelmakeeasy/common/veo3/model` need no change. New code should import from
 * `@reelmakeeasy/common/video-models` directly.
 *
 * The `veo3/` directory name is legacy -- it holds ALL video models, not just
 * Google Veo. Do not add new capability data here.
 */
export {
  AllVideoModels,
  type BriaEraserModel,
  BriaEraserModels,
  type ByteDanceModel,
  ByteDanceModels,
  type FalModel,
  FalModels,
  type GeminiOmniModel,
  GeminiOmniModels,
  type HappyHorseModel,
  HappyHorseModels,
  isGeminiOmniModel,
  isHappyHorseModel,
  isMinimaxModel,
  isSeedance2Model,
  isSeedance2xModel,
  isSeedance25Model,
  isSeedanceModel,
  isViduModel,
  type KlingModel,
  KlingModels,
  type MinimaxModel,
  MinimaxModels,
  SEEDANCE_2_TRANSITION_VIDEO_MODEL,
  SEEDANCE_25_TRANSITION_VIDEO_MODEL,
  type VeoModel,
  VeoModels,
  type VideoGenModel,
  type ViduModel,
  ViduModels,
} from '../video-models'
