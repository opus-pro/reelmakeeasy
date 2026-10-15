import type { ResolvedModel } from '../registry/resolve'
import type { VideoMode } from '../registry/schema'

/** A fal request: the endpoint to call and its JSON input. */
export interface FalRequest {
  endpoint: string
  input: Record<string, unknown>
}

/** A Gemini API request: the model id and the JSON body. */
export interface GoogleRequest {
  body: Record<string, unknown>
  model: string
}

export interface ImageRequestOptions {
  aspectRatio?: string
  prompt: string
  /** Data URIs or URLs of reference images; their presence selects the edit endpoint. */
  referenceImageUrls?: string[]
  resolution?: '1K' | '2K' | '4K'
}

export interface MusicRequestOptions {
  /** The length to compose, for models that take one (others loop a clip afterwards). */
  durationSec?: number
  negativePrompt?: string
  prompt: string
  /** Comma-separated style tags, for models that take tags rather than prose. */
  tags?: string
}

export interface VideoRequestOptions {
  aspectRatio?: string
  durationSeconds?: number
  endImageUrl?: string
  /**
   * A length the clip must have, sent as it is (a loop's 4 s clip) instead of
   * `durationSeconds` snapped to the model's lengths. The request is refused
   * when the model can't make it (`durationsSec`, `durationRangeSec`).
   */
  exactDurationSeconds?: number
  generateAudio?: boolean
  negativePrompt?: string
  prompt: string
  referenceImageUrls?: string[]
  resolution?: string
  startImageUrl?: string
}

/**
 * Turns a resolved model and a request into a fal call, and reads the media
 * URL back out of the response.
 */
export interface FalAdapterModule<Mode, Options> {
  buildRequest(model: ResolvedModel, mode: Mode, options: Options): FalRequest
  parseOutput?(output: unknown): string | undefined
}

export type ImageAdapter = FalAdapterModule<'edit' | 'generate', ImageRequestOptions>
export type MusicAdapter = FalAdapterModule<'generate', MusicRequestOptions>
export type VideoAdapter = FalAdapterModule<VideoMode, VideoRequestOptions> & {
  /** Adjusts the start and end frames before upload (e.g. to the exact output size). */
  prepareFrames?(
    model: ResolvedModel,
    frames: VideoFrames,
    options: { resolution?: string },
  ): Promise<VideoFrames>
}

/** Resolves the model's endpoint for a mode, or throws naming what's missing. */
export function endpointFor(model: ResolvedModel, mode: string): string {
  const endpoint = model.endpoints[mode]
  if (!endpoint) throw new Error(`Model "${model.key}" has no ${mode} endpoint`)
  return endpoint
}

/** Merges the entry's `input` last, so config can override any built field. */
export const withEntryInput = (
  model: ResolvedModel,
  input: Record<string, unknown>,
): Record<string, unknown> => ({
  ...input,
  ...model.input,
})

/** Start and end frames of a video request, as data URIs. */
export interface VideoFrames {
  endImageUrl?: string
  startImageUrl?: string
}
