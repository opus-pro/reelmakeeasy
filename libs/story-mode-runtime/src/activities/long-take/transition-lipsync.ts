import * as fs from 'node:fs'
import * as path from 'node:path'

import { reportFalDirectCost } from '@reelmakeeasy/common/llm/fal-direct-cost'
import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import { downloadHttpResource } from '@reelmakeeasy/common/utils/download'
import { fal } from '@reelmakeeasy/llm'
import { klingLipsyncEndpoint } from '@reelmakeeasy/llm/adapters'
import { type LipsyncCaps, resolveRole } from '@reelmakeeasy/llm/registry'

import { downloadAssetToLocal, formatError, formatLogFields, logger } from './common'

const MIN_LIPSYNC_SECONDS = 1
const FAL_DOWNLOAD_TIMEOUT_MS = 120_000

export interface FalProviderErrorDetails {
  providerErrorBody?: string
  providerErrorStatus?: number
}

export interface MaybeLipSyncTransitionVideoParams {
  audioSourceUri: string
  durationSeconds: number
  enabled: boolean
  endMs: number
  projectId: string
  shouldLipSync: boolean
  sourceVideoPath: string
  startMs: number
  tempDir: string
  transitionId: string
  userId: string
}

interface FalLipSyncResult {
  url?: string
  video?: {
    url?: string
  }
  video_url?: string
}

type LipSyncEndpoint = {
  /** fal endpoint id of the video.lipsync role's model. */
  id: string
  provider: string
}

interface LipSyncModel {
  caps: LipsyncCaps
  endpoint: LipSyncEndpoint
}

/**
 * The registry's `video.lipsync` role: its fal endpoint and the clip-length
 * window it accepts. Null when the role is disabled, which turns lip sync off.
 */
export function extractFalProviderError(error: unknown): FalProviderErrorDetails {
  if (!isRecord(error)) {
    return {}
  }

  const details: FalProviderErrorDetails = {}
  const providerErrorStatus =
    getNumberProperty(error, 'status') ?? getNumberProperty(error, 'statusCode')
  if (providerErrorStatus !== undefined) {
    details.providerErrorStatus = providerErrorStatus
  }

  const providerErrorBody = serializeProviderErrorBody(error.body)
  if (providerErrorBody) {
    details.providerErrorBody = providerErrorBody
  }

  return details
}

