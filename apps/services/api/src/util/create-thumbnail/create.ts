import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path, { dirname } from 'node:path'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { uploadWorkspaceFile } from '@reelmakeeasy/common/storage/stored-files'
import sharp from 'sharp'

import { getFfmpeg } from '../ffmpeg'

// Image formats sharp can decode from its bundled libvips (rsvg, libheif,
// libaom, libtiff, libwebp, libpng, mozjpeg, cgif). Anything outside this
// set falls back to ffmpeg.
const SHARP_DECODABLE_EXTS = new Set([
  '.avif',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
])

export type ThumbnailSize = {
  height: null | number
  keepAspectRatio?: boolean
  width: null | number
}

// Derive the project id and project-relative `_thumbnail/...` key from a
// source path shaped like the old agents_workspace layout, so a thumbnail generated
// in os.tmpdir can be uploaded to storage at the exact key the removed NFS write used to target.
// Returns null when srcPath is not shaped that way (nothing to route).
function resolveThumbnailStoreTarget(
  srcPath: string,
  ext: 'jpg' | 'png' = 'jpg',
): null | { projectId: string; relativeKey: string } {
  const prefix = 'tmp/agents_workspace'
  if (!srcPath || !srcPath.includes(prefix)) {
    return null
  }
  const index = srcPath.indexOf(prefix)
  let subPath = srcPath.slice(index + prefix.length + 1)
  const projectId = subPath.split('/')[0]
  if (!projectId) {
    return null
  }
  subPath = subPath.slice(projectId.length + 1)
  return { projectId, relativeKey: path.posix.join('_thumbnail', `${subPath}.${ext}`) }
}

// Generate the thumbnail into an os.tmpdir scratch file.
async function makeScratchThumbnailPath(srcPath: string, ext: 'jpg' | 'png'): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'thumbnail-'))
  return path.join(tmpDir, `${path.basename(srcPath)}.${ext}`)
}

// Remove the os.tmpdir scratch dir backing a storage-mode thumbnail once the
// caller has finished reading/uploading it. This was a no-op in the legacy NFS mode:
// there the path lived in the persistent `_thumbnail` cache, so the guards below
// (must sit under os.tmpdir and be a `thumbnail-*` mkdtemp dir) rejected it and the
// cache was never touched.
export async function cleanupThumbnailScratch(thumbnailPath: string | undefined): Promise<void> {
  if (!thumbnailPath) {
    return
  }
  const scratchDir = path.dirname(thumbnailPath)
  const tmpRoot = os.tmpdir()
  const withinTmp = scratchDir === tmpRoot || scratchDir.startsWith(tmpRoot + path.sep)
  if (!withinTmp || !path.basename(scratchDir).startsWith('thumbnail-')) {
    return
  }
  await rm(scratchDir, { force: true, recursive: true }).catch((error) => {
    logger.warn(ensureError(error), 'Failed to clean up thumbnail scratch dir')
  })
}

// Upload a freshly generated thumbnail to storage and then drop its storage-mode scratch
// dir, even if the upload throws. Returns the URL.
export async function uploadThumbnailAndCleanup(
  projectId: string,
  thumbnailPath: string,
  relativePath: string,
): Promise<string> {
  try {
    return await uploadWorkspaceFile(projectId, thumbnailPath, relativePath)
  } finally {
    await cleanupThumbnailScratch(thumbnailPath)
  }
}

