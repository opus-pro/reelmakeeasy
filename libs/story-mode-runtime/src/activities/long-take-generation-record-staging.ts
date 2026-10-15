import * as fs from 'node:fs'
import * as path from 'node:path'

import type { CompletionOptions, Content } from '@reelmakeeasy/common/llm'
import { getDefaultImageModelId } from '@reelmakeeasy/common/llm/image-model-selection'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  isStoreUri,
  uploadBufferToStore,
  workspaceUri,
} from '@reelmakeeasy/common/storage/stored-files'
import {
  generateVideo,
  type GenVideoInput,
  type GenVideoOptions,
  type GenVideoOutput,
} from '@reelmakeeasy/common/veo3/gen-video'
import {
  getDefaultVideoModelId,
  getVideoModelFallbackChain,
} from '@reelmakeeasy/common/veo3/video-model-selection'
import { isKnownModel, legacyTarget } from '@reelmakeeasy/llm/registry'
import { getGenerationRecordDataService } from '@shared/db-access-layer'
import type {
  GenerationRecordCreateData,
  GenerationRecordStatus,
} from '@shared/types/api/domain-services/generation-record-data-service'
import { z } from 'zod'

const logger = new Logger('story-mode:long-take-generation-record')

const LONG_TAKE_STAGING_MAX_BYTES = 30 * 1024 * 1024
const LONG_TAKE_STAGING_MAX_RETRIES = 2
const LONG_TAKE_STAGING_TIMEOUT_MS = 10_000
const LONG_TAKE_STAGING_PREFIX = 'long_take/generation_record_staging'

/**
 * The transition video model used when no API/debug override is set: the
 * registry's `video.firstLast` role (Kling 3.0 by default).
 */
export function getDefaultTransitionVideoModel(): string {
  return getDefaultVideoModelId()
}

/**
 * Result of a transition clip generation. `actualModel` is the model that truly
 * produced `path` -- it can differ from the requested model when a fallback chain
 * (primary-failure, image-sensitive, sensitive-prompt) or the lib-level Omni
 * dark-launch guard swaps the model mid-flight. Callers (e.g. the Gemini Omni
 * audio strip) MUST gate on `actualModel`, not the requested model.
 */
export type TransitionClipResult = {
  actualModel: string
  /** Actual generated clip height in px, when the generator reported it. */
  height?: number
  path: string
  /** Effective prompt used to generate this clip when an internal fallback rewrote it. */
  prompt?: string
  /** Actual generated clip width in px, when the generator reported it. */
  width?: number
}

export type TransitionModelSource = 'api-override' | 'default' | 'fallback-invalid'

export type TransitionVideoGenerator = (
  input: GenVideoInput,
  task: string,
  options?: GenVideoOptions,
) => Promise<GenVideoOutput[]>

type GenerationRecordDirection = 'input' | 'output'

type GenerationRecordInput = {
  anchorId?: string
  anchorType?: string
  attempt: number
  error?: { message: string; name: string; stack?: string }
  inputRefs?: string[]
  inputText?: string
  meta?: Record<string, unknown>
  model?: string
  outputRefs?: string[]
  outputText?: string
  projectId: string
  status: GenerationRecordStatus
  task: string
  taskId: string
  type: GenerationRecordTypeLocal
  userId?: string
}

type GenerationRecordTypeLocal = 'image' | 'llm' | 'video'

type StagingPayload = {
  direction: GenerationRecordDirection
  refs: string[]
}

export function extractContentUris(contents?: Content[]): string[] {
  if (!contents?.length) {
    return []
  }
  const refs: string[] = []
  for (const content of contents) {
    if (content.type === 'image_url' && content.imageUrl) {
      refs.push(content.imageUrl)
      continue
    }
    if (content.type === 'video_url' && content.videoUrl) {
      refs.push(content.videoUrl)
    }
  }
  return refs
}

