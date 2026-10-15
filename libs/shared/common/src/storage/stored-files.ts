import { logger } from '../logger'

import {
  isStoreUri,
  storedFileKey,
  storeKeyToUrl,
  storeUri,
  storeUriToUrl,
  urlToStoreUri,
  type StoreUri,
} from './address'
import { fileStore, isVersionConflictError, storeKey, type WriteOptions } from './file-store'
import { PUBLIC_CDN_BASE_URL, PUBLIC_STORE_PREFIX } from './public-assets'

/**
 * Helpers over the file store for code that holds `store://` addresses. Every
 * function takes an address (or, where it says so, a key) and reads or writes the
 * stored file through `fileStore`, so every path goes through the one containment
 * check in `filePath`.
 */

export { isVersionConflictError, storedFileKey, type WriteOptions }
export { filePath, fileStore } from './file-store'

/**
 * Shared read-only assets (icons, caption fonts, effect templates). Point
 * PUBLIC_ASSETS_URL at your own copy to serve them from elsewhere.
 */
export { PUBLIC_CDN_BASE_URL }

export interface DownloadRetryOptions {
  maxDelayMs?: number
  maxRetries?: number
  timeoutMs?: number
}

/** Whether a stored file exists. */
export async function storedFileExists(uri: string): Promise<boolean> {
  return fileStore.file(uri).exists()
}

/** Size in bytes of a stored file; 0 when it does not exist. */
export async function storedFileSize(uri: string): Promise<number> {
  const file = fileStore.file(uri)
  return (await file.exists()) ? (await file.stat()).size : 0
}

/**
 * The version of a stored file (it changes on every write), or null when it does
 * not exist or cannot be read. Used to tell a fresh upload from the last one.
 */
export async function storedFileVersion(uri: string): Promise<null | string> {
  try {
    const file = fileStore.file(uri)
    return (await file.exists()) ? (await file.stat()).version : null
  } catch {
    return null
  }
}

/**
 * The version plus caller-defined metadata of a stored file, or null when it
 * does not exist. Unlike its neighbours this does NOT swallow other errors:
 * callers use it to decide whether a derivative is stale, and reporting a read
 * failure as "no metadata" would let them overwrite good derivatives.
 */
export async function storedFileMetadata(
  uri: string,
): Promise<null | { custom: Record<string, string>; version: string }> {
  try {
    const { custom, version } = await fileStore.file(uri).stat()
    return { custom, version }
  } catch (error) {
    if ((error as { code?: unknown }).code === 404) return null
    throw error
  }
}

/** Copies a stored file. `metadata` replaces the copy's caller-defined fields. */
export async function copyStoredFile(
  sourceUri: string,
  destinationUri: string,
  options?: { metadata?: Record<string, string> },
): Promise<void> {
  const target = await fileStore.file(sourceUri).copyTo(destinationUri)
  if (options?.metadata) await target.setMetadata({ metadata: options.metadata })
}

/** Copies every stored file under one folder to the same place under another. */
export async function copyStoredFolder(
  sourceUri: string,
  destinationUri: string,
  options?: { concurrency?: number },
): Promise<{ copiedCount: number }> {
  const srcPrefix = `${storeKey(sourceUri).replace(/\/+$/, '')}/`
  const dstPrefix = `${storeKey(destinationUri).replace(/\/+$/, '')}/`
  const { files } = await fileStore.list(srcPrefix)
  const concurrency = options?.concurrency ?? 50
  let copiedCount = 0
  for (let i = 0; i < files.length; i += concurrency) {
    await Promise.all(
      files.slice(i, i + concurrency).map(async (file) => {
        const relativePath = file.key.slice(srcPrefix.length)
        if (!relativePath) return
        await file.copyTo(dstPrefix + relativePath)
        copiedCount++
      }),
    )
  }
  logger.info(
    `[copyStoredFolder] Copied ${copiedCount} files from ${sourceUri} to ${destinationUri}`,
  )
  return { copiedCount }
}

/** Deletes every stored file under a folder. */
export async function deleteStoredFolder(uri: string): Promise<void> {
  await fileStore.deletePrefix(`${storeKey(uri).replace(/\/+$/, '')}/`)
}

/** Deletes a stored file; a missing one is not an error. */
export async function deleteStoredFile(uri: string): Promise<void> {
  await fileStore.file(uri).delete({ ignoreNotFound: true })
}

/** Copies a stored file to a local path. */
export async function downloadStoredFile(uri: string, localPath: string): Promise<void> {
  await fileStore.file(uri).readTo(localPath)
}

/**
 * Copies a stored file to a local path and returns the version the bytes were
 * read at, for a later write guarded with `ifVersionMatch`. The version is read
 * BEFORE the bytes on purpose: if a write lands between the two, the version is
 * stale and the guarded write fails (a safe retry); reading it after could pair a
 * NEW version with OLD bytes and let a stale composition overwrite a fresher file.
 */
