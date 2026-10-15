import fs from 'node:fs'

import { LLM } from '@reelmakeeasy/llm'
import {
  fallbacksFor,
  type ResolvedModel,
  resolveVideoForFrames,
  supportsAspect,
  type VideoCaps,
  videoModeForFrames,
  type VideoRole,
} from '@reelmakeeasy/llm/registry'

import type { CircuitBreakerInstance } from '../circuit-breaker'
import { resolveBreakerScope } from '../circuit-breaker'
import { JobContext } from '../job-context'
import {
  hashFileContent,
  isCacheEnabled,
  saveCachedBinaryToFile,
  tryReadBinaryMeta,
  tryWriteBinary,
} from '../llm/llm-cache'
import { logger } from '../logger'
import type { VideoResolution } from '../media/types'
import { getReqContext } from '../utils/req-ctx'
import {
  clampVideoResolution,
  getMaxSupportedVideoDurationSeconds,
  videoProviderOf,
} from '../video-models/registry'

export interface GenVideoInput {
  aspectRatio: string
  /**
   * If set, the resized first/last frame PNGs actually sent to the video model
   * are written to this directory for inspection. Files are named
   * `{targetFilePaths[0]}_first_frame_resized.png` and
   * `{targetFilePaths[0]}_last_frame_resized.png`.
   */
  debugOutputDir?: string
  duration: number
  firstFramePath?: string
  generateAudio?: boolean
  lastFramePath?: string
  /** Registry key, alias, fal endpoint or legacy id; absent means the role for the frames given. */
  model?: string
  negativePrompt?: string
  outputDir: string
  prompt: string
  /**
   * Requested output resolution, clamped per model capability
   * before dispatch. Absent => provider default (720p today).
   */
  resolution?: VideoResolution
  sampleCount?: number
  targetFilePaths?: string[]
}

export type GenVideoOptions = {
  /** Optional circuit breaker instance. When provided, provider health is checked before routing. */
  breaker?: CircuitBreakerInstance
  /** Scope for breaker key isolation (e.g. lane name, env). Auto-resolved from JobContext if omitted. */
  breakerScope?: string
}

export { getMaxSupportedVideoDurationSeconds } from '../video-models/registry'

export type GenVideoOutput = {
  height: number
  path: string
  processedDuration: number
  /** The actual model used for generation (may differ from requested if breaker triggered fallback) */
  resolvedModel?: string
  width: number
}

export function isWithinModelMaxVideoDuration(
  model: null | string | undefined,
  durationSeconds: number,
): boolean {
  const maxDurationSeconds = getMaxSupportedVideoDurationSeconds(model)
  return Number.isFinite(maxDurationSeconds) && durationSeconds <= maxDurationSeconds
}

/**
 * Resolve the provider name for a given video model.
 */
export async function generateVideo(
  input: GenVideoInput,
  task: string,
  options?: GenVideoOptions,
): Promise<GenVideoOutput[]> {
  const { targetFilePaths } = input
  const sampleCount = input.sampleCount || 1
  if (!targetFilePaths || targetFilePaths.length !== sampleCount) {
    throw new Error('targetFilePaths must be provided and have the same length as sampleCount')
  }

  // === DEV CACHE: check ===
  const videoCacheParams = isCacheEnabled() ? await extractVideoCacheParams(input, task) : undefined
  if (videoCacheParams) {
    const meta = await tryReadBinaryMeta<GenVideoOutput[]>(videoCacheParams)
    if (meta) {
      const outputs: GenVideoOutput[] = []
      for (let i = 0; i < meta.result.length; i++) {
        const targetPath = `${input.outputDir}/${targetFilePaths[i]}.mp4`
        await saveCachedBinaryToFile(meta.key, i, targetPath, meta.binaries[i]?.ext)
        outputs.push({ ...meta.result[i], path: targetPath })
      }
      logger.info({ task }, '[generateVideo] dev-cache hit')
      return outputs
    }
  }

  const modelName = await getModelName(input)
  // Clamp against the FINAL model (getModelName may switch models) so a
  // 1080p request never reaches a 720p-capped model as-is.
  const resolution = input.resolution
    ? clampVideoResolution(input.resolution, modelName)
    : undefined
  const opts = {
    models: [modelName],
    task,
    prompt: input.prompt,
    outputPath: `${input.outputDir}/${targetFilePaths[0]}.mp4`,
    debugOutputDir: input.debugOutputDir,
    debugOutputPrefix: targetFilePaths[0],
    durationSeconds: input.duration,
    aspectRatio: input.aspectRatio,
    negativePrompt: input.negativePrompt,
    generateAudio: input.generateAudio,
    firstFrameUrl: input.firstFramePath,
    lastFrameUrl: input.lastFramePath,
    resolution,
  }

  const outPut = await LLM.generateVideo(opts)
  // Report the model that ACTUALLY generated the clip, as a registry key.
  // `getModelName` resolves legacy ids and can swap the requested model (debug
  // modelSwitch, the aspect-ratio fallback), and callers gate real behavior on
  // this: generation records, metrics and the native-audio strip.
  const migrateOutputs = [{ ...outPut, resolvedModel: modelName }]
  await writeVideoToCache(videoCacheParams, migrateOutputs)
  return migrateOutputs
}

/**
 * The circuit-breaker / metrics provider for a video model: `fal`, or
 * `google` for Gemini API clips. The signature stays so breaker ids and metric
 * tags have one source.
 */
export function resolveVideoProvider(model: string): string {
  return videoProviderOf(model)
}