export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const errorWithStatus = error as {
    httpStatus?: number
    response?: { status?: number }
    status?: number
    statusCode?: number
  }
  const rawStatus =
    errorWithStatus.httpStatus ||
    errorWithStatus.status ||
    errorWithStatus.statusCode ||
    errorWithStatus.response?.status
  if (!Number.isFinite(rawStatus)) {
    return undefined
  }
  const normalized = Number(rawStatus)
  if (normalized < 100 || normalized > 599) {
    return undefined
  }
  return normalized
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

export function getCompletionModelLabel(models: CompletionOptions<z.ZodTypeAny>['models']): string {
  return Array.isArray(models) ? models.join(', ') : models
}

// A transition model id is valid when the registry knows it (key, alias or
// endpoint) or it is a legacy id the registry maps onto a role.
export function isValidTransitionVideoModel(model: string): boolean {
  return isKnownModel('video', model) || legacyTarget('video', model) !== null
}

export async function recordGenerationCall(params: GenerationRecordInput): Promise<void> {
  const {
    anchorId,
    anchorType,
    attempt,
    error,
    inputRefs = [],
    inputText,
    meta,
    model,
    outputRefs = [],
    outputText,
    projectId,
    status,
    task,
    taskId,
    type,
    userId,
  } = params
  const normalizedInputRefs = normalizeResourceRefs(inputRefs)
  const normalizedOutputRefs = normalizeResourceRefs(outputRefs)
  const inputSplit = splitResourceRefsByStore(normalizedInputRefs)
  const outputSplit = splitResourceRefsByStore(normalizedOutputRefs)
  const hasStagingWork = inputSplit.externalRefs.length > 0 || outputSplit.externalRefs.length > 0

  const createPayload: GenerationRecordCreateData = {
    taskId,
    attempt,
    projectId,
    userId: userId || null,
    anchorId: anchorId || null,
    anchorType: anchorType || null,
    type,
    task,
    status,
    model: model || null,
    inputText: inputText || null,
    outputText: outputText || null,
    inputUris: inputSplit.storedRefs,
    outputUris: outputSplit.storedRefs,
    stagingStatus: hasStagingWork ? 'pending' : undefined,
    errorName: error?.name || null,
    errorMessage: error?.message || null,
    errorStack: error?.stack || null,
    meta: buildRecordMeta({
      baseMeta: toRecordMeta(meta),
      externalInputRefs: inputSplit.externalRefs,
      externalOutputRefs: outputSplit.externalRefs,
    }),
  }

  const service = getGenerationRecordDataService()
  let recordId: null | string = null
  try {
    const created = await service.createRecord(createPayload)
    recordId = created.id
  } catch (createError) {
    logger.warn(
      `[long-take] Failed to create generation record ${formatLogFields({
        projectId,
        task,
        taskId,
        type,
        err: formatError(createError),
      })}`,
    )
    return
  }

  if (!recordId || !hasStagingWork) {
    return
  }
  queueExternalStaging({
    attempt,
    baseInputUris: inputSplit.storedRefs,
    baseOutputUris: outputSplit.storedRefs,
    projectId,
    recordId,
    taskId,
    userId,
    payloads: [
      { direction: 'input', refs: inputSplit.externalRefs },
      { direction: 'output', refs: outputSplit.externalRefs },
    ],
  })
}

// Precedence: explicit API/debug override (staff pin) > the registry's
// image.generate role. The registry loader applies the deprecated
// LONG_TAKE_KEYFRAME_MODEL env var to that role, so it isn't read here.
export function resolveKeyframeImageModel(params: { configuredModel?: string }): string {
  const apiOverride = params.configuredModel?.trim()
  if (apiOverride) {
    return apiOverride
  }
  return getDefaultImageModelId()
}

// The registry fallback to try after the primary transition model fails: the
// first one that isn't the primary itself. No duration compatibility filter:
// a shorter-capped fallback produces a clamped clip that
// retimeTransitionVideoIfNeeded stretches back to the slot.
export function resolvePrimaryFailureFallbackModel(model: string): string | undefined {
  return getVideoModelFallbackChain(model).find((candidate) => candidate !== model)
}

