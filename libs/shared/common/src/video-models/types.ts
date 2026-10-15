import type { VideoResolution } from '../media/types'

/**
 * The complete capability envelope of one video generation model.
 *
 * Every per-model limit in this repo belongs in a record of this shape and
 * nowhere else. See docs/constraints/dont-scatter-model-capability-constants.md
 * for why (a producer cap and a consumer cap lived in modules that
 * never imported each other, so nothing ever compared them).
 *
 * Values only -- no dispatch logic. This module is imported by web bundles and
 * by jest specs that must not pull in the provider clients (libs/llm).
 */
export type ModelCapabilities = {
  /**
   * Output aspect ratios the provider accepts. 'adaptive' means the model
   * infers the ratio from its input frame rather than taking a parameter.
   */
  aspectRatios: readonly string[]
  /**
   * Exact output durations (seconds) the provider accepts. A discrete set, not
   * a range: most providers reject a duration that is not in this list.
   */
  durationsSec: readonly number[]
  /** Highest output resolution the model can produce. */
  maxResolution: VideoResolution
  /**
   * The r2v reference-audio input floor, for models that accept per-speaker
   * voice references. Absent means the model takes no reference audio. Below
   * the minimum the provider rejects the whole request outright (Ark returns
   * InvalidParameter on the `reference_audio` content part), so a too-short
   * sample can never generate -- producers must clear this floor before the
   * request is built.
   */
  referenceAudioSec?: { min: number }
  /**
   * The reference-IMAGE input envelope, for models that accept reference
   * images. Absent means the model takes no reference images (or none are
   * probed yet). Ark enforces both bounds per image and rejects the whole
   * create-task call on violation: `aspectRatio` as `InvalidParameter:
   * expected the aspect ratio to be between 0.40 and 2.50` on `image_url`,
   * `minDimensionPx` as `expected the height to be at least
   * 300px`. Like `referenceVideoSec`, this bounds what you can
   * feed IN -- it is unrelated to the output `aspectRatios` list above.
   */
  referenceImage?: { aspectRatio: { max: number; min: number }; minDimensionPx: number }
  /**
   * The v2v reference-clip input envelope, for models that accept a reference
   * video. Absent means the model takes no reference clip.
   *
   * This bounds what you can feed IN. It is deliberately NOT the same quantity
   * as the model's output duration envelope (`durationsSec`, and the inpaint
   * per-family output caps in ./inpaint.ts), which bounds what you can generate
   * OUT. They coincide numerically for several models today but mean different
   * things -- never derive one from the other.
   */
  referenceVideoSec?: { max: number; min: number }
}
