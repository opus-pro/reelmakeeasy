import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type { SharedJobContext } from '@reelmakeeasy/common/job-context'
import { JobContext } from '@reelmakeeasy/common/job-context'
import type { Content } from '@reelmakeeasy/common/llm'
import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import { Logger } from '@reelmakeeasy/common/logger'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { download } from '@reelmakeeasy/common/utils/download'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { downloadStoredFile, isStoreUri } from '@reelmakeeasy/common/storage/stored-files'
import { getNodeLocalScratchRoot } from '@reelmakeeasy/common/utils/path.util'
import { asProviderErrorShape, ProviderError } from '@reelmakeeasy/common/utils/provider-error'
import {
  isMinimaxModel,
  isSeedance2xModel as isSharedSeedance2xModel,
  isSeedance25Model,
} from '@reelmakeeasy/common/veo3/model'
import { videoPromptMaxChars } from '@reelmakeeasy/common/video-models/registry'
import { Context } from '@reelmakeeasy/workflow-engine/activity'
import { v4 as uuidV4 } from 'uuid'
import { z } from 'zod'

import {
  type LongTakePromptRoute,
  resolveLongTakeTransitionPromptRoute,
} from '../../long-take-prompt-router'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import {
  LONG_TAKE_VISUAL_SCRIPT_CONFIG,
  type LongTakeVisualScriptConfig,
} from '../prompts/long-take-visual-script-prompt'

import {
  fallbackHailuoTransitionPrompt,
  hailuoRewriteRequest,
  type HailuoTransitionPromptInput,
} from './hailuo-transition-prompt'
import {
  buildSeedance2MontagePlan,
  buildSeedance2MontageRewritePrompt,
  PURE_COLOR_SCREEN_TRANSITION_GUARD,
  SEEDANCE_25_TRANSITION_PROMPT_MAX_CHARS,
  type SeedancePromptModelFamily,
} from './seedance2-montage-prompt'

export const logger = new Logger('story-mode:long-take')

const execFileAsync = promisify(execFile)
const PROJECT_NAME_MAX_LENGTH = 80
const PROJECT_NAME_MIN_SENTENCE_LENGTH = 30
// Re-exported from shared/common so client, API, and runtime all agree on
// the cap. Keeping the local name for backwards-compatibility with callers
// that already import it from this module.
export { STORY_MODE_MAX_AUDIO_DURATION_SECONDS } from '@reelmakeeasy/common/utils/story-mode-audio-limits'
export const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16'
export const DEFAULT_IMAGE_CONCURRENCY = 20
export const DEFAULT_VIDEO_CONCURRENCY = 10
const SENSITIVE_PROMPT_PATTERNS = [
  'responsible ai',
  'sensitive words',
  'prompt could not be submitted',
  'allowlisting',
  'usage guidelines',
  'vertex ai',
  'person/face generation',
  'blocked by your current safety settings',
  'sensitive information',
  'sensitive',
]

export type { Seedance2MontagePlan, SeedancePromptModelFamily } from './seedance2-montage-prompt'
export {
  buildSeedance2MontagePlan,
  buildSeedance2MontageRewritePrompt,
  PURE_COLOR_SCREEN_TRANSITION_GUARD,
  SEEDANCE_25_TRANSITION_PROMPT_MAX_CHARS,
} from './seedance2-montage-prompt'

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function deriveProjectNameFromScript(scriptText: string): string {
  if (!scriptText) {
    return 'New Project'
  }
  const dotIndex = scriptText.indexOf('.')
  if (dotIndex !== -1) {
    const firstSentence = scriptText.slice(0, dotIndex)
    if (
      firstSentence.length >= PROJECT_NAME_MIN_SENTENCE_LENGTH &&
      firstSentence.length <= PROJECT_NAME_MAX_LENGTH
    ) {
      return firstSentence
    }
  }
  if (scriptText.length <= PROJECT_NAME_MAX_LENGTH) {
    return scriptText
  }
  return `${scriptText.slice(0, PROJECT_NAME_MAX_LENGTH)}...`
}

export async function downloadAssetToLocal(uri: string, localPath: string): Promise<void> {
  if (!uri) {
    throw new Error('Missing asset URI')
  }

  if (isStoreUri(uri)) {
    await downloadStoredFile(uri, localPath)
    return
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    await download(uri, localPath, { noCache: true })
    return
  }

  await fs.promises.mkdir(path.dirname(localPath), { recursive: true })
  await fs.promises.copyFile(uri, localPath)
}

