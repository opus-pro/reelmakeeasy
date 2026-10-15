import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { isAgentV2 } from '@reelmakeeasy/common/constant/agent-v2'
import { getEvalSandboxId } from '@reelmakeeasy/common/job-context'
import { logger } from '@reelmakeeasy/common/logger'
import { isEval } from '@reelmakeeasy/common/utils/env'
import { storeUri, uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { getNodeLocalScratchRoot } from '@reelmakeeasy/common/utils/path.util'
import typedPathResolver from '@reelmakeeasy/common/utils/path-resolver'
import fg from 'fast-glob'
import { mergeWith, unset } from 'lodash-es'

import { DeepPartial } from '../video-crew/types/types'

import { SUB_FOLDER, SUMMARY_NAME } from './constant'
import { FileHub } from './file-hub'

export type ReferenceImagePart = {
  buffer: Buffer
  filename: string
  filePath: string
  mimeType: string
}

type RetryOptions = {
  delay?: number
  factor?: number
  retries: number
  timeoutMs?: number
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
export function getAbsolutePath(projectId: string, relativePath: null | string): string {
  // In eval environment, use sandboxId from JobContext if available (via getEvalSandboxId).
  // This ensures consistent paths with ProjectHydrator.
  // This prevents race conditions when multiple test cases from the same project run concurrently
  const subdirectory = isEval() ? getEvalSandboxId() : null

  // Per-pod scratch resolves under the node-local scratch root. The eval sandbox
  // subdirectory precedence is preserved.
  const baseRoot = getNodeLocalScratchRoot()

  if (relativePath === null) {
    return path.join(baseRoot, projectId, ...(subdirectory ? [subdirectory] : []))
  }
  const normalizedPath = path.normalize(relativePath)
  if (normalizedPath.includes('..') || path.isAbsolute(normalizedPath)) {
    throw new Error('Path must be relative and within the project directory.')
  }
  return path.join(baseRoot, projectId, ...(subdirectory ? [subdirectory] : []), normalizedPath)
}

export async function getPresetStyleImages() {
  const exts = ['png', 'jpg', 'jpeg', 'webp']
  const patterns = exts.map((ext) =>
    path.join(process.cwd(), `libs/agent/public/preset_style/*.${ext}`),
  )
  const paths = await fg(patterns)

  const styleNameList = paths.map((stylePath) => path.basename(stylePath).split('.')[0])
  const styleImages = await getReferenceImageParts(paths.slice(0, 16))
  return { styleNameList, styleImages }
}
export async function getReferenceImagePartFromFilePath(
  filePath: string,
): Promise<ReferenceImagePart | undefined> {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']
  const stats = await fs.stat(filePath)
  const filename = path.basename(filePath)
  if (stats.isFile() && imageExtensions.some((ext) => filename.toLowerCase().endsWith(ext))) {
    try {
      const imageBytes = await fs.readFile(filePath)
      const ext = path.extname(filename).toLowerCase()
      let mimeType = 'image/jpeg'
      if (ext === '.png') {
        mimeType = 'image/png'
      } else if (ext === '.jpg' || ext === '.jpeg') {
        mimeType = 'image/jpeg'
      } else if (ext === '.webp') {
        mimeType = 'image/webp'
      }
      logger.info(`      - Loaded reference image: ${filename} (${mimeType})`)
      return { buffer: imageBytes, filename, mimeType, filePath }
    } catch (error) {
      logger.info(`      ❌ Error getting user reference image part from file path: ${error}`)
      return undefined
    }
  }
  return undefined
}
export async function getReferenceImageParts(
  filePaths: string[],
): Promise<Array<ReferenceImagePart>> {
  const referenceImageParts: Array<ReferenceImagePart> = []

  try {
    for (const filePath of filePaths) {
      if (existsSync(filePath)) {
        const imagePart = await getReferenceImagePartFromFilePath(filePath)
        if (imagePart) {
          referenceImageParts.push(imagePart)
        }
      } else {
        logger.info(`      ❌ User style reference file does not exist: ${filePath}`)
      }
    }
  } catch (error) {
    logger.info(`      ❌ Error getting user reference image parts: ${error}`)
  }

  return referenceImageParts
}

/** @deprecated Use `import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'` instead */
export function getSandboxedPath({
  targetPath,
  projectId,
}: {
  projectId: string
  targetPath?: null | string
}): string {
  if (isAgentV2()) {
    // storage mode: Return relative path
    if (targetPath === null || targetPath === undefined) {
      throw new Error(
        'storage mode requires a specific target path. Project root access is not supported.',
      )
    }

    const normalizedPath = path.normalize(targetPath)

    // Check for path traversal attacks
    if (normalizedPath.includes('..')) {
      throw new Error('Path must not contain ".." for security reasons.')
    }

    // Return relative path (storage will add projects/{projectId} prefix automatically)
    return normalizedPath
  }
  // Local mode: Return absolute path (keep original logic)
  const projectWorkspacePath = typedPathResolver.getProjectPath(projectId)
  if (targetPath === null || targetPath === undefined) {
    return projectWorkspacePath
  }

  const normalizedPath = path.normalize(targetPath)

  // Check for path traversal attacks
  if (normalizedPath.includes('..')) {
    throw new Error('Path must not contain ".." for security reasons.')
  }

  // If it's an absolute path
  if (path.isAbsolute(normalizedPath)) {
    // Check if the absolute path is within the project workspace
    if (normalizedPath.startsWith(projectWorkspacePath)) {
      return normalizedPath
    }
    throw new Error('Absolute path must be within the project workspace directory.')
  }

  // Relative path - join with workspace path
  return path.join(projectWorkspacePath, targetPath)
}
export async function getStyleImages(projectId: string) {
  const paths = [
    getAbsolutePath(projectId, path.join(SUB_FOLDER.STORYBOARD, SUMMARY_NAME.PRESET_STYLE_FILE)),
  ]
  const preferredStyleDir = FileHub.preferredStyleFromLinkDir(projectId).absPath()
  if (await directoryExists(preferredStyleDir)) {
    const fileNames = await fs.readdir(preferredStyleDir)
    const preferredStylePaths = fileNames.map((fileName) => {
      return path.join(preferredStyleDir, fileName)
    })
    paths.push(...preferredStylePaths)
  }

  return await getReferenceImageParts(paths.slice(0, 16))
}
export function getWatermarkEnableFlag(
  userId: string,
  userEmail: string,
  renderDebugSettings?: Record<string, boolean>,
) {
  // Project-specific debug settings override the default when they are set
  if (renderDebugSettings?.['watermark'] !== undefined) {
    const enableWatermark = renderDebugSettings['watermark']
    logger.info(`Debug values - enableWatermark: ${enableWatermark}`)
    return enableWatermark
  }

  return false
}
export function mergeState<T>(value: T, newValue: DeepPartial<T>) {
  return mergeWith({}, value, newValue, mergeCustomizer)
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { delay = 0, factor = 1, retries, timeoutMs } = options
  let attempt = 0
  let currentDelay = delay

  while (attempt <= retries) {
    try {
      if (timeoutMs) {
        let timeoutId: NodeJS.Timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
        })
        return await Promise.race([
          fn(attempt).finally(() => clearTimeout(timeoutId)),
          timeoutPromise,
        ])
      }
      return await fn(attempt)
    } catch (error) {
      if (attempt === retries) {
        throw error
      }

      if (currentDelay > 0) {
        await new Promise((res) => setTimeout(res, currentDelay))
        currentDelay *= factor
      }

      attempt++
    }
  }

  // Will not reach here
  throw new Error('Retry failed unexpectedly')
}

export async function uploadAssetToStore(
  localFilePath: string,
  projectId: string,
  assetType: 'audio' | 'image' | 'video',
) {
  const suffix = localFilePath.split(projectId)[1]
  const remoteFilePath = `assets/${projectId}/${assetType}${suffix}`
  await uploadToStore(localFilePath, storeUri(remoteFilePath))
  return storeUri(remoteFilePath)
}

function mergeCustomizer(objValue: unknown, srcValue: unknown, key: string, object: unknown) {
  // this will transfer {a:1,b:2} to {a:1,b:undefined}
  if (srcValue === undefined) {
    unset(object, key)
    return
  }
  if (Array.isArray(objValue) || Array.isArray(srcValue)) {
    return srcValue
  }
  return undefined
}