export function resolveProviderStage(task: string): string {
  const normalizedTask = task.toLowerCase()
  if (normalizedTask.includes('anchor')) {
    return 'anchors'
  }
  if (normalizedTask.includes('keyframe')) {
    return 'keyframes'
  }
  if (normalizedTask.includes('transition')) {
    return 'transitions'
  }
  if (normalizedTask.includes('render')) {
    return 'render'
  }
  if (normalizedTask.includes('script')) {
    return 'script'
  }
  return 'unknown'
}

// The transition video model used when no API/debug override is set.
export function resolveDefaultTransitionVideoModel(): {
  model: string
  modelSource: TransitionModelSource
} {
  return { model: getDefaultTransitionVideoModel(), modelSource: 'default' }
}

export function selectTransitionVideoGenerator(_model: string): TransitionVideoGenerator {
  return generateVideo
}

export function toRecordText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Resolve the model that actually produced an output. `resolvedModel` is set by
// the lib router when a fallback (breaker / Omni dark-launch guard) swapped the
// requested model; fall back to the requested model when absent.
export function toTransitionClipResult(
  output: { height?: number; path: string; resolvedModel?: string; width?: number },
  requestedModel: string,
): TransitionClipResult {
  return {
    actualModel: output.resolvedModel || requestedModel,
    // Carry the generator's actual output dims so render can crop-to-fill
    // an off-9:16 clip instead of letterboxing it. Omitted when unreported.
    ...(Number.isFinite(output.height) && { height: output.height }),
    path: output.path,
    ...(Number.isFinite(output.width) && { width: output.width }),
  }
}

function buildRecordMeta(params: {
  baseMeta?: Record<string, unknown>
  externalInputRefs: string[]
  externalOutputRefs: string[]
}): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = params.baseMeta ? { ...params.baseMeta } : {}
  if (params.externalInputRefs.length > 0) {
    meta['externalInputRefs'] = params.externalInputRefs.map(sanitizeResourceRef)
  }
  if (params.externalOutputRefs.length > 0) {
    meta['externalOutputRefs'] = params.externalOutputRefs.map(sanitizeResourceRef)
  }
  return Object.keys(meta).length > 0 ? meta : undefined
}

function buildStagingObjectUri(params: {
  attempt: number
  direction: GenerationRecordDirection
  extension: string
  index: number
  projectId: string
  taskId: string
}): string {
  const { attempt, direction, extension, index, projectId, taskId } = params
  return workspaceUri(
    projectId,
    LONG_TAKE_STAGING_PREFIX,
    taskId,
    `attempt-${attempt}`,
    `${direction}-${index}${extension}`,
  )
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureBufferWithinLimit(buffer: Buffer, ref: string): void {
  if (buffer.length > LONG_TAKE_STAGING_MAX_BYTES) {
    throw new Error(
      `Reference exceeds staging limit (${buffer.length} bytes > ${LONG_TAKE_STAGING_MAX_BYTES}) for ${sanitizeResourceRef(ref)}`,
    )
  }
}

function fileUrlToPath(fileUrl: string): string {
  try {
    return decodeURIComponent(new URL(fileUrl).pathname)
  } catch {
    return fileUrl
  }
}

function inferExtensionFromMimeType(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase() || ''
  if (normalized.includes('image/png')) {
    return '.png'
  }
  if (normalized.includes('image/webp')) {
    return '.webp'
  }
  if (normalized.includes('image/gif')) {
    return '.gif'
  }
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) {
    return '.jpg'
  }
  if (normalized.includes('video/mp4')) {
    return '.mp4'
  }
  if (normalized.includes('video/webm')) {
    return '.webm'
  }
  if (normalized.includes('audio/mpeg')) {
    return '.mp3'
  }
  if (normalized.includes('audio/wav') || normalized.includes('audio/x-wav')) {
    return '.wav'
  }
  return '.bin'
}

