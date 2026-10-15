import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { prepareGoogleVideoFrames } from './adapters/google-video'
import {
  buildImageRequest,
  buildMusicRequest,
  buildVideoRequest,
  type ImageRequestOptions,
  type MusicRequestOptions,
  prepareVideoFrames,
  type VideoRequestOptions,
} from './adapters'
import { llmConfig } from './config'
import { toDataUri } from './content'
import { download, runFal } from './fal'
import { imageSizeOf } from './frame-fit'
import { runGoogleImage, runGoogleMusic, runGoogleVideo } from './google-media'
import {
  assertGenerationReady,
  type ResolvedModel,
  resolveModel,
  resolveVideoForFrames,
  type VideoMode,
} from './registry'
import type {
  AudioGenerationOptions,
  AudioGenerationResult,
  ImageGenerationOptions,
  ImageGenerationWithMetaResult,
  Model,
  VideoGenerationOptions,
  VideoGenerationWithMetaResult,
} from './types'

const run = promisify(execFile)

const first = (models: Model | Model[]): Model => (Array.isArray(models) ? models[0] : models) ?? ''

// ---------- images ----------

export async function generateImageWithMeta(
  options: ImageGenerationOptions,
): Promise<ImageGenerationWithMetaResult> {
  // The provider chosen in Setup can't run (its key is missing): fail with why, never swap.
  assertGenerationReady()
  const model = first(options.models)
  const references = await Promise.all(
    (options.contents ?? []).flatMap((c) =>
      c.type === 'image_url' ? [toDataUri(c.imageUrl)] : [],
    ),
  )
  const resolved = resolveModel('image', model, {
    role: options.role ?? (references.length ? 'image.edit' : 'image.generate'),
  })
  const request: ImageRequestOptions = {
    aspectRatio: options.aspectRatio,
    prompt: options.prompt,
    referenceImageUrls: references,
    resolution: options.imageSize,
  }
  const imageBase64 =
    resolved.provider === 'google'
      ? await runGoogleImage(resolved, request)
      : await falImage(resolved, request)
  return { imageBase64, model, usage: {} }
}

async function falImage(resolved: ResolvedModel, options: ImageRequestOptions): Promise<string> {
  const request = buildImageRequest(resolved, options)
  const { output } = await runFal(request.endpoint, request.input)
  const url = request.parseOutput(output)
  if (!url) throw new Error(`fal ${request.endpoint} returned no image`)
  return (await download(url)).toString('base64')
}

// ---------- video ----------

export async function generateVideo(
  options: VideoGenerationOptions,
): Promise<VideoGenerationWithMetaResult> {
  assertGenerationReady()
  const model = first(options.models)
  const start = options.firstFrameUrl ?? options.imageUrls?.[0]
  const [startUri, endUri] = await Promise.all([
    start ? toDataUri(start) : undefined,
    options.lastFrameUrl ? toDataUri(options.lastFrameUrl) : undefined,
  ])
  const resolved = resolveVideoForFrames(
    model,
    { end: endUri, start: startUri },
    { role: options.role },
  )
  const lastFrame = resolved.mode === 'firstLast' ? endUri : undefined
  const asked = { endImageUrl: lastFrame, startImageUrl: startUri }
  // Frames are fitted to the size the model renders when the registry lists it (H3, Omni).
  const frames =
    resolved.provider === 'google'
      ? await prepareGoogleVideoFrames(resolved, asked, { resolution: options.resolution })
      : await prepareVideoFrames(resolved, asked, { resolution: options.resolution })
  const fitted = frames.startImageUrl ?? frames.endImageUrl
  if (fitted && (frames.startImageUrl !== startUri || frames.endImageUrl !== lastFrame)) {
    const { height, width } = await imageSizeOf(fitted)
    llmConfig().logger.info(
      `[video] fitted first/last frames to ${width}x${height} for ${resolved.key}`,
    )
  }
  const mode = resolved.mode ?? 'text'
  const request: VideoRequestOptions = {
    aspectRatio: options.aspectRatio,
    durationSeconds: options.durationSeconds,
    endImageUrl: frames.endImageUrl,
    exactDurationSeconds: options.exactDurationSeconds,
    generateAudio: options.generateAudio,
    negativePrompt: options.negativePrompt,
    prompt: options.prompt,
    resolution: options.resolution,
    startImageUrl: frames.startImageUrl,
  }
  const { bytes, requestId } =
    resolved.provider === 'google'
      ? await runGoogleVideo(resolved, mode, request, options.timeout)
      : await falVideo(resolved, mode, request, options.timeout)
  await mkdir(path.dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, bytes)
  const meta = await probe(options.outputPath)
  return {
    height: meta.height,
    model,
    path: options.outputPath,
    processedDuration: meta.duration,
    providerTaskId: requestId,
    usage: { outputVideoTokens: meta.duration },
    width: meta.width,
  }
}

async function falVideo(
  resolved: ResolvedModel,
  mode: VideoMode,
  request: VideoRequestOptions,
  timeout?: number,
): Promise<{ bytes: Buffer; requestId: string }> {
  const built = buildVideoRequest(resolved, mode, request)
  const { output, requestId } = await runFal(built.endpoint, built.input, timeout)
  const url = built.parseOutput(output)
  if (!url) throw new Error(`fal ${built.endpoint} returned no video`)
  return { bytes: await download(url), requestId }
}

async function probe(file: string): Promise<{ duration: number; height: number; width: number }> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    file,
  ])
  const json = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: { height?: number; width?: number }[]
  }
  return {
    duration: Number(json.format?.duration ?? 0),
    height: json.streams?.[0]?.height ?? 0,
    width: json.streams?.[0]?.width ?? 0,
  }
}

// ---------- music ----------

export async function generateAudio(
  options: AudioGenerationOptions,
): Promise<AudioGenerationResult> {
  assertGenerationReady()
  const model = first(options.models)
  const resolved = resolveModel('music', model, { role: options.role ?? 'music' })
  const request: MusicRequestOptions = {
    durationSec: options.durationSec,
    negativePrompt: options.negativePrompt,
    prompt: options.prompt,
    tags: options.tags,
  }
  const audio =
    resolved.provider === 'google'
      ? await runGoogleMusic(resolved, request)
      : await falMusic(resolved, request)
  if ((options.format ?? 'mp3') !== 'mp3') return { audioBase64: audio.toString('base64'), model }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-audio-'))
  try {
    const input = path.join(dir, 'input')
    const out = path.join(dir, 'out.mp3')
    await writeFile(input, audio)
    await run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      input,
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      out,
    ])
    return { audioBase64: (await readFile(out)).toString('base64'), model }
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

async function falMusic(resolved: ResolvedModel, request: MusicRequestOptions): Promise<Buffer> {
  const built = buildMusicRequest(resolved, request)
  const { output } = await runFal(built.endpoint, built.input)
  const url = built.parseOutput(output)
  if (!url) throw new Error(`fal ${built.endpoint} returned no audio`)
  return download(url)
}
