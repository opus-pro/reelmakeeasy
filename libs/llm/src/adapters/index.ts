import type { ResolvedModel } from '../registry/resolve'
import type { FalAdapter, VideoMode } from '../registry/schema'

import { aceStep } from './ace-step'
import { cassetteaiMusic } from './cassetteai-music'
import { elevenlabsMusic } from './elevenlabs-music'
import { falOutputUrl, genericImage, genericMusic, genericVideo } from './generic'
import { gptImage } from './gpt-image'
import { lyria } from './lyria'
import { minimaxMusic } from './minimax-music'
import { minimaxVideo } from './minimax-video'
import { nanoBanana } from './nano-banana'
import { seedream } from './seedream'
import type {
  FalRequest,
  ImageAdapter,
  ImageRequestOptions,
  MusicAdapter,
  MusicRequestOptions,
  VideoAdapter,
  VideoFrames,
  VideoRequestOptions,
} from './types'
import { veo } from './veo'

export { falOutputUrl } from './generic'
export { gptImageSize } from './gpt-image'
export { seedreamImageSize } from './seedream'
export { klingLipsyncEndpoint, minimaxSpeechEndpoint, minimaxVoiceCloneEndpoint } from './speech'
export type * from './types'

const IMAGE_ADAPTERS: Partial<Record<FalAdapter, ImageAdapter>> = {
  generic: genericImage,
  'gpt-image': gptImage,
  'nano-banana': nanoBanana,
  seedream,
}
const VIDEO_ADAPTERS: Partial<Record<FalAdapter, VideoAdapter>> = {
  generic: genericVideo,
  'minimax-video': minimaxVideo,
  veo,
}
const MUSIC_ADAPTERS: Partial<Record<FalAdapter, MusicAdapter>> = {
  'ace-step': aceStep,
  'cassetteai-music': cassetteaiMusic,
  'elevenlabs-music': elevenlabsMusic,
  generic: genericMusic,
  lyria,
  'minimax-music': minimaxMusic,
}

export interface BuiltFalRequest extends FalRequest {
  parseOutput(output: unknown): string | undefined
}

function pick<T>(table: Partial<Record<FalAdapter, T>>, model: ResolvedModel): T {
  const adapter = table[model.adapter as FalAdapter]
  if (!adapter)
    throw new Error(
      `Model "${model.key}": adapter "${model.adapter ?? 'none'}" can't build ${model.kind} requests`,
    )
  return adapter
}

const built = (
  adapter: { parseOutput?: (o: unknown) => string | undefined },
  request: FalRequest,
): BuiltFalRequest => ({
  ...request,
  parseOutput: adapter.parseOutput ?? falOutputUrl,
})

export function buildImageRequest(
  model: ResolvedModel,
  options: ImageRequestOptions,
): BuiltFalRequest {
  const adapter = pick(IMAGE_ADAPTERS, model)
  const mode = options.referenceImageUrls?.length ? 'edit' : 'generate'
  return built(adapter, adapter.buildRequest(model, mode, options))
}

export function buildMusicRequest(
  model: ResolvedModel,
  options: MusicRequestOptions,
): BuiltFalRequest {
  const adapter = pick(MUSIC_ADAPTERS, model)
  return built(adapter, adapter.buildRequest(model, 'generate', options))
}

export function buildVideoRequest(
  model: ResolvedModel,
  mode: VideoMode,
  options: VideoRequestOptions,
): BuiltFalRequest {
  const adapter = pick(VIDEO_ADAPTERS, model)
  return built(adapter, adapter.buildRequest(model, mode, options))
}

/** Lets the model's adapter adjust the start and end frames before upload. */
export async function prepareVideoFrames(
  model: ResolvedModel,
  frames: VideoFrames,
  options: { resolution?: string },
): Promise<VideoFrames> {
  const adapter = pick(VIDEO_ADAPTERS, model)
  return adapter.prepareFrames ? adapter.prepareFrames(model, frames, options) : frames
}