function composeBreakerIdFromScope(provider: string, options?: GenVideoOptions): string {
  const scope = options?.breakerScope || resolveBreakerScope()
  return `${scope}:${provider}`
}

// Alias for shorter call sites
const composeBreakerId = composeBreakerIdFromScope

// --- Dev cache helpers ---

async function extractVideoCacheParams(
  input: GenVideoInput,
  task: string,
): Promise<Record<string, unknown>> {
  return {
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    firstFrameHash: await hashFileContent(input.firstFramePath),
    generateAudio: input.generateAudio,
    lastFrameHash: await hashFileContent(input.lastFramePath),
    model: input.model,
    negativePrompt: input.negativePrompt,
    prompt: input.prompt,
    // Keyed on the CLAMPED value so requests that produce the same provider
    // call share a cache entry.
    resolution: input.resolution ? clampVideoResolution(input.resolution, input.model) : undefined,
    sampleCount: input.sampleCount,
    task,
  }
}

async function writeVideoToCache(
  params: Record<string, unknown> | undefined,
  outputs: GenVideoOutput[],
): Promise<void> {
  if (!params) {
    return
  }
  try {
    const binaries = await Promise.all(
      outputs.map(async (output, i) => ({
        data: await fs.promises.readFile(output.path),
        ext: 'mp4',
        index: i,
        originalPath: output.path,
      })),
    )
    tryWriteBinary(params, outputs, binaries)
  } catch {
    // cache write failure is non-fatal
  }
}

/**
 * Check the circuit breaker for the resolved video provider. If open, try the
 * registry fallbacks for the model's role that support the requested aspect
 * ratio.
 */
/** @internal Exported for testing */
export async function applyVideoCircuitBreaker(
  modelName: string,
  input: GenVideoInput,
  options: GenVideoOptions,
): Promise<string> {
  const breaker = options.breaker
  if (!breaker) {
    return modelName
  }

  const provider = resolveVideoProvider(modelName)
  const id = composeBreakerId(provider, options)
  const result = await breaker.check(id, { provider, model: modelName })

  if (result.allowed) {
    return modelName
  }

  const { aspectRatio } = input
  const fallbackOrder = fallbacksFor(roleForFrames(input))
    .filter((m) => m.key !== modelName)
    .filter((m) => !aspectRatio || supportsAspect(capsOf(m), aspectRatio))
    .map((m) => m.key)

  for (const fallback of new Set(fallbackOrder)) {
    const fbProvider = resolveVideoProvider(fallback)
    const fbId = composeBreakerId(fbProvider, options)
    const fbResult = await breaker.check(fbId, { provider: fbProvider, model: fallback })
    if (fbResult.allowed) {
      logger.info(
        `[generateVideo] Provider ${provider} circuit breaker open, falling back to ${fbProvider} (${fallback})`,
      )
      return fallback
    }
  }

  // All providers open - reject the request
  const msg = '[generateVideo] All video providers have circuit breaker open, rejecting request'
  logger.error(msg)
  throw new Error(msg)
}

function capsOf(model: ResolvedModel): VideoCaps {
  return model.capabilities as VideoCaps
}

function roleForFrames(input: Pick<GenVideoInput, 'firstFramePath' | 'lastFramePath'>): VideoRole {
  return `video.${videoModeForFrames({ end: input.lastFramePath, start: input.firstFramePath })}` as VideoRole
}

/**
 * Select the video model for a request: the debug modelSwitch, then the
 * requested model, then the registry role for the frames supplied. Legacy ids
 * resolve through the registry. When the model can't serve the aspect ratio,
 * the first registry fallback for the role that can is used; otherwise this
 * throws.
 *
 * @returns The registry key to generate with
 */
/** @internal Exported for testing */
export async function getModelName(
  input: Pick<GenVideoInput, 'aspectRatio' | 'firstFramePath' | 'lastFramePath' | 'model'>,
): Promise<string> {
  const { model: modelName, aspectRatio } = input

  //highest priority, specific by user
  const modelSwitch = JobContext.getFullContext({}).modelSwitch || {}
  const currentTool = getReqContext().tool || 'unknown'
  const toolSetting = modelSwitch[currentTool] || modelSwitch['all']

  let requested: string | undefined
  const userSwitched = toolSetting?.['video-generate']
  if (userSwitched) {
    logger.info(`[generateVideo] Using user switch model: ${userSwitched}`)
    requested = userSwitched
  } else if (modelName) {
    logger.info(`[generateVideo] Using provided model: ${modelName}`)
    requested = modelName
  }

  const resolved = resolveVideoForFrames(requested, {
    end: input.lastFramePath,
    start: input.firstFramePath,
  })
  if (requested && resolved.key !== requested) {
    logger.info(
      `[generateVideo] Resolved video model ${requested} to ${resolved.key} (${resolved.source})`,
    )
  }
  const role = `video.${resolved.mode ?? 'text'}` as VideoRole
  const candidates = [resolved, ...fallbacksFor(role)]
  const selected = candidates.find((m) => supportsAspect(capsOf(m), aspectRatio))
  if (!selected) {
    const supported = [...new Set(candidates.flatMap((m) => capsOf(m).aspectRatios))]
    throw new Error(
      `Model ${resolved.key} does not support aspect ratio ${aspectRatio}. Supported ratios: ${supported.join(', ')}`,
    )
  }
  if (selected.key !== resolved.key) {
    logger.info(
      `[generateVideo] ${resolved.key} does not support ${aspectRatio}, switching to ${selected.key}`,
    )
  }
  return selected.key
}