const VideoThumbnailSize: ThumbnailSize = {
  height: null,
  keepAspectRatio: true,
  width: 360,
}
export async function createThumbnailFromImage(
  imagePath: string,
  outputSize: ThumbnailSize = VideoThumbnailSize,
) {
  // Always render into an os.tmpdir scratch file, even when the source
  // path is not workspace-shaped (e.g. a freshly uploaded `tmp/upload-*` file) -- the
  // caller then uploads and cleans it up. The internal storage upload below stays gated on
  // storeTarget, which is only resolvable for the agents_workspace callers.
  const storeTarget = resolveThumbnailStoreTarget(imagePath, 'jpg')
  const thumbnailPath = await makeScratchThumbnailPath(imagePath, 'jpg')

  try {
    const rendered = await rasterizeImageToPath(imagePath, thumbnailPath, outputSize)
    if (!rendered) {
      // The scratch file is never handed to the caller on this path, so clean it up.
      await cleanupThumbnailScratch(thumbnailPath)
      return {}
    }
    if (storeTarget) {
      const storage = await createStorage(storeTarget.projectId)
      await storage.uploadFile(thumbnailPath, storeTarget.relativeKey)
    }
    return { thumbnailPath }
  } catch (error) {
    // Match createThumbnailFromImageToScratch: never throw to the caller; a failed
    // thumbnail returns {} and the partial scratch/render file is cleaned up.
    logger.error({ error: ensureError(error) }, 'createThumbnailFromImage error')
    await cleanupThumbnailScratch(thumbnailPath)
    return {}
  }
}

// Rasterize an image thumbnail into an os.tmpdir scratch file only, with
// no `agents_workspace` path shaping and no auto-upload to storage -- the image
// counterpart of createThumbnailFromVideoToScratch. The caller uploads the
// returned file via the storage abstraction and then calls cleanupThumbnailScratch.
// Used by API post-processing (no JobContext) where createThumbnailFromImage
// would otherwise fall back to a cwd-relative path.
export async function createThumbnailFromImageToScratch(
  imagePath: string,
  outputSize: ThumbnailSize = VideoThumbnailSize,
): Promise<Record<string, never> | { thumbnailPath: string }> {
  let thumbnailPath: string | undefined
  try {
    thumbnailPath = await makeScratchThumbnailPath(imagePath, 'jpg')
    logger.info(`createThumbnailFromImageToScratch: "${imagePath}" -> "${thumbnailPath}"`)
    const rendered = await rasterizeImageToPath(imagePath, thumbnailPath, outputSize)
    if (!rendered) {
      await cleanupThumbnailScratch(thumbnailPath)
      return {}
    }
    return { thumbnailPath }
  } catch (error) {
    logger.error({ error: ensureError(error) }, 'createThumbnailFromImageToScratch error')
    if (thumbnailPath) {
      await cleanupThumbnailScratch(thumbnailPath)
    }
    return {}
  }
}

// Rasterize `imagePath` into `thumbnailPath` (the directory is created first).
// Sharp is preferred for stills: it handles SVG / HEIC / AVIF / TIFF (which our
// ffmpeg build can't rasterize) and is faster on the formats both support. Falls
// back to ffmpeg for anything sharp doesn't decode (BMP) or if sharp errors out.
// Returns true on success, false when both backends fail.
function ffmpegSizeArg(outputSize: ThumbnailSize): string {
  if (outputSize.width && outputSize.height) {
    return `${outputSize.width}x${outputSize.height}`
  }
  if (outputSize.width) {
    return `${outputSize.width}x?`
  }
  if (outputSize.height) {
    return `?x${outputSize.height}`
  }
  return ''
}

async function rasterizeImageToPath(
  imagePath: string,
  thumbnailPath: string,
  outputSize: ThumbnailSize,
): Promise<boolean> {
  await mkdir(dirname(thumbnailPath), { recursive: true })
  const ext = path.extname(imagePath).toLowerCase()

  if (SHARP_DECODABLE_EXTS.has(ext)) {
    try {
      logger.info(`createThumbnailFromImage(sharp): "${imagePath}" -> "${thumbnailPath}"`)
      await rasterizeImageWithSharp(imagePath, thumbnailPath, outputSize)
      return true
    } catch (error) {
      logger.warn(
        { error: ensureError(error), imagePath },
        'sharp thumbnail failed; falling back to ffmpeg',
      )
    }
  }

  try {
    logger.info(`createThumbnailFromImage(ffmpeg): "${imagePath}" -> "${thumbnailPath}"`)
    await rasterizeImageWithFfmpeg(imagePath, thumbnailPath, outputSize)
    return true
  } catch (error) {
    logger.error({ error: ensureError(error) }, '❌ createThumbnailFromImage error')
    return false
  }
}