export function enforceTransitionPromptCharacterLimit(
  prompt: string,
  maxChars = videoPromptMaxChars(),
): string {
  const normalized = prompt
    .trim()
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')

  if (normalized.length <= maxChars) {
    return normalized
  }

  const softBreakIndex = Math.max(
    normalized.lastIndexOf('\n', maxChars),
    normalized.lastIndexOf('. ', maxChars),
    normalized.lastIndexOf('; ', maxChars),
  )

  const cutIndex = softBreakIndex >= Math.floor(maxChars * 0.75) ? softBreakIndex : maxChars
  return normalized.slice(0, cutIndex).trimEnd()
}

export function formatError(error: unknown): { message: string; name: string; stack?: string } {
  const err = ensureError(error)
  return { name: err.name, message: err.message, stack: err.stack }
}

export function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}

export function getActivityExecutionLogFields(): Record<string, number | string> {
  const ctx = getActivityContext()
  if (!ctx) {
    return {}
  }

  return {
    activityId: ctx.info.activityId,
    attempt: ctx.info.attempt,
    workflowId: ctx.info.workflowExecution.workflowId,
  }
}

export function getImageConcurrency(fallback: number): number {
  return getEnvConcurrency('IMAGE_CONCURRENCY_ACTIVITY', fallback)
}

// Re-exported from shared lib for backward compatibility
export { getFirstLongTakeKeyframeThumbnailUrl } from '@reelmakeeasy/common/long-take/render-final'

export function getLongTakeVisualScriptConfig(): LongTakeVisualScriptConfig {
  return { baseline: { ...LONG_TAKE_VISUAL_SCRIPT_CONFIG.baseline } }
}

export function getProjectsBasePath(): string {
  if (process.env['PROJECT_DIR']) {
    return process.env['PROJECT_DIR']
  }
  // Per-pod scratch resolves under the node-local scratch root.
  return getNodeLocalScratchRoot()
}

export function getVideoConcurrency(fallback: number): number {
  return getEnvConcurrency('VIDEO_CONCURRENCY_ACTIVITY', fallback)
}

export async function getVideoDurationSeconds(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    if (!stdout) {
      return 0
    }
    const duration = Number.parseFloat(stdout.trim())
    return Number.isFinite(duration) ? duration : 0
  } catch {
    return 0
  }
}

export { getVideoFrameRate } from '@reelmakeeasy/common/utils/media'

// Black H.264 frames compress to ~50-100 bytes vs 10k+ for real content.
export async function buildSeedance2PromptRewriteContents(params: {
  firstFramePath?: string
  firstFrameUri?: string
  lastFramePath?: string
  lastFrameUri?: string
}): Promise<Content[]> {
  const contents = await Promise.all([
    buildSeedance2ImageContent(params.firstFramePath, params.firstFrameUri),
    buildSeedance2ImageContent(params.lastFramePath, params.lastFrameUri),
  ])
  return contents.filter((content): content is Content => Boolean(content))
}

export async function detectBlackScreen(
  videoPath: string,
  threshold = 500,
): Promise<{ bytesPerFrame: number; isBlackScreen: boolean }> {
  const [fileStat, nbFrames] = await Promise.all([
    fs.promises.stat(videoPath),
    getVideoFrameCount(videoPath),
  ])
  const bytesPerFrame = nbFrames > 0 ? fileStat.size / nbFrames : Infinity
  return {
    bytesPerFrame: Math.round(bytesPerFrame),
    isBlackScreen: bytesPerFrame <= threshold,
  }
}

// Vidu's rawProviderCode is 'AuditSubmitIllegal' for both text and image blocks;
// blocked_resources inside the message JSON is the only discriminator.
export function isImageSensitiveError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.providerCode === 'policy_blocked_image'
  }
  // Match ProviderError from other packages (different class, same shape).
  // Ark reports InputImageSensitiveContentDetected as a generic 'api_error' (not
  // 'policy_blocked_image'), so we also check rawProviderCode and the error
  // message for the Ark-specific image sensitivity pattern.
  if (error instanceof Error) {
    const candidate = error as unknown as Record<string, unknown>
    const rawCode =
      typeof candidate['rawProviderCode'] === 'string' ? candidate['rawProviderCode'] : ''
    if (/InputImageSensitive/i.test(rawCode)) {
      return true
    }
    if (/InputImageSensitiveContentDetected/i.test(error.message)) {
      return true
    }
    if (/AuditSubmitIllegal/i.test(rawCode)) {
      return getViduBlockedContentTypes(error.message).includes('image')
    }
  }
  const shape = asProviderErrorShape(error)
  return shape?.providerCode === 'policy_blocked_image'
}

