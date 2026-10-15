import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import * as path from 'node:path'

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { Logger } from '@reelmakeeasy/common/logger'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFile,
  deleteStoredFile,
  downloadStoredFile,
  downloadStoredFileWithRetry,
  isStoreUri,
  keyIsUnder,
  listStoreUris,
  projectRootKey,
  projectUri,
  storedFileExists,
  storeKeyOf,
  uploadBufferToStore,
  uploadWorkspaceFile,
  workspaceUri,
} from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import {
  cleanupThumbnailScratch,
  createThumbnailFromImageToScratch,
  createThumbnailFromVideoToScratch,
  uploadThumbnailAndCleanup,
} from '../util/create-thumbnail/create'
import { rasterizeForLlm, shouldRasterizeForLlm } from '../util/rasterize-upload-for-llm'

import {
  copyProjectUserUploadedPrefixes,
  getProjectV2StorageUri,
  resolveAttachmentCopySourceUri,
} from './media-project-copy.util'
import { resolveUploadedFileUri } from './uploaded-file-uri'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = new Logger('MediaService')

// Custom metadata key on the durable thumbnail, stamping the generation of
// the final_video.mp4 it was extracted from.
const THUMBNAIL_SOURCE_VERSION_KEY = 'sourceVersion'

// `.webm` is a container that can carry either audio-only (MediaRecorder
// voice memos) or video-with-audio (MediaRecorder screen / camera captures).
// It intentionally appears in BOTH AUDIO_EXTENSIONS and IMAGE_VIDEO_EXTENSIONS;
// the prefix-aware classifier in scanUserUploadedAssetsFromStore picks the
// right meaning based on where the file lives:
//   - Legacy `projects/{projectId}/user_uploaded/`  -> audio-source folder, `.webm` is audio
//   - UIP    `projects/{projectId}/user-intent-planner/uploads/` -> visual folder, `.webm` is video
// Do NOT "clean up" the duplication by removing `.webm` from either set without
// also revisiting the classifier -- silent miscategorization will follow.
const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
  '.wma',
])
const IMAGE_VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.mkv',
  '.mov',
  '.mp4',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webm',
  '.webp',
])

function getAttachmentCopyFileName(attachment: { name?: null | string; uri: string }): string {
  const uriBaseName = path.posix.basename(attachment.uri?.trim() || '')
  if (uriBaseName && uriBaseName !== '.' && uriBaseName !== '..') {
    return uriBaseName
  }

  const nameBaseName = path.posix.basename(attachment.name?.trim() || '')
  return nameBaseName && nameBaseName !== '.' && nameBaseName !== '..' ? nameBaseName : ''
}

function getMimeType(ext: string): string {
  if (ext === '.png') {
    return 'image/png'
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg'
  }
  if (ext === '.gif') {
    return 'image/gif'
  }
  if (ext === '.webp') {
    return 'image/webp'
  }
  if (ext === '.svg') {
    return 'image/svg+xml'
  }
  if (ext === '.bmp') {
    return 'image/bmp'
  }
  if (ext === '.tif' || ext === '.tiff') {
    return 'image/tiff'
  }
  if (ext === '.heic') {
    return 'image/heic'
  }
  if (ext === '.heif') {
    return 'image/heif'
  }
  if (ext === '.avif') {
    return 'image/avif'
  }
  if (ext === '.mp4') {
    return 'video/mp4'
  }
  if (ext === '.mov') {
    return 'video/quicktime'
  }
  if (ext === '.webm') {
    return 'video/webm'
  }
  if (ext === '.avi') {
    return 'video/x-msvideo'
  }
  if (ext === '.mkv') {
    return 'video/x-matroska'
  }
  return 'application/octet-stream'
}

const THUMBNAIL_PRESET_WIDTHS = {
  preview: 80,
  editor: 360,
} as const

type ThumbnailPreset = keyof typeof THUMBNAIL_PRESET_WIDTHS

const DOWNLOAD_RETRY = { maxRetries: 3, timeoutMs: 30_000 } as const