function rasterizeImageWithFfmpeg(
  imagePath: string,
  thumbnailPath: string,
  outputSize: ThumbnailSize,
): Promise<void> {
  const sizeStr = ffmpegSizeArg(outputSize)
  return new Promise((resolve, reject) => {
    getFfmpeg()
      .input(imagePath)
      .outputOption('-q:v', '2')
      .size(sizeStr)
      .output(thumbnailPath)
      .on('end', () => resolve())
      .on('error', function (err, stdout, stderr) {
        logger.info(`stdout: ${stdout}`)
        logger.info(`stderr: ${stderr}`)
        if (err) {
          logger.info(`Cannot process image: ${err.message}`)
          return reject(err)
        }
        resolve()
      })
      .run()
  })
}

async function rasterizeImageWithSharp(
  imagePath: string,
  thumbnailPath: string,
  outputSize: ThumbnailSize,
): Promise<void> {
  // density=144 makes SVGs render crisp at small thumbnail widths without
  // ballooning memory; failOn:'none' lets minor decoder warnings (common in
  // phone-camera HEIC) pass through instead of throwing.
  // .rotate() with no arg auto-applies EXIF orientation, so portrait phone
  // photos aren't rendered sideways. Must come before resize/flatten.
  let pipeline = sharp(imagePath, { density: 144, failOn: 'none' }).rotate()
  if (outputSize.width || outputSize.height) {
    // ffmpeg's `size('WxH')` forces exact dimensions when both are given;
    // mirror that so the two backends agree. When only one dimension is
    // supplied, or keepAspectRatio is explicit, sharp's 'inside' keeps the
    // aspect ratio.
    const preserveAspect = outputSize.keepAspectRatio ?? !(outputSize.width && outputSize.height)
    pipeline = pipeline.resize({
      width: outputSize.width ?? undefined,
      height: outputSize.height ?? undefined,
      fit: preserveAspect ? 'inside' : 'fill',
      withoutEnlargement: false,
    })
  }
  // Flatten alpha to white so SVG/PNG transparency doesn't render as black in JPEG.
  await pipeline
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(thumbnailPath)
}
/**
 * Generate a full-resolution thumbnail from a video at a specific timestamp.
 * Unlike createThumbnailFromVideo, this does NOT resize the output - the
 * thumbnail preserves the video's native dimensions. Use this for demo projects
 * where quality matters.
 *
 * @param videoPath  - Absolute local path to the source video file
 * @param outputPath - Absolute local path where the JPEG thumbnail will be written
 */
export async function createFullResThumbnailFromVideo(
  videoPath: string,
  outputPath: string,
): Promise<Record<string, never> | { thumbnailPath: string }> {
  try {
    logger.info(`createFullResThumbnailFromVideo: "${videoPath}" -> "${outputPath}"`)
    await mkdir(dirname(outputPath), { recursive: true })
    await new Promise((resolve, reject) => {
      getFfmpeg()
        .input(videoPath)
        .seek(0.01)
        .frames(1)
        .outputOption('-q:v', '2')
        .output(outputPath)
        .on('end', resolve)
        .on('error', function (err, stdout, stderr) {
          logger.info(`stdout: ${stdout}`)
          logger.info(`stderr: ${stderr}`)
          if (err) {
            logger.info(`Cannot process video: ${err.message}`)
            return reject(err)
          }
          resolve(0)
        })
        .run()
    })
    return { thumbnailPath: outputPath }
  } catch (error) {
    logger.error({ error: ensureError(error) }, '❌ createFullResThumbnailFromVideo error')
    return {}
  }
}