export function isSeedance2Model(model: string): boolean {
  return isSharedSeedance2xModel(model)
}

export function isSensitivePromptError(error: unknown): boolean {
  // Image-level blocks are handled by isImageSensitiveError / asset library fallback.
  // Exclude them early so neither the rawProviderCode check nor the message pattern
  // fallback accidentally classifies them as prompt errors.
  if (isImageSensitiveError(error)) {
    return false
  }
  // Structured check for ProviderError (Seedance + other providers with text/general blocks)
  if (error instanceof ProviderError && error.providerCode === 'policy_blocked') {
    return true
  }
  // Match ProviderError from other packages (different class, same shape)
  const shape = asProviderErrorShape(error)
  if (shape?.providerCode === 'policy_blocked') {
    return true
  }
  // Each provider reports moderation under its own raw code, not normalized to
  // 'policy_blocked': Ark arrives as 'api_error', Vidu as
  // 'task_failed'. Match the raw code so every provider's block still reaches the
  // prompt-rewrite recovery below.
  if (error instanceof Error) {
    const candidate = error as unknown as Record<string, unknown>
    const rawCode =
      typeof candidate['rawProviderCode'] === 'string' ? candidate['rawProviderCode'] : ''
    if (/InputTextSensitive|SensitiveContentDetected|AuditSubmitIllegal/i.test(rawCode)) {
      return true
    }
  }
  // Existing string pattern matching as fallback for non-ProviderError errors
  const message = ensureError(error).message.toLowerCase()
  return SENSITIVE_PROMPT_PATTERNS.some((pattern) => message.includes(pattern))
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: Array<{ index: number; value: R }> = []
  const queue = items.map((item, index) => ({ item, index }))

  while (queue.length > 0) {
    const batch = queue.splice(0, limit)
    const batchResults = await Promise.all(
      batch.map(async ({ item, index }) => ({
        index,
        value: await mapper(item, index),
      })),
    )
    results.push(...batchResults)
  }

  return results.sort((a, b) => a.index - b.index).map((result) => result.value)
}

export function resolveLongTakeAnchorImageModel(): string {
  return imageModelForRole('image.fast')
}

export function resolveLongTakeOneShotAnchorImageModel(): string {
  return imageModelForRole('image.generate')
}

export async function rewritePromptForSafety(prompt: string, projectId: string): Promise<string> {
  const rewritePrompt = [
    'Rewrite the following video generation prompt to remove any content that may trigger safety filters.',
    'Remove real person names and replace them with pronouns or generic descriptors.',
    'Soften or remove any content involving: real person likeness, violence, sexual content, hate speech, or politically sensitive topics.',
    'Preserve the visual intent, camera movement, and scene description.',
    'Return only the rewritten prompt with no extra text.',
    '',
    prompt,
  ].join('\n')

  try {
    const rewritten = await JobContext.run({ projectId, userId: 'long-take' }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId: 'long-take',
        options: {
          models: ['gemini-3.8-flash', 'gpt-5'],
          prompt: rewritePrompt,
          responseFormat: z.string(),
          task: 'long-take-sanitize-prompt',
          temperature: 0.2,
        },
      }),
    )

    const cleaned = rewritten.trim()
    return cleaned.length > 0 ? cleaned : prompt
  } catch {
    return prompt
  }
}