function inferExtensionFromReference(ref: string): string {
  if (ref.startsWith('data:')) {
    const matches = ref.match(/^data:([^;]+);base64,/i)
    return inferExtensionFromMimeType(matches?.[1])
  }
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    try {
      const pathname = new URL(ref).pathname
      const ext = path.extname(pathname)
      return ext || '.bin'
    } catch {
      return '.bin'
    }
  }
  const filePath = ref.startsWith('file://') ? fileUrlToPath(ref) : ref
  const ext = path.extname(filePath)
  return ext || '.bin'
}

function isLikelyBase64Reference(ref: string): boolean {
  if (ref.length < 128) {
    return false
  }
  if (ref.includes('://') || ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../')) {
    return false
  }
  return /^[A-Za-z0-9+/=\r\n]+$/.test(ref)
}

function isLocalFileReference(ref: string): boolean {
  if (ref.startsWith('file://')) {
    return true
  }
  if (ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../')) {
    return true
  }
  if (/^[A-Za-z]:[\\/]/.test(ref)) {
    return true
  }
  return false
}

async function loadReferenceBufferForStaging(
  ref: string,
): Promise<{ buffer: Buffer; extension: string }> {
  if (ref.startsWith('data:')) {
    const parsed = parseDataUri(ref)
    if (!parsed) {
      throw new Error('Invalid data URI reference')
    }
    ensureBufferWithinLimit(parsed.buffer, ref)
    return parsed
  }

  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LONG_TAKE_STAGING_TIMEOUT_MS)
    try {
      const response = await fetch(ref, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Failed to fetch reference: ${response.status}`)
      }
      const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10)
      if (Number.isFinite(contentLength) && contentLength > LONG_TAKE_STAGING_MAX_BYTES) {
        throw new Error(
          `Reference exceeds staging limit (${contentLength} bytes > ${LONG_TAKE_STAGING_MAX_BYTES})`,
        )
      }
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      ensureBufferWithinLimit(buffer, ref)
      return {
        buffer,
        extension: inferExtensionFromMimeType(response.headers.get('content-type') || undefined),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  if (isLocalFileReference(ref)) {
    const localPath = normalizeLocalFilePath(ref)
    const fileStats = await fs.promises.stat(localPath)
    if (fileStats.size > LONG_TAKE_STAGING_MAX_BYTES) {
      throw new Error(
        `Reference exceeds staging limit (${fileStats.size} bytes > ${LONG_TAKE_STAGING_MAX_BYTES}) for ${sanitizeResourceRef(ref)}`,
      )
    }
    const buffer = await fs.promises.readFile(localPath)
    ensureBufferWithinLimit(buffer, ref)
    return { buffer, extension: inferExtensionFromReference(localPath) }
  }

  if (isLikelyBase64Reference(ref)) {
    const buffer = Buffer.from(ref, 'base64')
    ensureBufferWithinLimit(buffer, ref)
    return { buffer, extension: '.bin' }
  }

  throw new Error(`Unsupported non-storage reference: ${sanitizeResourceRef(ref)}`)
}

function normalizeLocalFilePath(ref: string): string {
  return ref.startsWith('file://') ? fileUrlToPath(ref) : ref
}

function normalizeResourceRefs(refs?: string[]): string[] {
  if (!Array.isArray(refs) || refs.length === 0) {
    return []
  }
  const deduped = new Set<string>()
  for (const item of refs) {
    if (typeof item !== 'string') {
      continue
    }
    const trimmed = item.trim()
    if (!trimmed) {
      continue
    }
    deduped.add(trimmed)
  }
  return Array.from(deduped)
}

function parseDataUri(ref: string): null | { buffer: Buffer; extension: string } {
  const matches = ref.match(/^data:([^;]+);base64,([\s\S]+)$/i)
  if (!matches) {
    return null
  }
  const buffer = Buffer.from(matches[2], 'base64')
  const extension = inferExtensionFromMimeType(matches[1])
  return { buffer, extension }
}

function queueExternalStaging(params: {
  attempt: number
  baseInputUris: string[]
  baseOutputUris: string[]
  payloads: StagingPayload[]
  projectId: string
  recordId: string
  taskId: string
  userId?: string
}): void {
  const { attempt, baseInputUris, baseOutputUris, projectId, recordId, taskId, userId, payloads } =
    params
  void (async () => {
    const stagedInputUris = [...baseInputUris]
    const stagedOutputUris = [...baseOutputUris]
    const errors: string[] = []

    for (const payload of payloads) {
      for (let index = 0; index < payload.refs.length; index += 1) {
        const ref = payload.refs[index]
        try {
          const stagedUri = await stageSingleReferenceToStore({
            attempt,
            direction: payload.direction,
            index,
            projectId,
            ref,
            taskId,
          })
          if (payload.direction === 'input') {
            stagedInputUris.push(stagedUri)
          } else {
            stagedOutputUris.push(stagedUri)
          }
        } catch (error) {
          errors.push(
            `${payload.direction}:${sanitizeResourceRef(ref)} => ${ensureError(error).message}`,
          )
        }
      }
    }

    const service = getGenerationRecordDataService()
    try {
      await service.patchRecordUris({
        id: recordId,
        inputUris: stagedInputUris,
        outputUris: stagedOutputUris,
        stagingStatus: errors.length > 0 ? 'failed' : 'ready',
        stagingError: errors.length > 0 ? errors.join(' | ') : null,
      })
    } catch (error) {
      logger.warn(
        `[long-take] Failed to patch staged generation record ${formatLogFields({
          projectId,
          recordId,
          taskId,
          userId,
          err: formatError(error),
        })}`,
      )
    }
  })()
}

function sanitizeResourceRef(ref: string): string {
  if (ref.startsWith('data:')) {
    const commaIndex = ref.indexOf(',')
    if (commaIndex > 0) {
      return `${ref.slice(0, commaIndex)},<redacted:${ref.length}>`
    }
    return `data:<redacted:${ref.length}>`
  }
  if (isLikelyBase64Reference(ref)) {
    return `base64:<redacted:${ref.length}>`
  }
  if (ref.length <= 300) {
    return ref
  }
  return `${ref.slice(0, 300)}...<truncated:${ref.length}>`
}

function splitResourceRefsByStore(refs: string[]): {
  storedRefs: string[]
  externalRefs: string[]
} {
  const storedRefs: string[] = []
  const externalRefs: string[] = []
  for (const ref of refs) {
    if (isStoreUri(ref)) {
      storedRefs.push(ref)
      continue
    }
    externalRefs.push(ref)
  }
  return { storedRefs, externalRefs }
}

async function stageSingleReferenceToStore(params: {
  attempt: number
  direction: GenerationRecordDirection
  index: number
  projectId: string
  ref: string
  taskId: string
}): Promise<string> {
  const { attempt, direction, index, projectId, ref, taskId } = params
  let lastError: Error | null = null

  for (let retry = 1; retry <= LONG_TAKE_STAGING_MAX_RETRIES; retry += 1) {
    try {
      const loaded = await withTimeout(
        loadReferenceBufferForStaging(ref),
        LONG_TAKE_STAGING_TIMEOUT_MS,
        `stage-load-${direction}`,
      )
      const targetUri = buildStagingObjectUri({
        attempt,
        direction,
        extension: loaded.extension,
        index,
        projectId,
        taskId,
      })
      await withTimeout(
        uploadBufferToStore(loaded.buffer, targetUri),
        LONG_TAKE_STAGING_TIMEOUT_MS,
        `stage-upload-${direction}`,
      )
      return targetUri
    } catch (error) {
      lastError = ensureError(error)
      if (retry < LONG_TAKE_STAGING_MAX_RETRIES) {
        await delay(300 * retry)
      }
    }
  }

  throw lastError ?? new Error('Unknown staging error')
}

function toRecordMeta(value?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }
  return value
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
