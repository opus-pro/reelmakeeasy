/** Runs the google (Gemini API) adapters: build the request, call runGoogle, read the media. */
import { buildGeminiImageRequest, geminiImageBase64 } from './adapters/google-image'
import { buildLyriaRequest } from './adapters/google-music'
import { buildOmniRequest, buildVeoRequest, veoVideoUri } from './adapters/google-video'
import type {
  ImageRequestOptions,
  MusicRequestOptions,
  VideoRequestOptions,
} from './adapters/types'
import type { ResolvedModel } from './registry/resolve'
import type { VideoMode } from './registry/schema'
import { inlineParts, interactionContent, runGoogle } from './google'

/** One picture from Nano Banana on the Gemini API, as base64. */
export async function runGoogleImage(
  model: ResolvedModel,
  options: ImageRequestOptions,
): Promise<string> {
  const request = buildGeminiImageRequest(model, options)
  return geminiImageBase64(await runGoogle.generateContent(request.model, request.body))
}

/** One Lyria clip (MP3 bytes). */
export async function runGoogleMusic(
  model: ResolvedModel,
  options: MusicRequestOptions,
): Promise<Buffer> {
  const request = buildLyriaRequest(model, options)
  const [audio] = inlineParts(await runGoogle.generateContent(request.model, request.body), 'audio')
  return Buffer.from(audio?.data ?? '', 'base64')
}

/** One clip from Veo (long-running operation) or Omni Flash (Interactions API), as MP4 bytes. */
export async function runGoogleVideo(
  model: ResolvedModel,
  mode: VideoMode,
  options: VideoRequestOptions,
  timeoutMs?: number,
): Promise<{ bytes: Buffer; requestId: string }> {
  if (model.adapter === 'omni-google') {
    const request = buildOmniRequest(model, mode, options)
    const interaction = await runGoogle.createInteraction(request.body, { timeoutMs })
    const video = interactionContent(interaction, 'video')
    const bytes = video.data
      ? Buffer.from(video.data, 'base64')
      : await runGoogle.download(video.uri ?? '', { timeoutMs, waitUntilActive: true })
    return { bytes, requestId: interaction.id ?? request.model }
  }
  if (model.adapter !== 'veo-google')
    throw new Error(
      `Model "${model.key}": adapter "${model.adapter ?? 'none'}" can't make Gemini clips`,
    )
  const request = buildVeoRequest(model, mode, options)
  const operation = await runGoogle.predictLongRunning(request.model, request.body)
  const finished = await runGoogle.pollOperation(operation.name, { timeoutMs })
  return {
    bytes: await runGoogle.download(veoVideoUri(finished), { timeoutMs }),
    requestId: operation.name,
  }
}