export async function maybeLipSyncTransitionVideo(
  params: MaybeLipSyncTransitionVideoParams,
): Promise<string> {
  const {
    audioSourceUri,
    durationSeconds,
    enabled,
    endMs,
    projectId,
    shouldLipSync,
    sourceVideoPath,
    startMs,
    tempDir,
    transitionId,
  } = params

  if (!enabled) {
    return sourceVideoPath
  }

  if (!shouldLipSyncTransition({ durationSeconds, shouldLipSync })) {
    logger.info(
      `[long-take] Transition lip sync skipped ${formatLogFields({
        projectId,
        transitionId,
        durationSeconds,
        reason: shouldLipSync ? 'unsupported_duration' : 'not_requested',
      })}`,
    )
    return sourceVideoPath
  }

  const endpoints = selectLipSyncEndpoints(durationSeconds)
  if (!endpoints.length) {
    logger.info(
      `[long-take] Transition lip sync skipped ${formatLogFields({
        projectId,
        transitionId,
        durationSeconds,
        reason: 'unsupported_duration',
      })}`,
    )
    return sourceVideoPath
  }

  const audioClipPath = path.join(tempDir, `lipsync-${transitionId}.mp3`)
  const rawSyncedPath = path.join(tempDir, `lipsync-${transitionId}-raw.mp4`)
  const mutedSyncedPath = path.join(tempDir, `lipsync-${transitionId}-muted.mp4`)

  await trimTransitionAudio({
    audioSourceUri,
    endMs,
    outputPath: audioClipPath,
    projectId,
    startMs,
    tempDir,
    transitionId,
  })

  const videoUrl = await uploadLocalFileToFalStorage(sourceVideoPath, 'video/mp4')
  const audioUrl = await uploadLocalFileToFalStorage(audioClipPath, 'audio/mpeg')

  let lastError: unknown
  for (const endpoint of endpoints) {
    try {
      logger.info(
        `[long-take] Transition lip sync started ${formatLogFields({
          endpoint: endpoint.id,
          projectId,
          provider: endpoint.provider,
          transitionId,
        })}`,
      )
      const outputUrl = await runFalLipSync({
        audioUrl,
        durationSeconds,
        endpoint,
        transitionId,
        videoUrl,
      })
      await downloadHttpResource(outputUrl, rawSyncedPath, {
        retries: 3,
        timeout: FAL_DOWNLOAD_TIMEOUT_MS,
      })
      await stripAudioTrack(rawSyncedPath, mutedSyncedPath)
      logger.info(
        `[long-take] Transition lip sync completed ${formatLogFields({
          endpoint: endpoint.id,
          projectId,
          provider: endpoint.provider,
          transitionId,
        })}`,
      )
      return mutedSyncedPath
    } catch (error) {
      lastError = error
      const formattedError = formatError(error)
      const providerError = extractFalProviderError(error)
      logger.warn(
        `[long-take] Transition lip sync provider failed ${formatLogFields({
          endpoint: endpoint.id,
          projectId,
          provider: endpoint.provider,
          transitionId,
          err: formattedError,
          ...providerErrorLogField(providerError),
        })}`,
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Transition lip sync failed')
}

export function resolveLipSyncModel(): LipSyncModel | null {
  const model = resolveRole('video.lipsync')
  if (!model) {
    return null
  }
  return {
    caps: model.capabilities as LipsyncCaps,
    endpoint: { id: klingLipsyncEndpoint(model), provider: model.provider },
  }
}

export async function runKlingLipSync(params: {
  abortSignal?: AbortSignal
  audioUrl: string
  durationSeconds?: number
  timeoutMs?: number
  transitionId: string
  videoUrl: string
}): Promise<string> {
  const model = resolveLipSyncModel()
  if (!model) {
    throw new Error('No lip sync model is configured (roles.video.lipsync is null)')
  }
  return runFalLipSync({ ...params, endpoint: model.endpoint })
}

export function selectLipSyncEndpoints(durationSeconds: number): LipSyncEndpoint[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_LIPSYNC_SECONDS) {
    return []
  }
  const model = resolveLipSyncModel()
  if (
    model &&
    durationSeconds >= model.caps.minVideoSec &&
    durationSeconds <= model.caps.maxVideoSec
  ) {
    return [model.endpoint]
  }
  return []
}

export function shouldLipSyncTransition(params: {
  durationSeconds: number
  shouldLipSync: boolean
}): boolean {
  const { durationSeconds, shouldLipSync } = params
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_LIPSYNC_SECONDS) {
    return false
  }

  return shouldLipSync
}

export async function stripAudioTrack(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg('-i', inputPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath)
}

export async function uploadLocalFileToFalStorage(
  filePath: string,
  contentType: string,
): Promise<string> {
  const buffer = await fs.promises.readFile(filePath)
  const file = new File([Uint8Array.from(buffer)], path.basename(filePath), { type: contentType })
  return await fal.storage.upload(file)
}

function getNumberProperty(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function providerErrorLogField(
  providerError: FalProviderErrorDetails,
): Record<string, never> | { providerError: FalProviderErrorDetails } {
  if (providerError.providerErrorBody || providerError.providerErrorStatus !== undefined) {
    return { providerError }
  }
  return {}
}

async function runFalLipSync(params: {
  abortSignal?: AbortSignal
  audioUrl: string
  durationSeconds?: number
  endpoint: LipSyncEndpoint
  timeoutMs?: number
  transitionId: string
  videoUrl: string
}): Promise<string> {
  const { abortSignal, audioUrl, durationSeconds, endpoint, timeoutMs, videoUrl } = params
  const result = await fal.subscribe(endpoint.id, {
    abortSignal,
    input: {
      audio_url: audioUrl,
      video_url: videoUrl,
    },
    logs: true,
    timeout: timeoutMs,
  })

  const data = result.data as FalLipSyncResult | undefined
  const outputUrl = data?.video?.url || data?.video_url || data?.url
  if (!outputUrl) {
    throw new Error(`No lip sync video URL returned by ${endpoint.id}`)
  }
  // Meter this fal-direct generation: the raw fal client bypasses the model
  // registry's cost tracking. This runs inside a story-mode activity, after the external call
  // resolved -- a post-return side-effect, never in workflow code -- so it is
  // replay-safe. Lip-sync runs in the story-mode worker (biz `Story-Mode`).
  reportFalDirectCost({
    biz: 'Story-Mode',
    endpoint: endpoint.id,
    recordProjectCost: true,
    seconds: durationSeconds,
    task: 'transition_lipsync',
  })
  return outputUrl
}

function sanitizeProviderErrorText(message: string): string {
  return message
    .replace(/\bhttps?:\/\/[^\s"',<>]+/gi, '[url]')
    .replace(/\bstore:\/\/[^\s"',<>]+/gi, '[stored-file]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(access_token|token|signature|X-Goog-Signature)=([^&\s"',}]+)/gi, '$1=[redacted]')
}

function serializeProviderErrorBody(body: unknown): string | undefined {
  if (body === null || body === undefined) {
    return undefined
  }
  if (typeof body === 'string') {
    return sanitizeProviderErrorText(body)
  }
  try {
    return sanitizeProviderErrorText(JSON.stringify(body))
  } catch {
    return sanitizeProviderErrorText(String(body))
  }
}

async function trimTransitionAudio(params: {
  audioSourceUri: string
  endMs: number
  outputPath: string
  projectId: string
  startMs: number
  tempDir: string
  transitionId: string
}): Promise<void> {
  const { audioSourceUri, endMs, outputPath, projectId, startMs, tempDir, transitionId } = params
  const sourceAudioPath = path.join(tempDir, 'voice-over-source.mp3')
  await downloadAssetToLocal(audioSourceUri, sourceAudioPath)
  const startSec = Math.max(0, startMs / 1000)
  const endSec = Math.max(startSec + MIN_LIPSYNC_SECONDS, endMs / 1000)

  logger.info(
    `[long-take] Trimming transition lip sync audio ${formatLogFields({
      projectId,
      transitionId,
      startSec,
      endSec,
    })}`,
  )

  await runFfmpeg(
    '-i',
    sourceAudioPath,
    '-af',
    `atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`,
    '-vn',
    '-c:a',
    'libmp3lame',
    outputPath,
  )
}
