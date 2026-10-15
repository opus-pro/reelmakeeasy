import path from 'node:path/posix'

import { readCaptionStyleSettings } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { projectPathResolver } from '@reelmakeeasy/common/agent-v2/util/project-path-resolver'
import { completion } from '@reelmakeeasy/common/llm'
import { Logger } from '@reelmakeeasy/common/logger'
import { getLongTakeRequestKey, LONG_TAKE_STATUS_TTL_SECONDS } from '@reelmakeeasy/common/long-take'
import { type CameraStyle, sanitizeCameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import {
  estimateLongTakeAdmissionWaitSeconds,
  getLongTakeAdmissionQueuePosition,
  getLongTakeAdmissionState,
  type LongTakeAdmissionPayload,
} from '@reelmakeeasy/common/long-take/queue-admission'
import { STORY_MODE_STANDALONE_TASK_QUEUE } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { asStoreUri, isStoreUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFile,
  keyIsUnder,
  parseStoreUri,
  storedFileExists,
  storeKeyOf,
  uploadBufferToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { resolveTaskQueueForClient } from '@reelmakeeasy/common/workflow/task-queue'
import {
  buildImageDescriptionPrompt,
  type ImageDescriptionFilename,
  imageDescriptionSchema,
} from '@reelmakeeasy/uip-planner-runtime/tools/describe-uploaded-images'
import { BadRequestException } from '@nestjs/common'
import type {
  LongTakeRenderSettings,
  LongTakeScriptGeneratorPath,
} from '@shared/types/api/long-take'
import type { MusicTrackArg } from '@shared/types/api/music'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { DebugSettings } from '@shared/types/project/debug-settings'

import { sanitizeUploadFileName } from '../util/sanitize-upload-file-name'

import {
  buildProjectStorageUri,
  buildUserAssetAliases,
  extractTempUploadFilename,
  normalizeAttachmentRelativeUri,
} from './long-take-attachment-uri.util'
import { buildImageModelWorkflowArgs } from './long-take-image-model-tracking'
import type {
  LongTakeStartWorkflowContext,
  LongTakeUserAssetCatalogItem,
  WorkflowDeps,
} from './types'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

export { extractAudioScriptFromAsr } from './extract-audio-script-from-asr'
export type { LongTakeUserAssetCatalogItem } from './types'

const logger = new Logger('LongTakeWorkflowUtil')

export const LONG_TAKE_QUEUED_WORKFLOW_TIMEOUT = '3 days'

export async function analyzeImages(
  logger: Logger,
  imageUris: string[],
  userId: string,
): Promise<ImageDescriptionFilename[]> {
  if (!imageUris.length) {
    return []
  }
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const results = await Promise.all(
    imageUris.map(async (fileUri): Promise<ImageDescriptionFilename | null> => {
      try {
        // Only the user's own temp uploads, by checked key.
        const object = storeKeyOf(fileUri)
        if (!object || !keyIsUnder(object, `tmp/${sanitizedUserId}`)) {
          return null
        }

        const analysisStorePath = `${fileUri}.analysis.json`

        if (await storedFileExists(analysisStorePath)) {
          const cached = await downloadStoredJson(analysisStorePath)
          if (cached?.description) {
            return cached
          }
        }

        const imageBuffer = await fileStore.file(object).read()
        const ext = path.extname(object).toLowerCase()
        const mimeMap: Record<string, string> = {
          '.jpeg': 'image/jpeg',
          '.jpg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
        }
        const mimeType = mimeMap[ext] || 'image/jpeg'
        const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`

        const analysis = await completion({
          // Stays on gemini-2.5-flash (~10s). Both flash upgrades regressed this
          // image-caption payload: 3.5-flash ~3x + 5xx,
          // gemini-3-flash-preview ~92s + ~40% 5xx (fast only on
          // keyframe judges, not caption generation). Reverted.
          models: ['gemini-2.5-flash', 'gemini-3.8-flash', 'gpt-5.2'],
          prompt: buildImageDescriptionPrompt(),
          contents: [{ type: 'image_url', imageUrl: imageDataUrl }],
          reasoningEffort: 'low',
          responseFormat: imageDescriptionSchema,
          temperature: 0.1,
          task: 'story-mode-temp-image-analysis',
          timeout: 60_000,
        })

        const analysisWithMetadata: ImageDescriptionFilename = {
          ...analysis,
          filename: extractTempUploadFilename(object),
        }

        await uploadBufferToStore(
          Buffer.from(JSON.stringify(analysisWithMetadata)),
          analysisStorePath,
        )
        return analysisWithMetadata
      } catch (err) {
        logger.warn(`Failed to analyze image ${fileUri}: ${ensureError(err).message}`)
        return null
      }
    }),
  )

  return results.filter((result): result is ImageDescriptionFilename => result !== null)
}

export function buildAttachmentStorageUriCandidates(params: {
  fileName: string
  projectId: string
  uriWithoutProjectPrefix: string
}): string[] {
  const { fileName, projectId, uriWithoutProjectPrefix } = params
  const candidates = new Set<string>()

  if (uriWithoutProjectPrefix) {
    candidates.add(buildProjectStorageUri(projectId, uriWithoutProjectPrefix))
  }

  const baseName = path.basename(fileName || uriWithoutProjectPrefix)
  const sanitizedBaseName = sanitizeUploadFileName(baseName)
  if (sanitizedBaseName) {
    candidates.add(
      buildProjectStorageUri(projectId, projectPathResolver.getUserUploadedPath(sanitizedBaseName)),
    )
  }

  if (baseName) {
    candidates.add(
      buildProjectStorageUri(projectId, projectPathResolver.getUserUploadedPath(baseName)),
    )
  }

  // Fallback: projects uploaded while an older upload bug was live have
  // sanitized DB titles but raw stored file names (copyTempFileToProject wrote
  // the raw fileName while uploadFile saved the sanitized one to DB). Try
  // un-sanitizing `_` back to ` ` as a last candidate so anchor assets like
  // `Logo_image_1.png` resolve to the actual `Logo image 1.png` in storage.
  const unsanitizedBaseName = baseName.replace(/_/g, ' ')
  if (unsanitizedBaseName && unsanitizedBaseName !== baseName) {
    candidates.add(
      buildProjectStorageUri(
        projectId,
        projectPathResolver.getUserUploadedPath(unsanitizedBaseName),
      ),
    )
  }

  return Array.from(candidates)
}

export function buildLongTakeStartWorkflowContext(
  normalizeRatio: (ratio?: AspectRatio) => AspectRatio | undefined,
  params: {
    audioUri?: string
    customStyle?: boolean
    projectId?: string
    prompt?: string
    ratio?: AspectRatio
    script?: string
    styleText?: string
    userPrompt?: string
    visualScriptTemperature?: number
    voiceId?: string
  },
): LongTakeStartWorkflowContext {
  const normalizedUserPrompt =
    params.userPrompt?.trim() || params.prompt?.trim() || params.script?.trim() || ''
  const normalizedScript = params.script?.trim() || params.prompt?.trim() || ''

  const normalizedInitPrompt = normalizedUserPrompt || undefined

  const normalizedAudioPath = params.audioUri?.trim()
  const normalizedRatio = normalizeRatio(params.ratio)
  const longTakeMetadata: LongTakeStartWorkflowContext['longTakeMetadata'] = {
    isLongTake: true,
    longTakeInput: normalizedAudioPath ? 'audio' : 'transcript',
    ...(normalizedRatio ? { longTakeRatio: normalizedRatio } : {}),
  }

  return {
    longTakeMetadata,
    normalizedAudioPath,
    normalizedCustomStyle: params.customStyle ?? false,
    normalizedInitPrompt,
    normalizedProjectId: params.projectId?.trim(),
    normalizedRatio,
    normalizedScript,
    normalizedStyleText: params.styleText?.trim() || undefined,
    normalizedUserPrompt,
    normalizedVisualScriptTemperature:
      typeof params.visualScriptTemperature === 'number' &&
      Number.isFinite(params.visualScriptTemperature)
        ? params.visualScriptTemperature
        : undefined,
    normalizedVoiceId: params.voiceId?.trim() || undefined,
    projectInitialText: normalizedUserPrompt || normalizedScript,
  }
}

export async function buildLongTakeUserAssetCatalog(
  deps: WorkflowDeps,
  projectId: string,
): Promise<LongTakeUserAssetCatalogItem[]> {
  try {
    const attachments = await deps.mediaService.getAttachments(projectId)
    const imageAttachments = attachments.filter((attachment) =>
      attachment.mime?.startsWith('image/'),
    )
    const catalogItems = await Promise.all(
      imageAttachments.map(async (attachment) => {
        const uriWithoutProjectPrefix = normalizeAttachmentRelativeUri(projectId, attachment.uri)
        const fileName = (attachment.name || path.basename(uriWithoutProjectPrefix || '')).trim()
        if (!uriWithoutProjectPrefix || !fileName) {
          return null
        }

        const storageUri = await resolveLongTakeAttachmentStorageUri({
          fileName,
          projectId,
          uriWithoutProjectPrefix,
        })

        return {
          aliases: buildUserAssetAliases(fileName),
          fileId: `img_${attachment.id}`,
          mime: attachment.mime,
          shortname: fileName,
          storageUri,
        } satisfies LongTakeUserAssetCatalogItem
      }),
    )

    return catalogItems.filter((item): item is LongTakeUserAssetCatalogItem => item !== null)
  } catch (error) {
    const err = ensureError(error)
    deps.logger.warn(
      `Failed to build Story Mode user asset catalog ${JSON.stringify({
        projectId,
        error: { message: err.message, name: err.name },
      })}`,
    )
    return []
  }
}

export function buildLongTakeWorkflowArgs(params: {
  bgmEnabled?: boolean | null
  bgmNote?: null | string
  /** A chosen track (library or the user's own), resolved by the caller; wins over the note. */
  bgmTrack?: MusicTrackArg | null
  cameraStyle?: CameraStyle
  debugSettings?: DebugSettings
  enableCaption?: boolean | null
  generationResolution?: GenerationResolution
  isStyleCopy?: boolean
  keyframeImageModel?: string
  modelSelectorTier?: ModelSelectorAnalyticsTier
  normalized: LongTakeStartWorkflowContext
  orgId?: string
  perfectLoop?: boolean
  remixProjectId?: string
  resolvedAudioPath?: string
  resolvedProjectId: string
  scriptGeneratorPath?: LongTakeScriptGeneratorPath
  source?: 'mcp' | 'web'
  styleName?: string
  styleThumbnailUrl?: string
  targetDurationSeconds?: number
  transitionVideoModel?: string
  user: UserInfo
  userAssetCatalog: LongTakeUserAssetCatalogItem[]
  v4Category?: string
  v4PreviewContextId?: string
  v4Track?: string
}) {
  const {
    bgmEnabled,
    bgmNote,
    bgmTrack,
    cameraStyle,
    debugSettings,
    enableCaption,
    generationResolution,
    isStyleCopy,
    keyframeImageModel,
    modelSelectorTier,
    v4Category,
    v4PreviewContextId,
    v4Track,
    normalized,
    orgId,
    perfectLoop,
    remixProjectId,
    resolvedAudioPath,
    resolvedProjectId,
    scriptGeneratorPath,
    source,
    styleName,
    styleThumbnailUrl,
    targetDurationSeconds,
    transitionVideoModel,
    user,
    userAssetCatalog,
  } = params

  // Only pass HTTPS URLs - base64 data URLs are not accessible by the LLM
  const styleReferenceImageUrls = styleThumbnailUrl?.startsWith('https://')
    ? [styleThumbnailUrl]
    : undefined

  return {
    projectId: resolvedProjectId,
    userEmail: user.email,
    userId: user.sub,
    script: normalized.normalizedScript,
    userPrompt: normalized.normalizedUserPrompt,
    ...(normalized.normalizedRatio ? { aspectRatio: normalized.normalizedRatio } : {}),
    ...(normalized.normalizedStyleText ? { styleText: normalized.normalizedStyleText } : {}),
    ...(styleName ? { styleName } : {}),
    customStyle: normalized.normalizedCustomStyle,
    ...(normalized.normalizedVoiceId ? { voiceId: normalized.normalizedVoiceId } : {}),
    ...(perfectLoop ? { perfectLoop: true } : {}),
    ...(normalized.normalizedVisualScriptTemperature === undefined
      ? {}
      : { visualScriptTemperature: normalized.normalizedVisualScriptTemperature }),
    ...(resolvedAudioPath ? { audioPath: resolvedAudioPath } : {}),
    ...buildRequestedDurationWorkflowArgs(targetDurationSeconds),
    ...(scriptGeneratorPath ? { scriptGeneratorPath } : {}),
    ...(v4Category ? { v4Category } : {}),
    ...(v4PreviewContextId ? { v4PreviewContextId } : {}),
    ...(v4Track ? { v4Track } : {}),
    ...(userAssetCatalog.length ? { userAssetCatalog } : {}),
    ...(debugSettings ? { debugSettings } : {}),
    ...(generationResolution ? { generationResolution } : {}),
    ...(enableCaption == null ? {} : { enableCaption }),
    ...buildBgmFlagWorkflowArgs(bgmEnabled, bgmNote, bgmTrack),
    ...buildCameraStyleWorkflowArgs(cameraStyle),
    ...(remixProjectId ? { remixProjectId } : {}),
    ...(isStyleCopy === undefined ? {} : { isStyleCopy }),
    modelSelectorTier,
    ...buildImageModelWorkflowArgs({
      keyframeImageModel,
      orgId,
      transitionVideoModel,
    }),
    ...(styleReferenceImageUrls ? { styleReferenceImageUrls } : {}),
    ...buildSourceWorkflowArgs(source),
  }
}

export async function buildQueuedAdmissionMeta(
  deps: { kv: WorkflowDeps['kv'] },
  projectId: string,
  admissionPayload: LongTakeAdmissionPayload | null,
): Promise<Record<string, number | string> | undefined> {
  if (!admissionPayload) {
    return undefined
  }

  const [queuePosition, admissionState] = await Promise.all([
    getLongTakeAdmissionQueuePosition(deps.kv, {
      projectId,
      taskQueue: admissionPayload.taskQueue,
      tier: admissionPayload.tier,
    }),
    getLongTakeAdmissionState(deps.kv, admissionPayload.taskQueue),
  ])

  const estimatedWaitSec =
    queuePosition === null
      ? null
      : await estimateLongTakeAdmissionWaitSeconds(deps.kv, {
          position: queuePosition,
          taskQueue: admissionPayload.taskQueue,
          tier: admissionPayload.tier,
        })

  return {
    activeFree: admissionState.activeFree,
    activePaid: admissionState.activePaid,
    queueDepth:
      admissionPayload.tier === 'paid'
        ? admissionState.queueDepthPaid
        : admissionState.queueDepthFree,
    queueDepthFree: admissionState.queueDepthFree,
    queueDepthPaid: admissionState.queueDepthPaid,
    queueDepthTotal: admissionState.queueDepthFree + admissionState.queueDepthPaid,
    queuedAtMs: admissionPayload.queuedAtMs,
    queuedForMs: Math.max(0, Date.now() - admissionPayload.queuedAtMs),
    ...(queuePosition === null ? {} : { queuePosition }),
    ...(estimatedWaitSec == null ? {} : { estimatedWaitSec: Math.ceil(estimatedWaitSec) }),
  }
}

export async function downloadStoredJson(
  fileUri: string,
): Promise<ImageDescriptionFilename | null> {
  try {
    const buffer = await fileStore.file(fileUri).read()
    const parsed = JSON.parse(buffer.toString('utf8')) as ImageDescriptionFilename
    if (!parsed?.description) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function getFilenameFromStorePath(fileUri: string): string {
  const segment = path.basename(fileUri)
  return segment.replace(/^\d+-/, '') || segment
}

export function normalizeRatio(ratio?: AspectRatio): AspectRatio | undefined {
  return ratio && ['1:1', '9:16', '16:9'].includes(ratio) ? ratio : undefined
}

export async function persistDebugOverrides(
  deps: {
    projectsService: {
      getProject: (
        projectId: string,
      ) => Promise<null | { debugSettings?: Record<string, unknown> | unknown }>
      internalUpdateProject: (
        projectId: string,
        data: Record<string, unknown>,
        userSub: string,
      ) => Promise<unknown>
    }
  },
  params: {
    debugSettings?: DebugSettings
    projectId: string
    transitionVideoModel?: string
    userSub: string
  },
): Promise<void> {
  const existingProject = await deps.projectsService.getProject(params.projectId)
  const existingDebugSettings =
    existingProject?.debugSettings != null &&
    typeof existingProject.debugSettings === 'object' &&
    !Array.isArray(existingProject.debugSettings)
      ? (existingProject.debugSettings as Record<string, unknown>)
      : {}
  const mergedDebugSettings = {
    ...existingDebugSettings,
    ...params.debugSettings,
    ...(params.transitionVideoModel ? { transitionVideoModel: params.transitionVideoModel } : {}),
  }
  await deps.projectsService.internalUpdateProject(
    params.projectId,
    { debugSettings: mergedDebugSettings },
    params.userSub,
  )
}

export async function resolveLongTakeAttachmentStorageUri(params: {
  fileName: string
  projectId: string
  uriWithoutProjectPrefix: string
}): Promise<string> {
  const candidates = buildAttachmentStorageUriCandidates(params)
  let canonicalConfirmedMissing = false
  let throwCount = 0
  for (let i = 0; i < candidates.length; i++) {
    try {
      const exists = await storedFileExists(candidates[i])
      if (exists) {
        if (i > 0 && canonicalConfirmedMissing) {
          logger.warn(
            `asset_uri_resolve fallback hit ${JSON.stringify({
              projectId: params.projectId,
              fileName: params.fileName,
              candidateIndex: i,
              canonical: candidates[0],
              hit: candidates[i],
            })}`,
          )
        }
        return candidates[i]
      }
      if (i === 0) {
        canonicalConfirmedMissing = true
      }
    } catch {
      throwCount++
      // best-effort existence check; fallback to next candidate
    }
  }
  logger.warn(
    `asset_uri_resolve no candidate exists in storage ${JSON.stringify({
      projectId: params.projectId,
      fileName: params.fileName,
      candidates,
      throwCount,
    })}`,
  )
  return candidates[0] || buildProjectStorageUri(params.projectId, params.uriWithoutProjectPrefix)
}

export async function resolveLongTakeProjectId(
  projectsService: {
    canVisitProject: (projectId: string) => Promise<boolean>
    createProject: (body: Record<string, unknown>) => Promise<{ id: string }>
  },
  projectId: string | undefined,
  projectInitialText: string,
  longTakeMetadata?: {
    isLongTake: true
    longTakeInput: 'audio' | 'transcript'
    longTakeRatio?: AspectRatio
  },
  styleText?: string,
  styleName?: string,
  styleThumbnailUrl?: string,
  voice?: ProjectVoiceOverJson,
  createUseCase?: string,
): Promise<string> {
  if (projectId) {
    if (!(await projectsService.canVisitProject(projectId))) {
      throw new Error('You are not authorized to access this project')
    }
    return projectId
  }
  const project = await projectsService.createProject({
    initialText: projectInitialText,
    isLongTake: true,
    longTakeInput: longTakeMetadata?.longTakeInput,
    longTakeRatio: longTakeMetadata?.longTakeRatio,
    ...(styleText ? { styleText } : {}),
    ...(styleName ? { styleName } : {}),
    ...(styleThumbnailUrl ? { styleThumbnailUrl } : {}),
    ...(voice ? { voice } : {}),
    // Story Mode project type chosen at creation. Threaded from the
    // long-take request so the no-audio/no-reference path captures it too.
    ...(createUseCase ? { createUseCase } : {}),
  })
  return project.id
}

// Read the prompt-box caption preference recorded on the project record.
// Returns null when the project predates the toggle, which the render pipeline
// treats as "render captions" (legacy behavior).
export function normalizeRenderUri(url: string): string {
  return asStoreUri(url) ?? url
}

// Reads the persisted per-project workflow toggles in a single fetch. Null ==
// project predates the toggle: enableCaption null keeps the legacy render-caption
// default; bgmEnabled null keeps BGM off.
export async function resolveProjectWorkflowFlags(
  projectsService: { getProject: (projectId: string) => Promise<unknown> },
  projectId: string,
): Promise<{
  bgmEnabled: boolean | null
  bgmNote: null | string
  bgmSource: null | string
  bgmTrackId: null | string
  cameraStyle: CameraStyle
  enableCaption: boolean | null
  modelSelectorTier?: ModelSelectorAnalyticsTier
}> {
  const project = (await projectsService.getProject(projectId)) as null | {
    bgmEnabled?: boolean | null
    bgmNote?: null | string
    bgmSource?: null | string
    bgmTrackId?: null | string
    cameraStyle?: unknown
    enableCaption?: boolean | null
    modelSelectorTier?: unknown
  }
  return {
    bgmEnabled: project?.bgmEnabled ?? null,
    bgmNote: project?.bgmNote ?? null,
    bgmSource: project?.bgmSource ?? null,
    bgmTrackId: project?.bgmTrackId ?? null,
    cameraStyle: sanitizeCameraStyle(project?.cameraStyle),
    enableCaption: project?.enableCaption ?? null,
    modelSelectorTier: parseModelSelectorAnalyticsTier(project?.modelSelectorTier),
  }
}

export async function resolveStoryModeStartAudioPath(params: {
  audioPath: string | undefined
  // Injected by the caller (which can safely depend on the av-extraction
  // modules) to keep this file out of an import cycle with extract-audio-from-video.
  extractVideoAudioToMp3: (sourceStoreUri: string, destMp3Uri: string) => Promise<void>
  isVideoExtension: (ext: string) => boolean
  logger: Logger
  projectId: string
  userId?: string
}): Promise<string | undefined> {
  try {
    return await validateAudioPathForProject(
      {
        copyStoredFile,
        extractVideoAudioToMp3: params.extractVideoAudioToMp3,
        projectPathResolver,
        isVideoExtension: params.isVideoExtension,
        logger: params.logger,
        parseStoreUri,
      },
      ProjectStore as never,
      params.audioPath,
      params.projectId,
      params.userId,
    )
  } catch (error) {
    throw new BadRequestException(ensureError(error).message)
  }
}

export async function resolveStoryModeTaskQueue(): Promise<string> {
  return resolveTaskQueueForClient(STORY_MODE_STANDALONE_TASK_QUEUE)
}

export async function resolveUploadedAudioUrl(
  createStorageFn: typeof import('@reelmakeeasy/common/agent-v2/storage/storage').createStorage,
  storeUriToUrlFn: (uri: string) => string,
  audioVoiceoverPath: string,
  audioPath: null | string | undefined,
  projectId: string,
  preCreatedStorage?: Awaited<
    ReturnType<typeof import('@reelmakeeasy/common/agent-v2/storage/storage').createStorage>
  > | null,
): Promise<null | string> {
  const requestedAudioPath = audioPath?.trim()
  if (requestedAudioPath) {
    try {
      const storage = preCreatedStorage ?? (await createStorageFn(projectId))
      const fullAudioPath = isStoreUri(requestedAudioPath)
        ? requestedAudioPath
        : storage.getFullPath(requestedAudioPath)
      return storeUriToUrlFn(fullAudioPath)
    } catch {
      return null
    }
  }
  try {
    const storage = preCreatedStorage ?? (await createStorageFn(projectId))
    const hasAudio = await storage.exists(audioVoiceoverPath)
    if (hasAudio) {
      return storeUriToUrlFn(storage.getFullPath(audioVoiceoverPath))
    }
  } catch {
    // ignore
  }
  return null
}

export async function saveLongTakeRequestMetadata(
  deps: WorkflowDeps,
  params: {
    isSavedStyle?: boolean
    normalized: LongTakeStartWorkflowContext
    resolvedAudioPath?: string
    resolvedProjectId: string
    styleName?: string
    styleThumbnailUrl?: string
  },
): Promise<void> {
  const {
    isSavedStyle,
    normalized,
    resolvedAudioPath,
    resolvedProjectId,
    styleName,
    styleThumbnailUrl,
  } = params
  try {
    await deps.kv.set(
      getLongTakeRequestKey(resolvedProjectId),
      {
        audioPath: resolvedAudioPath || null,
        customStyle: normalized.normalizedCustomStyle,
        isSavedStyle: isSavedStyle ?? null,
        script: normalized.normalizedScript || null,
        styleName: styleName?.trim() || null,
        // Kept as an address (no host or port); served as a URL when it is read.
        styleThumbnailUrl: toSavedAddress(styleThumbnailUrl?.trim()) || null,
        styleText: normalized.normalizedStyleText || null,
        userPrompt: normalized.normalizedUserPrompt || null,
      },
      LONG_TAKE_STATUS_TTL_SECONDS,
    )
  } catch (error) {
    const err = ensureError(error)
    deps.logger.warn(
      `Failed to store Story Mode request metadata ${JSON.stringify({
        projectId: resolvedProjectId,
        error: { message: err.message, name: err.name },
      })}`,
    )
  }
}

export async function updateLongTakeProjectMetadataIfNeeded(
  deps: {
    projectsService: {
      internalUpdateProject: (
        projectId: string,
        data: Record<string, unknown>,
        userSub: string,
      ) => Promise<unknown>
    }
  },
  params: {
    longTakeMetadata: LongTakeStartWorkflowContext['longTakeMetadata']
    normalizedInitPrompt?: string
    normalizedProjectId?: string
    normalizedScript: string
    normalizedStyleName?: string
    normalizedStyleText?: string
    normalizedStyleThumbnailUrl?: string
    normalizedVoiceOverJson?: ProjectVoiceOverJson
    resolvedProjectId: string
    userSub: string
  },
): Promise<void> {
  if (!params.normalizedProjectId) {
    return
  }
  const updateData = {
    ...params.longTakeMetadata,
    ...(params.normalizedInitPrompt === undefined
      ? {}
      : { initPrompt: params.normalizedInitPrompt }),
    ...(params.normalizedScript ? { script: params.normalizedScript } : {}),
    ...(params.normalizedStyleText ? { styleText: params.normalizedStyleText } : {}),
    ...(params.normalizedStyleName ? { styleName: params.normalizedStyleName } : {}),
    ...(params.normalizedStyleThumbnailUrl
      ? { styleThumbnailUrl: params.normalizedStyleThumbnailUrl }
      : {}),
    ...(params.normalizedVoiceOverJson ? { voiceOverJson: params.normalizedVoiceOverJson } : {}),
  }
  await deps.projectsService.internalUpdateProject(
    params.resolvedProjectId,
    updateData,
    params.userSub,
  )
}

export async function validateAudioPathForProject(
  deps: {
    copyStoredFile: (src: string, dest: string) => Promise<unknown>
    extractVideoAudioToMp3: (sourceStoreUri: string, destMp3Uri: string) => Promise<void>
    projectPathResolver: { getUserUploadedPath: (name: string) => string }
    isVideoExtension: (ext: string) => boolean
    logger: Logger
    parseStoreUri: (uri: string) => string
  },
  ProjectStoreCtor: new (projectId: string) => {
    getFullPath: (path: string) => string
    getProjectRoot: () => string
  },
  audioPath: string | undefined,
  projectId: string,
  _userId?: string,
): Promise<string | undefined> {
  if (!audioPath) {
    return undefined
  }
  if (isStoreUri(audioPath)) {
    let object: string
    try {
      object = deps.parseStoreUri(audioPath)
    } catch {
      throw new Error('Audio file must be uploaded to workspace storage')
    }
    const projectRoot = new ProjectStoreCtor(projectId).getProjectRoot()
    if (!keyIsUnder(object, projectRoot)) {
      // Audio is a stored file but not in the target project. Copy it over -
      // this covers temp uploads, remixes from other projects, and any other
      // stored file.
      const storage = new ProjectStoreCtor(projectId)
      const fileName = path.basename(object)
      const destinationPath = storage.getFullPath(
        deps.projectPathResolver.getUserUploadedPath(fileName),
      )

      // Video voice-over sources are converted to audio downstream, so persist
      // only the extracted mp3 and leave the (potentially large) source video
      // in temp-only storage. On any extraction failure, fall back to copying
      // the source so the feature never hard-fails on conversion.
      const ext = path.extname(fileName).slice(1).toLowerCase()
      if (deps.isVideoExtension(ext)) {
        const mp3Name = `${path.basename(fileName, path.extname(fileName))}.mp3`
        const mp3DestinationPath = storage.getFullPath(
          deps.projectPathResolver.getUserUploadedPath(mp3Name),
        )
        try {
          await deps.extractVideoAudioToMp3(audioPath, mp3DestinationPath)
          return mp3DestinationPath
        } catch (error) {
          const err = ensureError(error)
          deps.logger.warn(
            `Failed to extract mp3 from video voice-over; falling back to source copy: ${JSON.stringify(
              { audioPath, error: err.message },
            )}`,
          )
        }
      }

      try {
        await deps.copyStoredFile(audioPath, destinationPath)
      } catch (error) {
        const err = ensureError(error)
        deps.logger.warn(
          `Failed to copy audio to project storage: ${JSON.stringify({
            audioPath,
            destinationPath,
            error: err.message,
          })}`,
        )
        throw new Error('Failed to attach audio to project storage')
      }

      return destinationPath
    }
    return audioPath
  }
  if (audioPath.startsWith('http')) {
    throw new Error('Audio file must be uploaded to project storage')
  }
  if (audioPath.includes('..')) {
    throw new Error('Invalid audio path')
  }
  return audioPath
}

// Omitted when unset so off/legacy projects read as no-BGM. Extracted
// so buildLongTakeWorkflowArgs stays within its cognitive-complexity budget.
export function buildBgmFlagWorkflowArgs(
  bgmEnabled?: boolean | null,
  bgmNote?: null | string,
  bgmTrack?: MusicTrackArg | null,
): { bgmEnabled?: boolean; bgmNote?: string; bgmTrack?: MusicTrackArg } {
  if (bgmEnabled == null) return {}
  if (!bgmEnabled) return { bgmEnabled }
  // A chosen track is fitted, so the wish (a director input) has no reader.
  if (bgmTrack) return { bgmEnabled, bgmTrack }
  return { bgmEnabled, ...(bgmNote ? { bgmNote } : {}) }
}

/**
 * An editor export's render settings as the render workflow takes them. The caption look the
 * user was looking at is untrusted input (the API has no body validation), so it is read field
 * by field like the saved column: a malformed field counts as unset, an unreadable look as none
 * chosen (null, the kind's default). Left out, the render reads the look saved on the project.
 */
export function renderRequestSettings(
  settings: LongTakeRenderSettings | undefined,
): LongTakeRenderSettings | undefined {
  if (settings?.captionStyle === undefined) return settings
  return { ...settings, captionStyle: readCaptionStyleSettings(settings.captionStyle) }
}

/** Settings for a re-render from the chat: captions stay as the project has them (legacy
 *  null means on, as the pipeline renders it). */
export function editRenderSettings(
  project: null | undefined | { enableCaption?: boolean | null },
): { captionEnabled: boolean } {
  return { captionEnabled: project?.enableCaption !== false }
}

/** Only Dynamic adds an arg, so Calm runs carry exactly what they did before. */
export function buildCameraStyleWorkflowArgs(style?: CameraStyle | null): {
  cameraStyle?: 'dynamic'
} {
  return style === 'dynamic' ? { cameraStyle: 'dynamic' } : {}
}

function buildRequestedDurationWorkflowArgs(targetDurationSeconds?: number): {
  requestedDurationSeconds?: number
} {
  return typeof targetDurationSeconds === 'number' &&
    Number.isFinite(targetDurationSeconds) &&
    targetDurationSeconds > 0
    ? { requestedDurationSeconds: targetDurationSeconds }
    : {}
}

function buildSourceWorkflowArgs(source?: 'mcp' | 'web'): { source?: 'mcp' | 'web' } {
  return source ? { source } : {}
}