export async function downloadStoredFileWithVersion(
  uri: string,
  localPath: string,
): Promise<string> {
  const file = fileStore.file(uri)
  const { version } = await file.stat()
  await file.readTo(localPath)
  return version
}

export async function downloadStoredFileWithRetry(
  uri: string,
  localPath: string,
  options: DownloadRetryOptions = {},
): Promise<void> {
  const { maxRetries = 3, timeoutMs = 15000, maxDelayMs = 5000 } = options
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Download attempt ${attempt}/${maxRetries} for ${uri}`)
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Download timeout after ${timeoutMs}ms (attempt ${attempt})`)),
          timeoutMs,
        ),
      )
      await Promise.race([downloadStoredFile(uri, localPath), timeout])
      logger.info(`Download successful on attempt ${attempt}`)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      logger.warn(`Download attempt ${attempt} failed: ${lastError.message}`)
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), maxDelayMs)
        logger.info(`Retrying in ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw new Error(
    `Failed to download after ${maxRetries} attempts. Last error: ${lastError?.message}`,
  )
}

/**
 * A URL a browser may PUT a file to, for `keyOrUri` (a key, or a `store://`
 * address). Expires after `expiresInMs` (15 minutes by default).
 */
export async function generateUploadSignedUrl(
  keyOrUri: string,
  _contentType: string,
  expiresInMs: number = 15 * 60 * 1000,
): Promise<{ expiresAt: string; signedUrl: string }> {
  return fileStore.file(keyOrUri).signedUploadUrl(expiresInMs)
}

/**
 * The served URL of a stored file, from its address or its key
 * (e.g. `voice-over/previews/preview-x.mp3`). An http(s) URL is returned as is.
 */
