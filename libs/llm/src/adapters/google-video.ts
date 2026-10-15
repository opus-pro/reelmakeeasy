import { fitImageToSize, imageSizeOf, nearestFrameSize } from '../frame-fit'
import { GoogleApiError, type GoogleOperation, inlineDataFromUri, safetyError } from '../google'
import {
  clampResolution,
  exactDuration,
  nearestDuration,
  snapDuration,
} from '../registry/capabilities'
import type { ResolvedModel } from '../registry/resolve'
import type { VideoCaps, VideoMode } from '../registry/schema'

import type { GoogleRequest, VideoFrames, VideoRequestOptions } from './types'
import { endpointFor, withEntryInput } from './types'

/** The only clip length Veo on the Gemini API takes a last frame for. */
const VEO_LAST_FRAME_SECONDS = 8

/** Omni's role tag naming the input pictures, as the first line of a prompt (`[# Sources ...]`). */
const SOURCES_TAG = /^\s*\[#\s*Sources\b[^\]\n]*\][ \t]*\r?\n?/
/** A prompt's closing music line (`non_diegetic_music: N/A`), which must stay last. */
const MUSIC_LINE = /\n+non_diegetic_music:[^\n]*\s*$/
const SOURCE_NAMES = ['<FIRST_FRAME>', '<LAST_FRAME>']

interface VeoResponse {
  generateVideoResponse?: {
    generatedSamples?: { video?: { uri?: string } }[]
    raiMediaFilteredCount?: number
    raiMediaFilteredReasons?: string[]
  }
}

/**
 * Gemini Omni Flash (Interactions API): the first frame, and the last one for
 * first-to-last clips, before the prompt; the clip comes back as a file URI,
 * which the API gives only for a stored interaction (`store: true`). The clip is
 * asked for at its own length, to the nearest whole second from 3 to 10 s (no
 * 8 s rule as on Veo), so it reaches the next keyframe with little retiming;
 * an exact length (a loop's "4s") is sent as asked. Always at the listed 720p:
 * the finished video is upscaled at the end, so anchors stay native. Omni
 * always makes sound (there is no switch). It takes no negative prompt, so what
 * to avoid is said in the prompt, before a closing `non_diegetic_music` line.
 * A prompt that opens with a `[# Sources ...]` tag gets the tag for the
 * pictures actually sent.
 */
export function buildOmniRequest(
  model: ResolvedModel,
  mode: VideoMode,
  o: VideoRequestOptions,
): GoogleRequest {
  refuseReference(model, mode)
  const caps = model.capabilities as VideoCaps
  const durationSec =
    o.exactDurationSeconds === undefined
      ? nearestDuration(caps, o.durationSeconds ?? Math.max(...caps.durationsSec))
      : exactDuration(caps, o.exactDurationSeconds, model.key)
  const frames = [
    mode === 'text' ? undefined : o.startImageUrl,
    mode === 'firstLast' ? o.endImageUrl : undefined,
  ].filter((uri): uri is string => Boolean(uri))
  const aspectRatio = supportedAspect(caps, o.aspectRatio)
  const id = endpointFor(model, mode)
  const prompt = withSourcesTag(o.prompt, frames.length)
  return {
    body: withEntryInput(model, {
      input: [
        ...frames.map((uri) => {
          const { data, mimeType } = inlineDataFromUri(uri)
          return { data, mime_type: mimeType, type: 'image' }
        }),
        { text: withAvoid(prompt, o.negativePrompt), type: 'text' },
      ],
      model: id,
      response_format: {
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        delivery: 'uri',
        duration: `${durationSec}s`,
        resolution: listedResolution(caps, o.resolution),
        type: 'video',
      },
      // The live API refuses URI delivery without it ("store=true is required ...").
      store: true,
    }),
    model: id,
  }
}

/**
 * Veo 3.1 on the Gemini API (predictLongRunning): text, first frame, or first
 * and last frame. Frames go as `{ bytesBase64Encoded, mimeType }`: the live API
 * refuses `inlineData` here. Lengths snap to 4, 6 or 8 s, except that a clip
 * with a last frame is always 8 s: the live API refused a last frame on a 4 s
 * clip ("Your use case is currently not supported") on Veo 3.1, Fast and Lite,
 * and took it on 8 s ones, so an exact length other than 8 s with a last frame
 * is refused. What to avoid is said in the prompt. One clip per
 * request (the API default). Veo always adds sound; the transition step strips
 * it (`emitsNativeAudio`).
 */
export function buildVeoRequest(
  model: ResolvedModel,
  mode: VideoMode,
  o: VideoRequestOptions,
): GoogleRequest {
  refuseReference(model, mode)
  const caps = model.capabilities as VideoCaps
  const lastFrame = mode === 'firstLast' && o.endImageUrl ? veoImage(o.endImageUrl) : undefined
  const exact = o.exactDurationSeconds
  if (lastFrame && exact !== undefined && exact !== VEO_LAST_FRAME_SECONDS)
    throw new Error(
      `Model "${model.key}" can't make a first-to-last clip of exactly ${exact} s: with a last frame it makes ${VEO_LAST_FRAME_SECONDS} s only`,
    )
  const durationSeconds = lastFrame
    ? VEO_LAST_FRAME_SECONDS
    : exact === undefined
      ? snapDuration(caps, o.durationSeconds ?? Math.max(...caps.durationsSec))
      : exactDuration(caps, exact, model.key)
  const aspectRatio = supportedAspect(caps, o.aspectRatio)
  // Veo 3.1 Lite refuses `negativePrompt` ("isn't supported by this model"), so what to
  // avoid goes in the prompt for every Veo model, the same way as for Omni.
  const instance = {
    prompt: withAvoid(o.prompt, o.negativePrompt),
    ...(mode !== 'text' && o.startImageUrl ? { image: veoImage(o.startImageUrl) } : {}),
    ...(lastFrame ? { lastFrame } : {}),
  }
  return {
    body: withEntryInput(model, {
      instances: [instance],
      parameters: {
        ...(aspectRatio ? { aspectRatio } : {}),
        durationSeconds,
        resolution: veoResolution(caps, o.resolution, durationSeconds),
      },
    }),
    model: endpointFor(model, mode),
  }
}

/** Veo renders 720p, or 1080p for 8-second clips only; shorter 1080p asks are made at 720p. */
export function veoResolution(
  caps: VideoCaps,
  requested: string | undefined,
  durationSec: number,
): '720p' | '1080p' {
  return requested && durationSec === 8 && clampResolution(caps, requested) === '1080p'
    ? '1080p'
    : '720p'
}

/** The finished clip's URI; a clip held back by the safety filter fails as a policy block. */
export function veoVideoUri(op: GoogleOperation): string {
  const res = (op.response ?? {}) as VeoResponse
  const uri = res.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  if (uri) return uri
  const reasons = res.generateVideoResponse?.raiMediaFilteredReasons ?? []
  if (reasons.length || res.generateVideoResponse?.raiMediaFilteredCount) {
    // A reason naming the input picture means the frames were refused, not the words.
    const text = reasons.join('; ')
    throw safetyError(/image|photo|picture/i.test(text) ? 'IMAGE_SAFETY' : 'SAFETY')
  }
  throw new GoogleApiError({
    message: `Gemini ${op.name} finished without a video`,
    providerCode: 'no_output',
  })
}

/** Omni's tag naming the pictures sent, in order: `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]`. */
export function omniSourcesTag(pictures: number): string {
  const names = SOURCE_NAMES.slice(0, pictures).map((name, i) => `${name}@Image${i + 1}`)
  return names.length ? `[# Sources ${names.join(' ')}]` : ''
}

/**
 * Fits the first and last frame of a Gemini clip to the exact size the model
 * renders (`capabilities.frameSizes`, Omni's 720x1280 or 1280x720): cropped
 * to the shape, then scaled. Omni crops a mismatched picture itself, and
 * matching it beforehand lifted the last-frame match from about 0.72 to
 * 0.85-0.94 (SSIM). Models without frame sizes (Veo), and pictures that can't
 * be read, go as they are.
 */
export async function prepareGoogleVideoFrames(
  model: ResolvedModel,
  frames: VideoFrames,
  options: { resolution?: string } = {},
): Promise<VideoFrames> {
  const caps = model.capabilities as VideoCaps
  const sizes = caps.frameSizes?.[listedResolution(caps, options.resolution)]
  const first = frames.startImageUrl ?? frames.endImageUrl
  if (!sizes || !first) return frames
  try {
    const source = await imageSizeOf(first)
    const size = nearestFrameSize(sizes, source.width, source.height)
    if (!size) return frames
    const fit = (uri?: string) => (uri ? fitImageToSize(uri, size[0], size[1]) : undefined)
    const [startImageUrl, endImageUrl] = await Promise.all([
      fit(frames.startImageUrl),
      fit(frames.endImageUrl),
    ])
    return { endImageUrl, startImageUrl }
  } catch {
    return frames
  }
}

/** The requested resolution when the model lists it, else its highest (Omni: 720p). */
function listedResolution(caps: VideoCaps, requested?: string): string {
  return requested && caps.resolutions?.includes(requested) ? requested : caps.maxResolution
}

function refuseReference(model: ResolvedModel, mode: VideoMode): void {
  if (mode === 'reference')
    throw new Error(`Model "${model.key}" doesn't take reference pictures here`)
}

function supportedAspect(caps: VideoCaps, ratio?: string): string | undefined {
  return ratio && caps.aspectRatios.includes(ratio) ? ratio : undefined
}

/** A Veo frame, the way Google's own SDK sends it to the Gemini API. */
function veoImage(uri: string): { bytesBase64Encoded: string; mimeType: string } {
  const { data, mimeType } = inlineDataFromUri(uri)
  return { bytesBase64Encoded: data, mimeType }
}

/** What to avoid, said in the prompt, before a closing music line so that line stays last. */
function withAvoid(prompt: string, negativePrompt?: string): string {
  const avoid = negativePrompt?.trim()
  if (!avoid) return prompt
  const music = MUSIC_LINE.exec(prompt)
  return music
    ? `${prompt.slice(0, music.index)}\n\nAvoid: ${avoid}${music[0]}`
    : `${prompt}\n\nAvoid: ${avoid}`
}

/** Replaces a prompt's opening Sources tag with one naming only the pictures sent. */
function withSourcesTag(prompt: string, pictures: number): string {
  if (!SOURCES_TAG.test(prompt)) return prompt
  const tag = omniSourcesTag(pictures)
  return prompt.replace(SOURCES_TAG, tag ? `${tag}\n` : '')
}