export async function rewritePromptForSeedance2(
  params: HailuoFields & {
    beatBoundarySeconds?: number
    cameraStyle?: CameraStyle
    clipIndex?: number
    durationSeconds: number
    firstFramePath?: string
    firstFrameUri?: string
    /** Waypoint keyframe count of a Seedance 2.5 merged transition. */
    intermediateReferenceCount?: number
    isNewStyleTransfer?: boolean
    lastFramePath?: string
    lastFrameUri?: string
    projectId: string
    prompt: string
    promptRoute?: LongTakePromptRoute
    styleText?: null | string
    transitionVideoModel?: null | string
    userId?: string
  },
): Promise<string> {
  const { durationSeconds, isNewStyleTransfer, projectId, prompt, promptRoute, styleText, userId } =
    params
  // Hailuo 3 gets its own short prompt: it already sees both frames, and the
  // Seedance dialect's timed shots come back from it as hard cuts.
  if (isMinimaxModel(params.transitionVideoModel)) {
    return rewritePromptForHailuo(params)
  }
  const modelFamily = resolveSeedancePromptModelFamily(params.transitionVideoModel)
  const montagePlan = buildSeedance2MontagePlan(durationSeconds, params.beatBoundarySeconds)
  const transitionPromptRoute = resolveSeedancePromptRoute({
    promptRoute,
    transitionVideoModel: params.transitionVideoModel,
  })
  const vibe = resolveSeedancePromptVibe({
    isNewStyleTransfer,
    modelFamily,
    promptRoute: transitionPromptRoute,
    styleText,
  })
  const rewritePrompt = buildSeedance2MontageRewritePrompt({
    beatBoundarySeconds: params.beatBoundarySeconds,
    durationSeconds,
    intermediateReferenceCount: params.intermediateReferenceCount,
    modelFamily,
    prompt,
    promptRoute: transitionPromptRoute,
    vibe,
  })

  try {
    const contents = await buildSeedance2PromptRewriteContents({
      firstFramePath: params.firstFramePath,
      firstFrameUri: params.firstFrameUri,
      lastFramePath: params.lastFramePath,
      lastFrameUri: params.lastFrameUri,
    })
    const rewritten = await JobContext.run({ projectId, userId: userId || 'long-take' }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId: userId || 'long-take',
        options: {
          ...(contents.length > 0 ? { contents } : {}),
          models: ['gemini-3.8-flash', 'gpt-5'],
          prompt: rewritePrompt,
          responseFormat: z.string(),
          task:
            modelFamily === 'seedance-2.5'
              ? 'long-take-seedance25-prompt-rewrite'
              : 'long-take-seedance2-prompt-rewrite',
          temperature: 0.3,
        },
      }),
    )

    const promptMaxChars =
      modelFamily === 'seedance-2.5'
        ? SEEDANCE_25_TRANSITION_PROMPT_MAX_CHARS
        : videoPromptMaxChars()
    const cleaned = enforceTransitionPromptCharacterLimit(
      stripPureColorScreenGuardFromGeneratedPrompt(rewritten),
      promptMaxChars,
    )
    if (cleaned.length > 0) {
      logger.info(
        `[long-take] Rewrote transition prompt for ${
          modelFamily === 'seedance-2.5' ? 'Seedance 2.5' : 'Seedance 2.0'
        } ${formatLogFields({
          energyTier: montagePlan.tierName,
          klingCompatible: cleaned.length <= videoPromptMaxChars(),
          originalLength: prompt.length,
          promptMaxChars,
          projectId,
          promptRoute: transitionPromptRoute,
          rewrittenLength: cleaned.length,
          shotCount: montagePlan.shotCount,
        })}`,
      )
      return cleaned
    }
    return prompt
  } catch (error) {
    logger.warn(
      `[long-take] ${
        modelFamily === 'seedance-2.5' ? 'Seedance 2.5' : 'Seedance 2.0'
      } prompt rewrite failed, using original ${formatLogFields({
        err: formatError(error),
        projectId,
      })}`,
    )
    return prompt
  }
}

/**
 * Hailuo 3 transition prompt rewrite. Same transport as the
 * Seedance rewrite -- gemini-3.1-pro-preview with gpt-5 fallback, temp 0.3,
 * both keyframe images attached -- but the instruction template is the H3
 * master prompt (nine rules, Run C beat math). The 2500-char cap is kept so
 * every H3 prompt stays compatible with the kling-3.0 per-clip fallback.
 */