@Injectable()
export class MediaService {
  private readonly projectsBasePath: string
  constructor(private readonly prisma: PrismaService) {
    const projectDir = process.env['PROJECT_DIR'] || join(process.cwd(), 'tmp', 'agents_workspace')
    this.projectsBasePath = projectDir
    logger.log('projectsBasePath', this.projectsBasePath)
  }

  /**
   * Copy user-uploaded assets and previews from one project to another, including DB records.
   */
  async copyProjectFiles(sourceProjectId: string, targetProjectId: string) {
    await copyProjectUserUploadedPrefixes(sourceProjectId, targetProjectId)

    const attachments = await this.prisma.projectAttachment.findMany({
      where: { projectId: sourceProjectId },
    })

    if (!attachments.length) {
      return
    }

    for (const attachment of attachments) {
      const copiedAttachment = await this.prisma.projectAttachment.findFirst({
        where: {
          projectId: targetProjectId,
          md5: attachment.md5,
        },
      })
      if (copiedAttachment) {
        continue
      }

      const fileName = getAttachmentCopyFileName(attachment)
      const sourceUri = await resolveAttachmentCopySourceUri({
        attachmentUri: attachment.uri,
        fileName,
        sourceProjectId,
      })
      const targetUri = getProjectV2StorageUri(
        targetProjectId,
        path.posix.join('user_uploaded', fileName),
      )

      try {
        // user uploaded file
        await copyStoredFile(sourceUri, targetUri)

        // preprocess upload files
        await this.uploadFile(targetProjectId, {
          fileContentType: attachment.mime,
          fileUri: targetUri,
          fileName,
        })
      } catch (error) {
        throw new BadRequestException(
          `Failed to copy attachment file, ${ensureError(error).message}`,
          { cause: error },
        )
      }
    }
  }

  async copyTempFileToProject(params: {
    fileContentType: string
    fileName: string
    projectId: string
    tempFileUri: string
    userId: string
  }) {
    const { projectId, tempFileUri, userId } = params
    const normalizedTempFileUri = resolveUploadedFileUri(tempFileUri.trim())
    const sanitizedUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_')
    const tempKey = storeKeyOf(normalizedTempFileUri)
    if (!tempKey || !keyIsUnder(tempKey, `tmp/${sanitizedUserId}`)) {
      throw new BadRequestException('Temp file must belong to the current user')
    }

    // SVG / HEIC / HEIF / AVIF / TIFF aren't accepted by vision LLMs (OpenAI +
    // Gemini both 400 "not a valid image"). Rasterize at promote time so the
    // ProjectAttachment record and every downstream consumer (story-mode user
    // asset understanding, anchor generation, ...) sees a PNG.
    let { fileContentType, fileName } = params
    if (shouldRasterizeForLlm({ contentType: fileContentType, fileName })) {
      try {
        const sourceBuffer = await this.downloadStoredFileToBuffer(normalizedTempFileUri)
        const out = await rasterizeForLlm(sourceBuffer, fileName)
        fileContentType = out.contentType
        fileName = out.fileName
        const destinationStorage = new ProjectStore(projectId)
        const destinationRelativePath = path.posix.join('user_uploaded', fileName)
        const destinationStorePath = destinationStorage.getFullPath(destinationRelativePath)
        await uploadBufferToStore(out.buffer, destinationStorePath, {
          contentType: out.contentType,
        })
        logger.log(
          `[${projectId}] Rasterized + uploaded temp asset ${params.fileName} -> ${fileName}`,
        )
        const rasterizedResult = await this.uploadFile(projectId, {
          fileContentType,
          fileUri: destinationStorePath,
          fileName,
          tempSourceStorePath: normalizedTempFileUri,
        })
        await Promise.allSettled([
          deleteStoredFile(normalizedTempFileUri),
          deleteStoredFile(`${normalizedTempFileUri}.analysis.json`),
        ])
        return rasterizedResult
      } catch (err) {
        logger.warn(
          { err: ensureError(err), fileName: params.fileName, projectId },
          'Rasterization failed; falling back to plain copy',
        )
        fileContentType = params.fileContentType
        fileName = params.fileName
      }
    }

    const destinationStorage = new ProjectStore(projectId)
    const destinationRelativePath = path.posix.join('user_uploaded', fileName)
    const destinationStorePath = destinationStorage.getFullPath(destinationRelativePath)

    await copyStoredFile(normalizedTempFileUri, destinationStorePath)

    const result = await this.uploadFile(projectId, {
      fileContentType,
      fileUri: destinationStorePath,
      fileName,
      tempSourceStorePath: normalizedTempFileUri,
    })

    await Promise.allSettled([
      deleteStoredFile(normalizedTempFileUri),
      deleteStoredFile(`${normalizedTempFileUri}.analysis.json`),
    ])

    return result
  }

