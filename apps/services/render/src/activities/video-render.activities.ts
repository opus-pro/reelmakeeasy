import * as fs from 'node:fs'
import * as path from 'node:path'

import { VideoScriptAdapter } from '@reelmakeeasy/common/adapters/video-script-adapter'
import { VIDEO_FRAME_RATE } from '@reelmakeeasy/common/constant/video'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { logger } from '@reelmakeeasy/common/logger'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { presetPackFileUri, RENDER_PRESETS } from '@reelmakeeasy/common/storage/presets'
import { CODEGEN_LAYOUT_ID } from '@reelmakeeasy/common/template/consts'
import { getTemplatesUri } from '@reelmakeeasy/common/template/manager-tool/template-paths'
import { getAllTemplatesSpec } from '@reelmakeeasy/common/template/manager-tool/get-templates-spec'
import { Images, RenderTemplate } from '@reelmakeeasy/common/template/type'
import type { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { runCommand } from '@reelmakeeasy/common/utils/cmdline'
import { download } from '@reelmakeeasy/common/utils/download'
import { isDev } from '@reelmakeeasy/common/utils/env'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { workspaceUri, uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { getProjectPath } from '@reelmakeeasy/common/utils/getProjectRoot'
import { resolveVideoScript } from '@reelmakeeasy/common/utils/video-script-store'
import type { TaskRequest } from '@reelmakeeasy/common/workflow/types'
import type {
  RenderContext,
  RenderPreviewResult,
  RenderVideoParams,
  RenderVideoResult,
  RenderVideoWorkflowDef,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { heartbeat } from '@reelmakeeasy/workflow-engine/activity'
import { VideoRenderService } from '@shared/render-services/render'
import { pick } from 'lodash-es'
import sharp from 'sharp'

import { resolveLocalDownloadPath } from '../utils/local-download-path'
import {
  computeInputHash,
  computeRenderCacheKey,
  isRenderCacheEnabled,
  lookupCacheKey,
  type RenderCacheParams,
  type RenderCacheScope,
  saveCacheKeyMapping,
  tryRestoreFromCache,
  writeRenderCache,
} from '../utils/render-cache'
import {
  getRenderOutputPath,
  getRenderPlanAbsolutePath,
  getRenderPlanRelativePath,
  renderPlanImage,
  renderPlanVideo,
} from '../utils/render-plan-renderer'

const isVideo = (uri: string) => uri.endsWith('.mp4')

const DEFAULT_OUTPUT_SIZE = { height: 1920, width: 1080 }
const OUTPUT_SIZE_BY_RATIO: Record<AspectRatio, { height: number; width: number }> = {
  '1:1': { height: 1080, width: 1080 },
  '9:16': DEFAULT_OUTPUT_SIZE,
  '16:9': { height: 1080, width: 1920 },
}

export class VideoRenderActivities extends VideoRenderService {
  /**
   * Generates a preview image from the video
   */
  override async renderPreview(
    params: TaskRequest<RenderVideoParams, RenderContext>,
  ): Promise<RenderPreviewResult> {
    const heartbeatInterval = setInterval(heartbeat, 10_000)
    const { projectId } = params.context
    try {
      return await JobContext.run({ projectId }, async () => {
        const time = Math.max(0, params.payload.previewTime ?? 1000)
        const { outputPath: previewPath } = await renderImageLocally({
          context: params.context,
          payload: { ...params.payload, time },
        })
        const fileUri = workspaceUri(
          params.context.projectId,
          'render',
          params.context.videoId,
          'preview.png',
        )
        await uploadToStore(previewPath, fileUri)

        return { imageUri: fileUri }
      })
    } finally {
      if (!isDev()) {
        fs.rmSync(getRenderOutputPath(params.context.videoId), { recursive: true, force: true })
      }
      clearInterval(heartbeatInterval)
    }
  }

  /**
   * Renders a video using the render plan
   */
  override async renderVideo(arg: RenderVideoWorkflowDef['arg']): Promise<RenderVideoResult> {
    const heartbeatInterval = setInterval(() => {
      try {
        logger.info('Sending heartbeat from renderVideo activity')
        heartbeat()
      } catch (error) {
        logger.error({ error }, 'Failed to send heartbeat from renderVideo activity')
      }
    }, 10_000)
    const { projectId, videoId } = arg.context
    try {
      const result = await JobContext.run({ projectId }, async () => {
        const fileUri = workspaceUri(projectId, 'render', videoId, 'video.mp4')

        if (isRenderCacheEnabled()) {
          const cacheScope: RenderCacheScope = { projectId, videoId }
          const inputHash = computeInputHash(arg.payload, cacheScope)
          const cacheParams: RenderCacheParams = {
            fps: arg.payload.fps,
            aspectRatio: arg.payload.aspectRatio,
            segmentTimeRange: arg.payload.segmentTimeRange,
            config: arg.payload.config,
          }

          // Fast path: use cached input-to-cacheKey mapping (skips prepareLocalRenderPlan)
          const mappedKey = lookupCacheKey(inputHash)
          if (mappedKey && (await tryRestoreFromCache(mappedKey, fileUri))) {
            logger.info({ cacheKey: mappedKey }, 'Render cache HIT (fast path)')
            return { videoUri: fileUri }
          }

          // Slow path: compute full cache key from render plan
          const { renderPlan } = await prepareLocalRenderPlan(arg.context, arg.payload)
          const cacheKey = computeRenderCacheKey(renderPlan, cacheParams, cacheScope)
          saveCacheKeyMapping(inputHash, cacheKey)

          if (await tryRestoreFromCache(cacheKey, fileUri)) {
            logger.info({ cacheKey }, 'Render cache HIT (slow path)')
            return { videoUri: fileUri }
          }
          const { outputPath } = await renderVideoLocally(arg, renderPlan)
          await uploadToStore(outputPath, fileUri)
          const writePromise = writeRenderCache({
            cacheKey,
            localVideoPath: outputPath,
            projectId,
            videoId,
          })
          if (!isDev()) {
            await writePromise
          }
          return { videoUri: fileUri }
        }

        // Cache disabled (production)
        const { outputPath } = await renderVideoLocally(arg)
        await uploadToStore(outputPath, fileUri)
        return { videoUri: fileUri }
      })
      return result
    } finally {
      if (!isDev()) {
        fs.rmSync(getRenderOutputPath(videoId), { recursive: true, force: true })
      }
      clearInterval(heartbeatInterval)
    }
  }

  /**
   * Resolves a VideoScript object from inline data or store address.
   */
  override resolveVideoScriptActivity(
    params: Pick<RenderVideoParams, 'videoScript' | 'videoScriptUri'>,
  ): Promise<VideoScript> {
    return resolveVideoScript(params)
  }
}

async function prepareLocalRenderPlan(context: RenderContext, renderParams: RenderVideoParams) {
  const startTime = Date.now()
  const { videoId } = context
  const renderIdPath = getProjectPath('./apps/services/api/dist/render', videoId)
  let currentTemplateSnapshot: RenderTemplate[] | undefined

  logger.info('Render params: videoScriptUri passed', {
    videoScriptUriPassed: Boolean(renderParams.videoScriptUri),
    videoId,
  })

  const videoScript = await resolveVideoScript(renderParams)

  const captionRenderPref = videoScript.captionRenderPref

  const prepareResource = async () => {
    // Fonts and the template snapshot ship in the preset pack.
    await getFileAndExtract(presetPackFileUri(RENDER_PRESETS.fonts))

    const currentTemplateSnapshotPath = await getFilePath(
      presetPackFileUri(RENDER_PRESETS.templateSnapshot),
    )
    try {
      currentTemplateSnapshot = JSON.parse(
        await fs.promises.readFile(currentTemplateSnapshotPath, 'utf8'),
      )
    } catch (error) {
      logger.error({ error: ensureError(error) }, 'Failed to parse current template snapshot')
    }
  }

  // Which source URI owns which local path in THIS render, so two sources that
  // share a basename cannot land on the same file (see resolveLocalDownloadPath).
  const claimedLocalPaths = new Map<string, string>()

  const getFilePath = async (uri: string, subDir?: string) => {
    const outputDir = path.resolve(renderIdPath, subDir ?? '')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    try {
      const outputPath = resolveLocalDownloadPath({ claimed: claimedLocalPaths, outputDir, uri })
      const noCache = ['.json', '.ts', '.tsx'].includes(path.extname(uri))
      await download(uri, outputPath, { noCache })
      logger.debug(`getFilePath Download completed: ${uri} -> ${outputPath}`)
      return outputPath
    } catch (error) {
      logger.error(
        { error: ensureError(error), uri },
        `Download failed for ${uri}, with error: ${error}`,
      )
      throw new Error(`getFilePath: Download failed for ${uri}, with error: ${error}`)
    }
  }

  const getFileAndExtract = async (uri: string, subDir?: string) => {
    const filePath = await getFilePath(uri, subDir)
    if (!fs.existsSync(filePath)) {
      logger.warn(`File does not exist: ${filePath}`)
      return filePath
    }
    if (!filePath.endsWith('.tar.gz')) {
      return filePath
    }
    const extractPath = path.dirname(filePath)
    // macOS uses BSD tar which doesn't support --warning=no-unknown-keyword (GNU tar only)
    const command =
      process.platform === 'darwin'
        ? ['tar', '-xf', filePath, '-C', extractPath]
        : ['tar', '--warning=no-unknown-keyword', '-xf', filePath, '-C', extractPath]
    await runCommand(command)
    return extractPath
  }

  await prepareResource()
  const renderPlan = await VideoScriptAdapter.genRenderPlan({
    captionRenderPref,
    // The local ffmpeg renderer draws captions with their own outline and shadow;
    // the caption cover image is a hosted asset it does not ship.
    forcedHideCaptionBg: true,
    getAllTemplatesSpec,
    getFilePath: async (url: string, subDir?: string) => {
      if (!url?.trim()) {
        throw new Error('getFilePath: URL is empty')
      }
      const filePath = await getFileAndExtract(url, subDir)
      return getRenderPlanRelativePath(filePath, videoId) ?? ''
    },
    getTemplateAssetPath: async ({ layoutId }) => {
      if (layoutId === CODEGEN_LAYOUT_ID) {
        return CODEGEN_LAYOUT_ID
      }

      logger.info(`Getting template asset path for ${layoutId}`)

      const snapshotTemplate = currentTemplateSnapshot?.find((t) => t.name === layoutId)

      if (snapshotTemplate) {
        const version = `v${snapshotTemplate.version || 1}`
        const uri = getTemplatesUri(layoutId, version, 'template.json')
        const filePath = await getFileAndExtract(uri, layoutId)
        if (fs.existsSync(filePath)) {
          return getRenderPlanRelativePath(path.dirname(filePath), videoId) ?? ''
        }
        logger.warn(`getTemplateAssetPath: File does not exist: ${filePath} for ${layoutId}`)
      } else {
        const uri = getTemplatesUri(layoutId, `v${1}`, 'template.tsx')
        const filePath = await getFileAndExtract(uri, layoutId)
        if (fs.existsSync(filePath)) {
          return getRenderPlanRelativePath(path.dirname(filePath), videoId) ?? ''
        }
        logger.warn(`getTemplateAssetPath: File does not exist: ${filePath} for ${layoutId}`)
      }
      throw new Error(`File does not exist: ${layoutId}`)
    },
    getMediaMetadata: async (image: Images<string>['images'][number]) => {
      const uri = await getFilePath(image.uri, 'images')
      let mediaMetadata: { height: number; width: number }
      if (isVideo(uri)) {
        const { stdout } = await runCommand([
          'ffprobe',
          '-v',
          'quiet',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height',
          '-of',
          'csv=p=0',
          uri,
        ])
        const [width, height] = stdout.trim().split(',').map(Number)
        mediaMetadata = { width, height }
      } else {
        mediaMetadata = await sharp(uri).metadata()
      }
      if (!mediaMetadata.width || !mediaMetadata.height) {
        mediaMetadata.width = 1080
        mediaMetadata.height = 1920
      }
      return mediaMetadata
    },
    getFallbackFontPath: async () => {
      return getRenderPlanRelativePath(
        path.join(renderIdPath, 'fonts', 'DMSans-Regular.ttf'),
        videoId,
      )
    },
    getVideoFps: () => renderParams.fps || VIDEO_FRAME_RATE,
    outputSize: resolveOutputSize(renderParams.aspectRatio, renderParams.outputResolution),
    rootDir: getRenderPlanAbsolutePath(renderIdPath),
    videoScript,
  })

  logger.info(`prepareLocalRenderPlan took ${Date.now() - startTime}ms`)
  return { renderPlan }
}

async function renderImageLocally(params: {
  context: RenderContext
  payload: RenderVideoParams & { time: number }
}): Promise<{ outputPath: string }> {
  const { projectId, videoId } = params.context
  const renderParams = params.payload

  const { renderPlan } = await prepareLocalRenderPlan(params.context, renderParams)

  try {
    const { imageUri: outputPath } = await renderPlanImage({
      config: {
        ...pick(renderParams, [
          'author',
          'content',
          'durationInSeconds',
          'highlightStartTime',
          'postDate',
          'source',
          'title',
          'url',
          'videoScriptUri',
        ]),
        config: renderParams.config || {},
        renderPlan,
      },
      projectId,
      videoId,
      time: renderParams.time,
    })
    return { outputPath }
  } catch (error) {
    logger.error({ error: ensureError(error) }, 'Debug - Error in renderImage')
    throw error
  }
}

async function renderVideoLocally(
  arg: RenderVideoWorkflowDef['arg'],
  existingRenderPlan?: RenderPlan,
): Promise<{ outputPath: string }> {
  const {
    context: { projectId, videoId },
    payload: renderParams,
  } = arg

  const renderPlan =
    existingRenderPlan ?? (await prepareLocalRenderPlan(arg.context, renderParams)).renderPlan

  try {
    const outputPath = await renderPlanVideo({
      config: {
        ...pick(renderParams, [
          'author',
          'content',
          'durationInSeconds',
          'highlightStartTime',
          'postDate',
          'source',
          'title',
          'url',
          'videoScriptUri',
        ]),
        config: renderParams.config || {},
        renderPlan,
      },
      projectId,
      videoId,
      segmentTimeRange: renderParams.segmentTimeRange,
    })
    return { outputPath }
  } catch (error) {
    logger.error({ error: ensureError(error) }, 'Debug - Error in renderVideoLocally')
    throw error
  }
}

function resolveOutputSize(
  ratio?: AspectRatio,
  customSize?: { height: number; width: number },
): { height: number; width: number } {
  // Explicit override (low-res render for Topaz upscaling) wins over
  // the aspect-ratio default, but only when it is a valid positive size; an
  // invalid override falls back to the default rather than rendering garbage.
  if (customSize && customSize.width > 0 && customSize.height > 0) {
    return customSize
  }
  if (!ratio) {
    return DEFAULT_OUTPUT_SIZE
  }
  return OUTPUT_SIZE_BY_RATIO[ratio] ?? DEFAULT_OUTPUT_SIZE
}