export async function runLongTakeExpertStep<TModel, TOutput>(params: {
  fallback: () => TOutput
  normalize: (modelOutput: TModel) => TOutput
  projectId: string
  prompt: string
  responseFormat: z.ZodType<TModel, z.ZodTypeDef, unknown>
  task: string
  userId: string
}): Promise<{ output: TOutput; usedFallback: boolean }> {
  const { fallback, normalize, projectId, prompt, responseFormat, task, userId } = params

  try {
    const modelOutput = await JobContext.run({ projectId, userId }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId,
        options: {
          models: ['gemini-3.8-flash', 'gemini-2.5-pro', 'gpt-5'],
          prompt,
          responseFormat,
          task,
          temperature: 0,
        },
      }),
    )
    return {
      output: normalize(modelOutput),
      usedFallback: false,
    }
  } catch (error) {
    logger.warn(
      `[long-take] Expert step failed ${formatLogFields({
        projectId,
        task,
        err: formatError(error),
      })}`,
    )
    return {
      output: fallback(),
      usedFallback: true,
    }
  }
}

export function shouldRunSeedance2PromptRewrite(params: {
  model: string
  promptAlreadyRewritten?: boolean
}): boolean {
  return isSeedance2Model(params.model) && !params.promptAlreadyRewritten
}

export function toLongTakeSafeFileName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
  return normalized || `asset_${uuidV4()}`
}

export function validateTransitionTiming(params: {
  endMs: number
  fromShotId: string
  startMs: number
  toShotId: string
}): void {
  const { endMs, fromShotId, startMs, toShotId } = params
  if (endMs <= startMs) {
    throw new Error(`Invalid transition timing for ${fromShotId} -> ${toShotId}`)
  }
}

function getViduBlockedContentTypes(message: string): string[] {
  try {
    const jsonStart = message.indexOf('{')
    if (jsonStart === -1) {
      return []
    }
    const body = JSON.parse(message.slice(jsonStart)) as {
      blocked_resources?: Array<{ content_type?: string }>
    }
    return (body.blocked_resources ?? [])
      .map((resource) => resource.content_type)
      .filter((contentType): contentType is string => typeof contentType === 'string')
  } catch {
    return []
  }
}

/** Scene and motion notes for a Hailuo 3 clip, when the caller has them. */
interface HailuoFields {
  fromAudio?: string
  fromKeyframePrompt?: string
  fromPrompt?: string
  toAudio?: string
  toKeyframePrompt?: string
  toPrompt?: string
}

async function rewritePromptForHailuo(
  params: HailuoFields & {
    beatBoundarySeconds?: number
    cameraStyle?: CameraStyle
    clipIndex?: number
    durationSeconds: number
    firstFramePath?: string
    firstFrameUri?: string
    lastFramePath?: string
    lastFrameUri?: string
    projectId: string
    prompt: string
    styleText?: null | string
    userId?: string
  },
): Promise<string> {
  const { projectId, userId } = params
  const hasScenes = Boolean(params.fromKeyframePrompt || params.toKeyframePrompt)
  const input: HailuoTransitionPromptInput = {
    durationSeconds: params.durationSeconds,
    fromMotion: params.fromPrompt,
    fromScene: params.fromKeyframePrompt,
    narration: [params.fromAudio, params.toAudio]
      .map((a) => a?.trim())
      .filter(Boolean)
      .join(' '),
    notes: hasScenes ? undefined : params.prompt,
    toMotion: params.toPrompt,
    toScene: params.toKeyframePrompt,
  }

  // Calm is the short paragraph; Dynamic writes timed beats from the planner's brief.
  const request = hailuoRewriteRequest({
    ...input,
    beatBoundarySeconds: params.beatBoundarySeconds,
    cameraStyle: params.cameraStyle,
    clipIndex: params.clipIndex,
    projectId,
    styleText: params.styleText,
    visualScript: params.prompt,
  })

  try {
    const contents = await buildSeedance2PromptRewriteContents({
      firstFramePath: params.firstFramePath,
      firstFrameUri: params.firstFrameUri,
      lastFramePath: params.lastFramePath,
      lastFrameUri: params.lastFrameUri,
    })
    const rewritten = await JobContext.run({ projectId, userId: userId || 'long-take' }, async () =>
      runLongTakeCompletionWithRecord({
        options: {
          ...(contents.length > 0 ? { contents } : {}),
          models: request.models,
          prompt: request.prompt,
          responseFormat: z.string(),
          task: request.task,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        },
        pipelineContext: false,
        projectId,
        userId: userId || 'long-take',
      }),
    )
    const cleaned = request.clean(String(rewritten))
    if (cleaned.length > 0) {
      logger.info(
        `[long-take] Wrote Hailuo 3 transition prompt ${formatLogFields({
          cameraStyle: params.cameraStyle ?? 'calm',
          length: cleaned.length,
          projectId,
        })}`,
      )
      return cleaned
    }
  } catch (error) {
    logger.warn(
      `[long-take] Hailuo 3 prompt failed, using the planned motion ${formatLogFields({
        err: formatError(error),
        projectId,
      })}`,
    )
  }
  return fallbackHailuoTransitionPrompt(input)
}