export function storedFileUrl(keyOrUri: string): string
export function storedFileUrl(keyOrUri: string | undefined): string | undefined
export function storedFileUrl(keyOrUri: string | undefined): string | undefined {
  if (!keyOrUri) return undefined
  if (/^https?:\/\//.test(keyOrUri)) return keyOrUri
  return isStoreUri(keyOrUri) ? storeUriToUrl(keyOrUri) : storeKeyToUrl(keyOrUri)
}

/**
 * Generate the URL of a shared read-only asset
 * @param path - The path relative to the public assets (e.g., 'agent/images/logo.png')
 * @returns The URL (e.g., '/static/agent/images/logo.png')
 */
export function getPublicCdnUrl(path: string): string {
  return `${PUBLIC_CDN_BASE_URL}/${path}`
}

/** The address of a shared read-only asset kept under the stored `public/` folder. */
export function getPublicStoreUri(path: string): string {
  return `${PUBLIC_STORE_PREFIX}/${path}`
}

/**
 * The address of a stored file from its address, its served URL or its key.
 * Undefined for an empty value or a URL this app does not serve.
 */
export function toStoreUri(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (isStoreUri(value)) return value
  if (/^https?:\/\//.test(value)) return urlToStoreUri(value)
  return storeUri(value)
}

/**
 * Key prefix of a project's files: `projects/<projectId>`, the ONE project folder.
 *
 * It took over two older prefixes. The agent's project root was a top-level `ao` folder, and
 * hosted-era uploads were read from `projects/<projectId>/user_uploaded/`. The only
 * sub-path both had is `user_uploaded/`, which meant the same thing in each (the
 * project's uploads), so they are one folder now and nothing needs telling apart. Every
 * child of `projects/` is a project id: anything that is not a project's file lives
 * elsewhere (the brand library at `brand-library/<orgId>/<briefId>/`, uploads in flight
 * at `tmp/<userId>/`, renders at `agent/workspace/<projectId>/`).
 */
export function projectRootKey(projectId: string): string {
  return `projects/${projectId}`
}

/** The address of a file in a project's folder (`projects/<projectId>/...`). */
export function projectUri(projectId: string, ...args: string[]): StoreUri {
  return storeUri([projectRootKey(projectId), ...args].join('/'))
}

/** The address of a file in a project's render workspace (`agent/workspace/<projectId>/...`). */
export function workspaceUri(projectId: string, ...args: string[]): StoreUri {
  return storeUri(['agent/workspace', projectId, ...args].join('/'))
}

/** The served URL of a file in a project's render workspace. */
export function workspaceUrl(projectId: string, ...args: string[]): string {
  return storeUriToUrl(workspaceUri(projectId, ...args))
}

/**
 * The delivered-video keys for a project, HIGHEST PRIORITY FIRST. Exactly ONE of
 * these counts as the project's size: a 4K export supersedes the 1080p delivery,
 * and the project folder supersedes the render workspace.
 *
 * Probing these keys instead of listing the project folders keeps a re-measure
 * cheap, but a delivery published at a NEW path is silently uncounted. Whenever a
 * delivery path is added or moved, update this list.
 */
export function projectDeliverableObjectKeys(projectId: string): string[] {
  return [
    `${projectRootKey(projectId)}/final_video_4k.mp4`,
    `agent/workspace/${projectId}/long_take/final_video_4k.mp4`,
    // Captions-off 4K from older exports, which have no captioned twin.
    `agent/workspace/${projectId}/long_take/final_video_4k_nocaption.mp4`,
    `${projectRootKey(projectId)}/final_video.mp4`,
    `agent/workspace/${projectId}/final_video.mp4`,
    // DELIBERATELY ABSENT: the no-lip-sync base variant at
    // `agent/workspace/{id}/render/{videoId}/video.mp4`. It is a render output
    // that nothing copies to a durable path, so it is not counted.
  ]
}

/**
 * Bytes of the project's ONE delivered video, NOT its working files. 0 when the
 * project has never produced a delivery. Any error other than a missing file
 * propagates, so a caller never mistakes a read failure for an empty project.
 */
export async function measureProjectDeliverableBytes(projectId: string): Promise<bigint> {
  const sizes = await Promise.all(
    projectDeliverableObjectKeys(projectId).map(async (key) => {
      try {
        return BigInt((await fileStore.file(key).stat()).size)
      } catch (error) {
        if ((error as { code?: unknown }).code === 404) return null
        throw error
      }
    }),
  )
  return sizes.find((size) => size !== null) ?? 0n
}

/**
 * Addresses of stored files whose key matches a pattern (`*` and `?` within a path
 * segment, `**` across segments), e.g. `projects/p1/user_uploaded/*`.
 */
export async function listStoreUris(keyPattern: string): Promise<string[]> {
  const { prefix, regex } = buildPrefixAndRegex(keyPattern)
  const { files } = await fileStore.list(prefix)
  return files.filter((file) => regex.test(file.key)).map((file) => file.uri)
}

/** Reads a stored file into memory. */
export async function readStoredFile(uri: string): Promise<Buffer> {
  return fileStore.file(uri).read()
}

/** Writes a Buffer to a stored file. */
export async function uploadBufferToStore(
  buffer: Buffer,
  uri: string,
  options?: WriteOptions,
): Promise<void> {
  await fileStore.file(uri).write(buffer, options)
}

/** Copies a local file into the store. */
export async function uploadToStore(
  localPath: string,
  uri: string,
  options?: WriteOptions,
): Promise<void> {
  await fileStore.upload(localPath, uri, options)
}

/** Stores a local file in a project's render workspace; returns its address. */
export async function uploadWorkspaceFile(
  projectId: string,
  localPath: string,
  relativePath: string,
  options?: WriteOptions,
): Promise<StoreUri> {
  const uri = workspaceUri(projectId, relativePath)
  await uploadToStore(localPath, uri, options)
  return uri
}

// The address helpers, for callers that only deal in stored files.
export {
  InvalidStoreUriError,
  isStoreUri,
  keyIsUnder,
  parseStoreUri,
  storeKeyOf,
  storeUri,
  storeUriToUrl,
  urlToStoreUri,
} from './address'

function buildPrefixAndRegex(objectPattern: string): { prefix: string; regex: RegExp } {
  // The prefix runs up to the first wildcard, trimmed to its last '/'.
  const wildcardIdx = objectPattern.search(/[*?[]/)
  let prefix = wildcardIdx === -1 ? objectPattern : objectPattern.slice(0, wildcardIdx)
  const lastSlash = prefix.lastIndexOf('/')
  if (wildcardIdx !== -1 && lastSlash !== -1) {
    prefix = prefix.slice(0, lastSlash + 1)
  }
  return { prefix, regex: globToRegExp(objectPattern) }
}

function globToRegExp(glob: string): RegExp {
  let re = glob.replace(/[.+^${}()|\\]/g, String.raw`\$&`)
  // Character classes like [a-z] are not supported; '[' is a literal.
  re = re.replace(/\[/g, String.raw`\[`).replace(/\]/g, String.raw`\]`)
  // Placeholders keep `**` and `*` from interacting; `/**/*` means "any depth".
  re = re.replace(/\/\*\*\/\*/g, '/__DOUBLESTAR_SLASH_STAR__')
  re = re.replace(/\*\*/g, '__DOUBLESTAR__')
  re = re.replace(/\*/g, '[^/]*')
  re = re.replace(/\?/g, '[^/]')
  re = re.replace(/__DOUBLESTAR_SLASH_STAR__/g, '.*')
  re = re.replace(/__DOUBLESTAR__/g, '.*')
  return new RegExp(`^${re}$`)
}