function videoThumbnailSizeArg(outputSize: ThumbnailSize): string {
  if (outputSize.width && outputSize.height) {
    // Both width and height specified - resize to exact dimensions
    return `${outputSize.width}x${outputSize.height}`
  }
  if (outputSize.width && !outputSize.height) {
    // Only width specified - keep aspect ratio and resize to width
    return `${outputSize.width}x?`
  }
  if (!outputSize.width && outputSize.height) {
    // Only height specified - keep aspect ratio and resize to height
    return `?x${outputSize.height}`
  }
  return ''
}

// Extract a single frame from the video into thumbnailPath. The caller owns the
// destination path (os.tmpdir scratch, ...) and any storage upload.
export async function createThumbnailFromVideo(
  videoPath: string,
  outputSize: ThumbnailSize = VideoThumbnailSize,
) {
  // Always render into an os.tmpdir scratch file, even when the source
  // path is not workspace-shaped (e.g. a freshly uploaded `tmp/upload-*` file) -- the
  // caller then uploads and cleans it up. The internal storage upload below stays gated on
  // storeTarget, which is only resolvable for the agents_workspace callers.
  const storeTarget = resolveThumbnailStoreTarget(videoPath, 'jpg')
  const thumbnailPath = await makeScratchThumbnailPath(videoPath, 'jpg')

  try {
    logger.info(`createThumbnailFromVideo: "${videoPath}" -> "${thumbnailPath}"`)
    await runVideoThumbnailFfmpeg(videoPath, thumbnailPath, outputSize)
    if (storeTarget) {
      const storage = await createStorage(storeTarget.projectId)
      await storage.uploadFile(thumbnailPath, storeTarget.relativeKey)
    }
    return {
      thumbnailPath,
    }
  } catch (error) {
    logger.error({ error: ensureError(error) }, '❌ createThumbnailFromVideo error')
    // The scratch file is never handed to the caller on this path, so clean it up.
    await cleanupThumbnailScratch(thumbnailPath)
    return {}
  }
}

async function runVideoThumbnailFfmpeg(
  videoPath: string,
  thumbnailPath: string,
  outputSize: ThumbnailSize,
): Promise<void> {
  const sizeStr = videoThumbnailSizeArg(outputSize)
  await mkdir(dirname(thumbnailPath), { recursive: true })
  await new Promise((resolve, reject) => {
    getFfmpeg()
      .input(videoPath)
      .seek(0)
      .frames(1)
      .outputOption('-q:v', '2')
      .size(sizeStr)
      .output(thumbnailPath)
      .on('end', resolve)
      .on('error', function (err, stdout, stderr) {
        logger.info(`stdout: ${stdout}`)
        logger.info(`stderr: ${stderr}`)
        if (err) {
          logger.info(`Cannot process video: ${err.message}`)
          return reject(err)
        }
        resolve(0)
      })
      .run()
  })
}

// Generate a video thumbnail into an os.tmpdir scratch file only. Unlike
// createThumbnailFromVideo this never auto-uploads to storage. The caller is
// responsible for uploading the returned file via the storage abstraction and then
// calling cleanupThumbnailScratch.
export async function createThumbnailFromVideoToScratch(
  videoPath: string,
  outputSize: ThumbnailSize = VideoThumbnailSize,
): Promise<Record<string, never> | { thumbnailPath: string }> {
  let thumbnailPath: string | undefined
  try {
    thumbnailPath = await makeScratchThumbnailPath(videoPath, 'jpg')
    logger.info(`createThumbnailFromVideoToScratch: "${videoPath}" -> "${thumbnailPath}"`)
    await runVideoThumbnailFfmpeg(videoPath, thumbnailPath, outputSize)
    return { thumbnailPath }
  } catch (error) {
    logger.error({ error: ensureError(error) }, 'createThumbnailFromVideoToScratch error')
    if (thumbnailPath) {
      await cleanupThumbnailScratch(thumbnailPath)
    }
    return {}
  }
}