/**
 * Whether the surrounding activity has been cancelled -- e.g. orphaned by a
 * superseding TERMINATE_EXISTING start of its workflow id, which the SDK
 * surfaces via the heartbeat channel. Long publish/retry loops check this to
 * stop competing once a newer run owns the work. Outside an
 * activity context (unit tests) this is always false.
 */
export function isActivityCancelled(): boolean {
  return getActivityContext()?.cancellationSignal.aborted ?? false
}

export async function withActivityHeartbeat<T>(
  fn: () => Promise<T>,
  intervalMs = 20_000,
): Promise<T> {
  const stop = startActivityHeartbeat(intervalMs)
  try {
    return await fn()
  } finally {
    stop()
  }
}

/**
 * The crash-resume surface a resumable activity sees: the current
 * attempt number, the details the previous attempt recorded (if any), and a
 * setter that makes every subsequent heartbeat (periodic keepalive + an
 * immediate best-effort flush) carry the given details. Outside an activity
 * context (unit tests) the runtime is inert: attempt 1, no details, no-op set.
 */
export interface ResumableHeartbeatRuntime {
  attempt: number
  /**
   * Stable key for this scheduled activity, identical across its retry
   * attempts (workflow run id + activity id); undefined outside an activity.
   * Callers use it to name durable resume state that must survive the SDK's
   * heartbeat throttling.
   */
  executionKey: string | undefined
  heartbeatDetails: unknown
  setHeartbeatDetails: (details: unknown) => void
}

export function withLongTakeContext<T>(ctx: SharedJobContext, fn: () => Promise<T>): Promise<T> {
  const hasCtx = Boolean(ctx.projectId || ctx.userId || ctx.sceneId || ctx.shotId)
  return hasCtx ? JobContext.run(ctx, fn) : fn()
}

/**
 * Like {@link withActivityHeartbeat}, but the periodic keepalive carries
 * caller-set details on every beat. A plain keepalive would clobber details
 * recorded by the engine (each heartbeat REPLACES the previous one's
 * details), which would lose a persisted vendor job handle between the moment
 * it is set and the worker death it exists to survive.
 */
export async function withResumableActivityHeartbeat<T>(
  fn: (runtime: ResumableHeartbeatRuntime) => Promise<T>,
  intervalMs = 20_000,
): Promise<T> {
  const ctx = getActivityContext()
  // Seeded with the PREVIOUS attempt's details so the initial keepalive beat
  // (fired below, before the activity body runs) re-broadcasts them instead of
  // clobbering them with undefined -- a worker death in that window must not
  // lose the persisted vendor job handle.
  let details: unknown = ctx?.info.heartbeatDetails
  const runtime: ResumableHeartbeatRuntime = {
    attempt: ctx?.info.attempt ?? 1,
    executionKey: ctx ? `${ctx.info.workflowExecution.runId}-${ctx.info.activityId}` : undefined,
    heartbeatDetails: ctx?.info.heartbeatDetails,
    setHeartbeatDetails: (next) => {
      details = next
      if (ctx) {
        // Best-effort immediate flush so the handle is recorded server-side as
        // soon as possible; the SDK throttles the actual send, and the timer
        // below re-carries it on every subsequent beat.
        safeHeartbeat(ctx, () => details)
      }
    },
  }
  const stop = startActivityHeartbeat(intervalMs, () => details)
  try {
    return await fn(runtime)
  } finally {
    stop()
  }
}

