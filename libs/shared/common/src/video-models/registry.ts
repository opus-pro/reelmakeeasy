/**
 * Video model capabilities read from the model registry (`reelmakeeasy.models.json`).
 *
 * Node only: it resolves through the loaded registry, so it is NOT re-exported
 * from the `video-models` barrel (which browser bundles import). Server code
 * imports `@reelmakeeasy/common/video-models/registry` directly.
 *
 * Every id resolves the way generation resolves it: registry keys, aliases and
 * fal endpoint ids match directly; legacy ids (seedance-*, veo-3.0-*, ...) and
 * an absent id resolve through the `video.firstLast` role, which is what
 * Story Mode transitions generate on.
 */
import {
  clampResolution,
  maxDurationSec,
  resolveModel,
  type VideoCaps,
  type VideoRole,
} from '@reelmakeeasy/llm/registry'

import type { VideoResolution } from '../media/types'

/** The role transition clips resolve through when no model is named. */
export const TRANSITION_VIDEO_ROLE: VideoRole = 'video.firstLast'

export function supportedAspectRatios(model?: null | string): readonly string[] {
  return videoModelCapabilities(model).aspectRatios
}

export function validDuration(model?: null | string): readonly number[] {
  return videoModelCapabilities(model).durationsSec
}

/** Capabilities of the model `model` resolves to (the `video.firstLast` role when absent or legacy). */
export function videoModelCapabilities(
  model?: null | string,
  role: VideoRole = TRANSITION_VIDEO_ROLE,
): VideoCaps {
  return resolveModel('video', model ?? undefined, { role }).capabilities as VideoCaps
}

export function videoResolutionCap(model?: null | string): VideoResolution {
  return videoModelCapabilities(model).maxResolution
}

/** Caps a requested resolution at what `model` can produce. */
export function clampVideoResolution(
  requested: VideoResolution,
  model?: null | string,
): VideoResolution {
  return clampResolution(videoModelCapabilities(model), requested) as VideoResolution
}

/** The longest clip `model` produces. An absent id means the `video.firstLast` role. */
export function getMaxSupportedVideoDurationSeconds(model?: null | string): number {
  return maxDurationSec(videoModelCapabilities(model))
}

/**
 * Whether the model's clips carry a native audio track (speech or soundtrack
 * invented from the prompt) that transitions must strip. Set per model with
 * `capabilities.emitsNativeAudio` in the registry.
 */
export function emitsNativeAudio(model: null | string | undefined): boolean {
  if (!model) {
    return false
  }
  return videoModelCapabilities(model).emitsNativeAudio === true
}

/**
 * Whether transitions on `model` are made one after another, each clip starting
 * from the previous clip's last frame (`capabilities.chainTransitions`). An
 * absent id means the `video.firstLast` role.
 */
export function chainsTransitions(model?: null | string): boolean {
  return videoModelCapabilities(model).chainTransitions === true
}

/** Transition prompt ceiling for `model`; 2500 chars when the registry sets none. */
export function videoPromptMaxChars(model?: null | string): number {
  return videoModelCapabilities(model).promptMaxChars ?? DEFAULT_VIDEO_PROMPT_MAX_CHARS
}

/** The provider that makes `model`'s clips (fal or google), for breaker ids and metrics. */
export function videoProviderOf(model?: null | string): string {
  return resolveModel('video', model ?? undefined, { role: TRANSITION_VIDEO_ROLE }).provider
}

export const DEFAULT_VIDEO_PROMPT_MAX_CHARS = 2500
