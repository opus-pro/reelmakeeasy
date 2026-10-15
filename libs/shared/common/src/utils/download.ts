import * as crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Mutex } from 'async-mutex'
import { move } from 'fs-extra'

import { logger } from '../logger'
import { presetFilePath, presetPackDir } from '../storage/presets'

import { ensureError } from './error-handler'
import { isPresetUri } from '../storage/address'
import { downloadStoredFile, isStoreUri } from '../storage/stored-files'

/**
 * Cache directory for downloaded resources
 */
const CACHE_DIR = './tmp/cache/download'

/**
 * Mutex map for file downloads to avoid concurrent downloads of the same resource
 */
const downloadMutexMap = new Map<string, Mutex>()

/**
 * Download a file with caching
 *
 * Priority order:
 * 1. Check cache - if exists, create symlink to target
 * 2. Download and cache - download to cache, then symlink to target
 *
 * @param uri Resource URI (store://, preset://, http://, https://, or file:// for a preset pack file)
 * @param targetPath Local target path where file should be accessible
 */
export async function download(
  uri: string,
  targetPath: string,
  options: {
    headers?: Record<string, string>
    noCache?: boolean
    retries?: number
    timeout?: number
  } = {},
): Promise<void> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })

  // A file from the installed preset pack is linked in place. Nothing else on
  // this computer is reachable this way.
  if (isPresetUri(uri)) {
    // A preset file is on this disk already (the repo's presets/ or the installed pack).
    if (await createSymlinkWithRetry(presetFilePath(uri), targetPath, 'Using preset file')) {
      return
    }
    throw new Error(`Could not link ${uri} to ${targetPath}`)
  }
  if (uri.startsWith('file://')) {
    const localPath = path.resolve(uri.slice('file://'.length))
    const packDir = path.resolve(presetPackDir())
    if (!localPath.startsWith(`${packDir}${path.sep}`)) {
      throw new Error(`Only preset pack files can be read from disk: ${localPath}`)
    }
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`)
    }
    if (await createSymlinkWithRetry(localPath, targetPath, 'Using local file')) {
      return
    }
    throw new Error(`Could not link ${localPath} to ${targetPath}`)
  }

  const { noCache, ...restOptions } = options
  const mutex = getDownloadMutex(uri)
  if (mutex.isLocked()) {
    logger.warn(`Waiting for mutex to download from ${uri} to ${targetPath}`)
  }
  const downloadToPath = async (destPath: string) => {
    if (/https?:\/\//.test(uri)) {
      await downloadHttpResource(uri, destPath, restOptions)
    } else if (isStoreUri(uri)) {
      await downloadStoredFile(uri, destPath)
    } else {
      throw new Error(`Unsupported URI scheme: ${uri}`)
    }
  }
  await mutex.runExclusive(async () => {
    if (noCache) {
      logger.info(`Cache mode disabled, downloading directly to ${targetPath}`)
      await downloadToPath(targetPath)
      logger.info(`Download complete: ${uri}`)
      return
    }

    // 1. Check cache first
    const cachePath = getCachePath(uri)
    if (fs.existsSync(cachePath)) {
      const success = await createSymlinkWithRetry(path.resolve(cachePath), targetPath, 'Cache hit')
      if (success) {
        const now = new Date()
        fs.utimesSync(cachePath, now, now)
        logger.info(`Using cached file for ${uri}`)
        return
      }
    }

    // 2. Download and cache
    logger.info(`No cache found for ${uri}, downloading...`)
    const cachePathInTransit = `${cachePath}.downloading`
    await downloadToPath(cachePathInTransit)
    await move(cachePathInTransit, cachePath, { overwrite: true })
    logger.info(`Download complete: ${uri}`)

    await createSymlinkWithRetry(path.resolve(cachePath), targetPath, 'Created symlink')
  })
}

/**
 * Download HTTP resource to local file
 * @param url Resource URL
 * @param localPath Local save path
 * @param options Download options
 */
export async function downloadHttpResource(
  url: string,
  localPath: string,
  options: {
    headers?: Record<string, string>
    retries?: number
    timeout?: number
  } = {},
): Promise<void> {
  // Ensure directory exists
  fs.mkdirSync(path.dirname(localPath), { recursive: true })

  const buffer = await fetchWithRetry(url, options)
  await fs.promises.writeFile(localPath, buffer)
}

/**
 * Download HTTP resource and convert to base64
 * @param url Resource URL
 * @param options Download options
 */
export async function downloadHttpResourceAsBase64(
  url: string,
  options: {
    headers?: Record<string, string>
    retries?: number
    timeout?: number
  } = {},
): Promise<string> {
  const buffer = await fetchWithRetry(url, options)
  return buffer.toString('base64')
}

/**
 * Download HTTP resource and return Buffer
 * @param url Resource URL
 * @param options Download options
 */
export async function downloadHttpResourceAsBuffer(
  url: string,
  options: {
    headers?: Record<string, string>
    retries?: number
    timeout?: number
  } = {},
): Promise<Buffer> {
  return fetchWithRetry(url, options)
}

/**
 * Create a symlink with EEXIST retry and fallback to copy
 */
async function createSymlinkWithRetry(
  sourcePath: string,
  targetPath: string,
  context: string,
): Promise<boolean> {
  const relativeSourcePath = path.relative(path.dirname(targetPath), sourcePath)
  try {
    const existingLink = fs.readlinkSync(targetPath)
    if (existingLink === relativeSourcePath) {
      logger.info(
        `${context}: symlink already exists and correct: ${targetPath} -> ${relativeSourcePath}`,
      )
      return true
    }
    logger.info(`${context}: removing stale symlink (${existingLink}) at ${targetPath}`)
    fs.unlinkSync(targetPath)
  } catch {
    logger.debug(
      `${context}: target (${targetPath}) doesn't exist or isn't a symlink - continue to create`,
    )
  }
  if (!fs.existsSync(sourcePath)) {
    logger.warn(`${context} symlink skipped: source file does not exist: ${sourcePath}`)
    return false
  }

  try {
    logger.info(`${context}: ${targetPath} -> ${relativeSourcePath}`)
    await fs.promises.symlink(relativeSourcePath, targetPath)
    return true
  } catch (symlinkError) {
    const error = ensureError<NodeJS.ErrnoException>(symlinkError)
    if (error.code === 'EEXIST') {
      try {
        const existingLink = fs.readlinkSync(targetPath)
        if (existingLink === relativeSourcePath) {
          logger.info(`${context}: symlink created by concurrent request: ${targetPath}`)
          return true
        }
        fs.unlinkSync(targetPath)
        await fs.promises.symlink(relativeSourcePath, targetPath)
        logger.info(`${context} (retry): ${targetPath} -> ${relativeSourcePath}`)
        return true
      } catch (e) {
        const retryError = ensureError(e)
        logger.warn(`${context} symlink retry failed: ${retryError.message} for ${targetPath}`)
      }
    } else {
      logger.warn(`${context} symlink failed: ${error.message} for ${targetPath}`)
    }

    return false
  }
}

/**
 * Core HTTP fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: {
    headers?: Record<string, string>
    retries?: number
    timeout?: number
  } = {},
): Promise<Buffer> {
  const { timeout = 30000, headers = {}, retries = 3 } = options

  const attemptFetch = async (attempt: number): Promise<Buffer> => {
    try {
      logger.info(`Downloading ${url} (attempt ${attempt})`)

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReelMakeEasy/1.0)',
          ...headers,
        },
        signal: AbortSignal.timeout(timeout),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      logger.info(`Successfully downloaded ${url}`)
      return Buffer.from(buffer)
    } catch (e) {
      const error = ensureError(e)
      if (attempt < retries) {
        logger.error(`Download attempt ${attempt} failed for ${url}: ${error}`)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)) // Exponential backoff
        return attemptFetch(attempt + 1)
      }
      throw new Error(`Failed to download ${url} after ${retries} attempts: ${error}`)
    }
  }

  return attemptFetch(1)
}

/**
 * Create a cache path for a given URI
 */
function getCachePath(uri: string): string {
  // Create a hash of the URI to create a unique cache path
  const hash = crypto.createHash('md5').update(uri).digest('hex')
  const fileName = path.basename(uri) || 'unknown'
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const cacheFileName = `${sanitizedFileName}_${hash}`
  const cachePath = path.join(CACHE_DIR, cacheFileName)

  // Ensure cache directory exists
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })

  return cachePath
}

/**
 * Get or create a mutex for a specific resource URI
 */
function getDownloadMutex(uri: string): Mutex {
  if (!downloadMutexMap.has(uri)) {
    downloadMutexMap.set(uri, new Mutex())
  }
  const mutex = downloadMutexMap.get(uri)
  if (!mutex) {
    throw new Error(`Failed to get mutex for URI: ${uri}`)
  }
  return mutex
}