async function buildSeedance2ImageContent(
  localPath?: string,
  fallbackUri?: string,
): Promise<Content | undefined> {
  if (localPath) {
    try {
      const bytes = await fs.promises.readFile(localPath)
      return {
        imageUrl: `data:${mimeTypeForImagePath(localPath)};base64,${bytes.toString('base64')}`,
        type: 'image_url',
      }
    } catch {
      // Fall back to the original URI below.
    }
  }

  if (fallbackUri) {
    return { imageUrl: fallbackUri, type: 'image_url' }
  }

  return undefined
}

function getActivityContext(): Context | null {
  try {
    return Context.current()
  } catch {
    return null
  }
}

function getEnvConcurrency(envKey: string, fallback: number): number {
  const raw = Number.parseInt(process.env[envKey] ?? '', 10)
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback
  }
  return raw
}

async function getVideoFrameCount(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_frames',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    if (!stdout) {
      return 0
    }
    const count = Number.parseInt(stdout.trim(), 10)
    return Number.isFinite(count) && count > 0 ? count : 0
  } catch {
    return 0
  }
}

function mimeTypeForImagePath(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  return 'image/png'
}

function resolveSeedancePromptModelFamily(
  transitionVideoModel?: null | string,
): SeedancePromptModelFamily {
  return isSeedance25Model(transitionVideoModel) ? 'seedance-2.5' : 'seedance-2.0'
}

function resolveSeedancePromptRoute(params: {
  promptRoute?: LongTakePromptRoute
  transitionVideoModel?: null | string
}): LongTakePromptRoute | undefined {
  return isSeedance25Model(params.transitionVideoModel)
    ? 'general'
    : resolveLongTakeTransitionPromptRoute(params.promptRoute)
}

function resolveSeedancePromptVibe(params: {
  isNewStyleTransfer?: boolean
  modelFamily: SeedancePromptModelFamily
  promptRoute?: LongTakePromptRoute
  styleText?: null | string
}): string {
  if (params.modelFamily === 'seedance-2.5') {
    return 'fast cinematic story segment, professional camera coverage, rich visible action, strong continuity, reference-to-video identity preservation'
  }

  switch (params.promptRoute) {
    case 'ads-intangible': {
      return 'fast product-experience ad, UI/workflow demo pacing, brand-safe interface continuity, customer outcome motion, energetic social ad rhythm'
    }
    case 'ads-tangible': {
      return 'fast product story ad, product-first demo pacing, functional visual logic, brand-safe packaging continuity, energetic social ad motion'
    }
    case 'music': {
      return 'beat-synced music video transition, energetic performance motion, dance and expressive faces, rhythmic camera movement, vibrant environments'
    }
    default: {
      if (params.isNewStyleTransfer && params.styleText) {
        return `cinematic Story Mode transition, ${params.styleText}, stable camera work`
      }
      return 'cinematic Story Mode transition, modern 3D feature animation, expressive stylized proportions, rich texture, stable camera work'
    }
  }
}

function safeHeartbeat(
  ctx: Context,
  getDetails?: () => unknown,
): { error: unknown; ok: false } | { ok: true } {
  try {
    ctx.heartbeat(getDetails?.())
    return { ok: true }
  } catch (error) {
    return { error, ok: false }
  }
}

function startActivityHeartbeat(intervalMs = 20_000, getDetails?: () => unknown): () => void {
  const ctx = getActivityContext()
  if (!ctx) {
    return () => undefined
  }
  const initial = safeHeartbeat(ctx, getDetails)
  if (!initial.ok) {
    logger.warn(
      `[activity-heartbeat] initial heartbeat failed, timer not started: ${ensureError(initial.error).message}`,
    )
    return () => undefined
  }
  return startHeartbeatTimer(ctx, intervalMs, getDetails)
}

function startHeartbeatTimer(
  ctx: Context,
  intervalMs: number,
  getDetails?: () => unknown,
): () => void {
  const timer = setInterval(() => {
    const result = safeHeartbeat(ctx, getDetails)
    if (!result.ok) {
      logger.warn(
        `[activity-heartbeat] heartbeat failed, stopping timer (activity will hit heartbeatTimeout): ${ensureError(result.error).message}`,
      )
      clearInterval(timer)
    }
  }, intervalMs)

  return () => clearInterval(timer)
}

function stripPureColorScreenGuardFromGeneratedPrompt(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return (
        trimmed !== PURE_COLOR_SCREEN_TRANSITION_GUARD &&
        trimmed !== `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`
      )
    })
    .join('\n')
    .trim()
}