  /**
   * Generate (or reuse) the final-video thumbnail and return its CDN url.
   *
   * All durable I/O goes through the storage abstraction (storage) and
   * all scratch lives under os.tmpdir. Returns undefined when there is no
   * final video (or on error), so the caller can skip the thumbnail patch.
   */
  async generateFinalVideoThumbnail(projectId: string): Promise<string | undefined> {
    try {
      const storage = await createStorage(projectId)
      const thumbnailKey = '_thumbnail/final_video.mp4.jpg'
      // Durable thumbnail CDN url from the agent-v2 key (not storage.getFullPath,
      // which is a local FS path for LocalStorage) so it is always a usable url.
      const cdnUrl = storeUriToUrl(projectUri(projectId, thumbnailKey))
      // Posters written before this key carried `cacheControl` inherited a
      // 30-day max-age, so an edge that already cached one would keep serving
      // the pre-edit frame however fresh the object is. Key the url to the
      // source version instead of relying on revalidation.
      const versionedUrl = (version: string) => `${cdnUrl}?v=${version}`

      const thumbExists = await storage.exists(thumbnailKey)

      if (!(await storage.exists('final_video.mp4'))) {
        // no final video in storage: we cannot re-derive, so an existing
        // poster is still the best answer we can give.
        return thumbExists ? cdnUrl : undefined
      }

      // The poster is a derivative of a file the editor overwrites in place,
      // so reuse is keyed on the source version it was extracted from, not
      // on mere existence.
      const source = await storage.getObjectMetadata('final_video.mp4')
      const poster = thumbExists ? await storage.getObjectMetadata(thumbnailKey) : undefined
      if (source && poster?.custom[THUMBNAIL_SOURCE_VERSION_KEY] === source.version) {
        return versionedUrl(source.version)
      }

      // Download the video and render the thumbnail entirely within node-local
      // temp (os.tmpdir), then upload the durable copy via the storage
      // abstraction.
      const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'final-video-thumb-'))
      try {
        const localVideoPath = path.join(scratchDir, 'final_video.mp4')
        await storage.downloadFile('final_video.mp4', localVideoPath)

        // default thumbnail size is width-360, aspect-preserving
        const { thumbnailPath } = await createThumbnailFromVideoToScratch(localVideoPath)
        if (!thumbnailPath) {
          return undefined
        }
        try {
          await storage.uploadFile(thumbnailPath, thumbnailKey, {
            ...(source && { metadata: { [THUMBNAIL_SOURCE_VERSION_KEY]: source.version } }),
          })
          return source ? versionedUrl(source.version) : cdnUrl
        } finally {
          await cleanupThumbnailScratch(thumbnailPath)
        }
      } finally {
        await fs.rm(scratchDir, { force: true, recursive: true }).catch(() => undefined)
      }
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, projectId }, 'Error generating final video thumbnail')
      return undefined
    }
  }

  async getAttachments(projectId: string) {
    return await this.prisma.projectAttachment.findMany({
      where: {
        projectId,
      },
    })
  }

  getContentType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()

    switch (ext) {
      case 'avi': {
        return 'video/x-msvideo'
      }
      case 'avif': {
        return 'image/avif'
      }
      case 'gif': {
        return 'image/gif'
      }
      case 'heic': {
        return 'image/heic'
      }
      case 'heif': {
        return 'image/heif'
      }
      case 'html': {
        return 'text/html'
      }
      case 'jpeg':
      case 'jpg': {
        return 'image/jpeg'
      }
      case 'json': {
        return 'application/json'
      }
      case 'm4a': {
        return 'audio/mp4'
      }
      case 'mov': {
        return 'video/quicktime'
      }
      case 'mp3': {
        return 'audio/mpeg'
      }
      case 'mp4': {
        return 'video/mp4'
      }
      case 'png': {
        return 'image/png'
      }
      case 'svg': {
        return 'image/svg+xml'
      }
      case 'tif':
      case 'tiff': {
        return 'image/tiff'
      }
      case 'txt': {
        return 'text/plain'
      }
      case 'wav': {
        return 'audio/wav'
      }
      case 'webm': {
        return 'video/webm'
      }
      case 'webp': {
        return 'image/webp'
      }
      default: {
        return 'application/octet-stream'
      }
    }
  }

  /**
   * Get file from storage as fallback when local file doesn't exist
   * Downloads to temp directory and reads the buffer
   */
  async getFileFromStore(projectId: string, filePath: string): Promise<Buffer> {
    try {
      const fileUri = workspaceUri(projectId, filePath)

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-store-'))
      const tempFilePath = path.join(tempDir, path.basename(filePath))

      try {
        // Download from storage
        logger.log(`Downloading from storage: ${fileUri}`)
        await downloadStoredFile(fileUri, tempFilePath)

        // Read file buffer
        const buffer = await fs.readFile(tempFilePath)

        // Cleanup temp file
        await fs.rm(tempDir, { recursive: true, force: true })

        return buffer
      } catch (error) {
        // Cleanup on error
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
          // Ignore cleanup errors
        })
        throw error
      }
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, projectId, filePath }, 'Failed to get file from storage')
      throw new NotFoundException(`File not found in local or storage: ${filePath}`)
    }
  }

  getProjectFilePath(projectId: string, filePath: string): string {
    return join(this.projectsBasePath, projectId, filePath)
  }

  async getUserUploadedAssets(projectId: string): Promise<{
    assets: { mimeType: string; name: string; url: string }[]
    audioUrl: null | string
  }> {
    let assets: { mimeType: string; name: string; url: string }[] = []
    let audioUrl: null | string = null

    // Resolve audio-mode in parallel with the storage scan. The scanner only
    // needs `isAudioMode` for the classify step, not for the listing IO,
    // so we hand it the in-flight promise and let it Promise.all alongside
    // its two listStoreUris calls. isAudioModeProject is already fail-soft
    // (catches internally, returns false on Mongo errors), so the promise
    // never rejects.
    const isAudioModePromise = this.isAudioModeProject(projectId)

    try {
      const fromStore = await this.scanUserUploadedAssetsFromStore(projectId, {
        isAudioModePromise,
      })
      assets = fromStore.assets
      audioUrl = fromStore.audioUrl
    } catch (error) {
      logger.warn('Failed to scan storage for user-uploaded assets', {
        error: ensureError(error),
        projectId,
      })
    }

    if (assets.length === 0 && !audioUrl) {
      try {
        const fromDb = await this.scanUserUploadedAssetsFromDb(projectId)
        assets = fromDb.assets
        audioUrl = fromDb.audioUrl
      } catch (error) {
        logger.warn('Failed to fetch DB attachments fallback', {
          error: ensureError(error),
          projectId,
        })
      }
    }

    return { assets, audioUrl }
  }

  /**
   * Resolve whether this project is in audio-mode -- the user uploaded an
   * audio (or video-as-audio) source that drives the voice-over track.
   *
   * - UIP signal: `UipSession.state.audio_source === 'user_audio'`
   * - Classic Story Mode signal: `Project.longTakeInput === 'audio'`
   *
   * **A UipSession row is authoritative for its project.** When a session
   * exists we decide audio-mode from `state.audio_source` alone and do NOT
   * fall through to `Project.longTakeInput`. The Project field can hold a
   * stale `'audio'` from a classic->UIP migration where the user has since
   * switched to image-mode, and we don't want that to flip the scanner
   * into audio-mode for an image-mode project.
   *
   * Only when no UipSession row exists at all (classic Story Mode project,
   * or pre-UIP data) do we consult `Project.longTakeInput`.
   *
   * Both reads fail-soft -- a Mongo blip on the attachments endpoint should
   * not surface a 500 to the share page. Falsy result keeps the legacy
   * "video-in-assets" behavior so non-audio-mode projects are unaffected.
   *
   * Defensive optional-chaining survives tests that stub only the prisma
   * surfaces they exercise (e.g. older `MediaService.getUserUploadedAssets`
   * tests pass a stub with only `projectAttachment`).
   */
  async isAudioModeProject(projectId: string): Promise<boolean> {
    try {
      const sessionPromise = this.prisma.uipSession?.findUnique?.({
        where: { projectId },
        select: { state: true },
      })
      if (sessionPromise) {
        const session = (await sessionPromise) as null | {
          state?: null | { audio_source?: 'user_audio' | null }
        }
        if (session !== null) {
          // UipSession is authoritative -- answer from session.state and
          // do not consult Project.longTakeInput.
          return session.state?.audio_source === 'user_audio'
        }
      }
    } catch (error) {
      logger.warn('Failed to read UipSession.state.audio_source', {
        error: ensureError(error),
        projectId,
      })
      // Fall through to Project lookup. A Mongo blip on the UIP session
      // read shouldn't lose audio-mode classification for classic Story
      // Mode projects (which never have a UipSession row anyway).
    }

    try {
      const projectPromise = this.prisma.project?.findUnique?.({
        where: { id: projectId },
        select: { longTakeInput: true },
      })
      if (!projectPromise) {
        return false
      }
      const project = (await projectPromise) as null | { longTakeInput?: null | string }
      return project?.longTakeInput === 'audio'
    } catch (error) {
      logger.warn('Failed to read Project.longTakeInput', {
        error: ensureError(error),
        projectId,
      })
      return false
    }
  }

  async saveToDb({
    projectId,
    title,
    mime,
    uri,
    md5,
    previewImageUrl,
  }: {
    md5: string
    mime: string
    previewImageUrl?: string
    projectId: string
    title: string
    uri: string
  }) {
    return await this.prisma.projectAttachment.create({
      data: {
        projectId,
        name: title,
        uri,
        md5,
        mime,
        previewImageUrl,
      },
    })
  }

  public async uploadFile(
    projectId: string,
    body: {
      fileContentType: string
      fileUri: string
      fileName: string
      generateVideoPreview?: boolean
      tempSourceStorePath?: string
      thumbnailPreset?: ThumbnailPreset
      uploadToCdn?: boolean
    },
  ) {
    const uploadToCdn = body.uploadToCdn === true || String(body.uploadToCdn) === 'true'
    const generateVideoPreview =
      body.generateVideoPreview === true || String(body.generateVideoPreview) === 'true'
    const thumbnailPreset = this.resolveThumbnailPreset(body.thumbnailPreset)

    let tempFilePath: string | undefined

    try {
      // Download file from storage
      const fileName = path.basename(body.fileUri)
      tempFilePath = join(process.cwd(), 'tmp', `upload-${Date.now()}-${fileName}`)

      const fileUri = resolveUploadedFileUri(body.fileUri)

      await downloadStoredFileWithRetry(fileUri, tempFilePath, DOWNLOAD_RETRY)

      const decodedFileName = path.posix.basename(body.fileName) // reject ../.. traversal
      if (
        !decodedFileName ||
        decodedFileName !== body.fileName ||
        decodedFileName === '..' ||
        decodedFileName === '.'
      ) {
        throw new BadRequestException('Invalid file name')
      }
      const relativePath = `user_uploaded/${decodedFileName}`
      const fileBuffer = await fs.readFile(tempFilePath)
      const fileMd5 = createHash('md5').update(fileBuffer).digest('hex')

      // Write the `user_uploaded/` object via the storage abstraction (storage).
      // Downstream steps read localFilePath (the ephemeral node-local temp); the
      // DB uri is the project-relative key.
      const storage = await createStorage(projectId)
      await storage.writeFile(relativePath, fileBuffer)
      const localFilePath = tempFilePath

      let cdnUrl = ''
      if (uploadToCdn) {
        cdnUrl = await uploadWorkspaceFile(projectId, localFilePath, relativePath)
      }

      const { thumbnailUrl, previewCdnUrl } = await this.generateThumbnailAndPreview(
        projectId,
        localFilePath,
        body.fileContentType,
        generateVideoPreview ? cdnUrl : '',
        thumbnailPreset,
      )

      const { id } = await this.saveToDb({
        projectId,
        mime: body.fileContentType,
        title: decodedFileName,
        uri: path.posix.join(projectId, relativePath),
        md5: fileMd5,
        previewImageUrl: thumbnailUrl,
      })

      await this.copyTempAnalysisToProject({
        finalFileStorePath: fileUri,
        tempSourceStorePath: body.tempSourceStorePath,
      })
      return {
        id,
        fileName: decodedFileName,
        path: relativePath,
        cdnUrl,
        thumbnailCdnUrl: thumbnailUrl,
        previewCdnUrl,
        success: true,
      }
    } finally {
      // Clean up temp file + the .analysis.json sidecar that would otherwise leak.
      if (tempFilePath) {
        await fs.unlink(tempFilePath).catch(() => logger.warn(`Failed to cleanup: ${tempFilePath}`))
        await fs.unlink(`${tempFilePath}.analysis.json`).catch(() => undefined)
      }
    }
  }

  private async copyTempAnalysisToProject(params: {
    finalFileStorePath: string
    tempSourceStorePath?: string
  }): Promise<void> {
    const { finalFileStorePath, tempSourceStorePath } = params
    const normalizedTempSourcePath = tempSourceStorePath?.trim()
    if (!normalizedTempSourcePath) {
      return
    }
    const tempSourceKey = storeKeyOf(normalizedTempSourcePath)
    if (!tempSourceKey || !keyIsUnder(tempSourceKey, 'tmp')) {
      return
    }

    const tempAnalysisStorePath = `${normalizedTempSourcePath}.analysis.json`
    try {
      if (!(await storedFileExists(tempAnalysisStorePath))) {
        return
      }

      const finalAnalysisStorePath = `${finalFileStorePath}.analysis.json`
      // Persist the sidecar to storage alongside the final artifact (durable copy).
      await copyStoredFile(tempAnalysisStorePath, finalAnalysisStorePath)
    } catch (error) {
      logger.warn(
        {
          error: ensureError(error),
          finalFileStorePath,
          tempAnalysisStorePath,
        },
        'Failed to copy temp analysis file to project storage',
      )
    }
  }

  private async downloadStoredFileToBuffer(fileUri: string): Promise<Buffer> {
    return fileStore.file(fileUri).read()
  }

  /**
   * `videoPreviewUrl` is the playable preview to hand back for a video: the
   * uploaded file itself, which the API serves from local storage, so there is
   * no separate low-resolution copy to make. Empty when the caller asked for no
   * video preview (or the upload is not served), and the still thumbnail is
   * returned as the preview instead.
   */
  private async generateThumbnailAndPreview(
    projectId: string,
    filePath: string,
    contentType: string,
    videoPreviewUrl: string,
    thumbnailPreset: ThumbnailPreset,
  ): Promise<{ previewCdnUrl: string; thumbnailUrl: string }> {
    let thumbnailUrl = ''
    let previewCdnUrl = ''

    const isVideo = contentType.startsWith('video/')
    if (contentType.startsWith('image/') || isVideo) {
      const width = THUMBNAIL_PRESET_WIDTHS[isVideo ? 'preview' : thumbnailPreset]
      const thumbnailPath = await this.renderUploadThumbnail(
        filePath,
        { width, height: null },
        isVideo,
      )
      if (!thumbnailPath) {
        throw new BadRequestException(`Failed to generate ${isVideo ? 'video' : 'image'} thumbnail`)
      }
      // uploadThumbnailAndCleanup uploads then removes the storage-mode scratch dir,
      // even if the upload throws.
      const folder = isVideo ? 'preview_videos' : 'preview_images'
      const previewRelativePath = `user_uploaded/${folder}/${path.basename(thumbnailPath)}`
      thumbnailUrl = await uploadThumbnailAndCleanup(projectId, thumbnailPath, previewRelativePath)
      previewCdnUrl = isVideo && videoPreviewUrl ? videoPreviewUrl : thumbnailUrl
    }

    return { previewCdnUrl, thumbnailUrl }
  }

  // Render the upload thumbnail into an os.tmpdir scratch file for storage upload.
  private async renderUploadThumbnail(
    filePath: string,
    size: { height: null; width: number },
    isVideo: boolean,
  ): Promise<string | undefined> {
    const res = isVideo
      ? await createThumbnailFromVideoToScratch(filePath, size)
      : await createThumbnailFromImageToScratch(filePath, size)
    return res.thumbnailPath
  }

  private resolveAttachmentCdnUrl(projectId: string, uri: string): string {
    if (isStoreUri(uri)) {
      return storeUriToUrl(uri)
    }
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return uri
    }
    // DB stores project-relative paths like "{projectId}/user_uploaded/file.png".
    // Strip known prefixes to get the path relative to the project root,
    // then reconstruct the full store address and convert to a CDN URL.
    const prefixes = [`${projectId}/`, `projects/${projectId}/`, `agent/workspace/${projectId}/`]
    let relative = uri
    for (const prefix of prefixes) {
      if (uri.startsWith(prefix)) {
        relative = uri.slice(prefix.length)
        break
      }
    }
    const storageUri = new ProjectStore(projectId).getFullPath(relative)
    return storeUriToUrl(storageUri)
  }

  private resolveThumbnailPreset(value?: string): ThumbnailPreset {
    return value === 'editor' ? 'editor' : 'preview'
  }

  private async scanUserUploadedAssetsFromDb(projectId: string): Promise<{
    assets: { mimeType: string; name: string; url: string }[]
    audioUrl: null | string
  }> {
    const assets: { mimeType: string; name: string; url: string }[] = []
    let audioUrl: null | string = null
    const dbAttachments = await this.prisma.projectAttachment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    })
    for (const att of dbAttachments) {
      const cdnUrl = this.resolveAttachmentCdnUrl(projectId, att.uri)
      const ext = att.name ? att.name.slice(att.name.lastIndexOf('.')).toLowerCase() : ''
      const mime = att.mime || getMimeType(ext)

      if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
        if (!audioUrl) {
          audioUrl = cdnUrl
        }
      } else if (
        mime.startsWith('image/') ||
        mime.startsWith('video/') ||
        IMAGE_VIDEO_EXTENSIONS.has(ext)
      ) {
        assets.push({
          mimeType: mime,
          name: att.name || '',
          url: cdnUrl,
        })
      }
    }
    return { assets, audioUrl }
  }

  /**
   * Return user-uploaded assets for a project by scanning storage directly.
   * Scans two prefixes and merges results:
   *   - `projects/{projectId}/user_uploaded/`              (legacy + story-mode uploads)
   *   - `projects/{projectId}/user-intent-planner/uploads/` (UIP uploads)
   *
   * UIP writes each file under a per-asset namespace folder
   * (`uploads/{assetId}/{filename}`) to prevent same-filename collisions; we
   * surface the basename as the display name so downstream consumers (Remix
   * attachments) see the original filename the user uploaded.
   *
   * When the storage scan returns nothing, the caller falls back to DB records
   * (ProjectAttachment).
   */
  private async scanUserUploadedAssetsFromStore(
    projectId: string,
    options: { isAudioModePromise: Promise<boolean> },
  ): Promise<{
    assets: { mimeType: string; name: string; url: string }[]
    audioUrl: null | string
  }> {
    const legacyPrefix = `${projectRootKey(projectId)}/user_uploaded/`
    const uipPrefix = `${projectRootKey(projectId)}/user-intent-planner/uploads/`

    const [legacyUris, uipUris, isAudioMode] = await Promise.all([
      listStoreUris(`${legacyPrefix}*`).catch((error) => {
        logger.warn('Failed to list user_uploaded prefix', {
          error: ensureError(error),
          prefix: legacyPrefix,
          projectId,
        })
        return [] as string[]
      }),
      // `**/*` is required: UIP files live one level deeper at
      // `uploads/{assetId}/{filename}`, and `*` in listStoreUris only matches
      // within a single path segment (see user-uploaded-snapshot.util.ts).
      listStoreUris(`${uipPrefix}**/*`).catch((error) => {
        logger.warn('Failed to list UIP uploads prefix', {
          error: ensureError(error),
          prefix: uipPrefix,
          projectId,
        })
        return [] as string[]
      }),
      // The audio-mode promise was fired off by getUserUploadedAssets so it
      // can settle in parallel with the storage listings. isAudioModeProject is
      // itself fail-soft and shouldn't reject, but guard anyway with a
      // .catch() that matches the two storage-listing entries' shape -- if it
      // ever did reject, the whole Promise.all would, the caller would
      // catch + log it as "Failed to scan storage for user-uploaded assets"
      // (the wrong attribution), and we'd be debugging a misleading log.
      options.isAudioModePromise.catch((error) => {
        logger.warn('Failed to resolve audio-mode signal', {
          error: ensureError(error),
          projectId,
        })
        return false as boolean
      }),
    ])

    const assets: { mimeType: string; name: string; url: string }[] = []
    const audioCandidates: string[] = []
    // Populated only for legacy-prefix files in audio-mode. Video containers
    // uploaded as voice-over source (e.g. projects/{projectId}/user_uploaded/clip.mp4)
    // surface here so they can back-fill audioUrl when no real
    // audio file is present.
    const videoAsAudioCandidates: string[] = []

    // Classify a file by prefix. The prefix encodes intent:
    //   - Legacy `user_uploaded/`        -> audio-source folder.
    //   - UIP    `user-intent-planner/uploads/` -> visual-attachment folder.
    // `.webm` lives in both extension sets intentionally -- see the comment on
    // AUDIO_EXTENSIONS / IMAGE_VIDEO_EXTENSIONS above.
    const classifyLegacy = (uri: string, displayName: string) => {
      const ext = path.posix.extname(displayName).toLowerCase()
      if (!ext) {
        return
      }
      const cdnUrl = storeUriToUrl(uri)
      if (AUDIO_EXTENSIONS.has(ext)) {
        audioCandidates.push(cdnUrl)
        return
      }
      if (IMAGE_VIDEO_EXTENSIONS.has(ext)) {
        const mimeType = getMimeType(ext)
        // Audio-mode override: a video container in the audio-source folder
        // is the user's voice-over source. Surface as audioUrl pre-finalize
        // so Share/Remix work before finalizeVoiceoverAudioArtifacts writes
        // story_loader/audio/voice_over.mp3.
        if (isAudioMode && mimeType.startsWith('video/')) {
          videoAsAudioCandidates.push(cdnUrl)
          return
        }
        assets.push({ mimeType, name: displayName, url: cdnUrl })
      }
    }

    const classifyUipVisual = (uri: string, displayName: string) => {
      const ext = path.posix.extname(displayName).toLowerCase()
      if (!ext) {
        return
      }
      // UIP visual prefix is exclusively for images and video references the
      // user uploaded through the chat box. Audio-extension files here are
      // either a misplaced upload or legacy state we don't surface -- the
      // frontend's audioUrl-trust contract only honours /user_uploaded/ URLs
      // anyway, so leaking a UIP-prefix URL through audioUrl would just go
      // unused. Drop silently.
      if (IMAGE_VIDEO_EXTENSIONS.has(ext)) {
        const cdnUrl = storeUriToUrl(uri)
        assets.push({ mimeType: getMimeType(ext), name: displayName, url: cdnUrl })
      }
    }

    for (const uri of legacyUris) {
      const fileName = uri.slice(legacyPrefix.length)
      if (!fileName || fileName.endsWith('/') || fileName.startsWith('.')) {
        continue
      }
      classifyLegacy(uri, fileName)
    }

    for (const uri of uipUris) {
      const relative = uri.slice(uipPrefix.length)
      if (!relative || relative.endsWith('/') || relative.startsWith('.')) {
        continue
      }
      const basename = path.posix.basename(relative)
      if (!basename || basename.startsWith('.')) {
        continue
      }
      classifyUipVisual(uri, basename)
    }

    // Two-tier pick: a real audio file always beats a video-as-audio candidate,
    // independent of storage listing order. The video-as-audio fallback fires only
    // when no real audio file exists.
    const audioUrl: null | string = audioCandidates[0] ?? videoAsAudioCandidates[0] ?? null

    return { assets, audioUrl }
  }
}
