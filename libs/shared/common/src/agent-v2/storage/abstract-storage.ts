/**
 * Abstract storage - common implementation
 * Layer 2: Abstract Base Class (internal use only)
 */

import { getKvStore } from '../../kv'
import { logger } from '../../logger'
import { isStoreUri, parseStoreUri } from '../../storage/address'
import type { WriteOptions } from '../../storage/file-store'
import { ensureError } from '../../utils/error-handler'

import type { Storage } from './storage'

/**
 * Metadata needed to detect whether a derivative (e.g. a thumbnail) is stale
 * relative to the source object it was derived from.
 */
export type StorageObjectMetadata = {
  custom: Record<string, string>
  /** Changes on every write of the file. */
  version: string
}

/**
 * Abstract storage base class
 * Implements common operations using template method pattern
 * Subclasses must implement low-level storage operations
 * Internal use only - not exported from package
 */
export abstract class AbstractStorage implements Storage {
  constructor(protected readonly projectId: string) {}

  // ========== Path Resolution Methods ==========

  abstract copyFile(sourcePath: string, destPath: string): Promise<void>

  abstract copyFileFromStorage(sourceStorage: Storage, filePath: string): Promise<void>

  abstract copyFolderFromStorage(sourceStorage: Storage, folderPath: string): Promise<void>

  async deleteFile(path: string): Promise<void> {
    const absolutePath = this.resolve(path)
    await this.deleteInternal(absolutePath)

    logger.info(`storage: Deleted file - path=${path}`)
  }

  abstract deleteFolder(folderPath: string): Promise<void>

  // ========== Abstract methods (must be implemented by subclasses) ==========

  abstract downloadFile(storagePath: string, localPath: string): Promise<void>

  abstract ensureDir(dirPath: string): Promise<string>

  async exists(path: string): Promise<boolean> {
    const absolutePath = this.resolve(path)
    return await this.existsInternal(absolutePath)
  }

  getFullPath(relativePath: string): string {
    const absolutePath = this.resolve(relativePath)
    return this.getFullPathInternal(absolutePath)
  }

  /**
   * Get version + custom metadata for staleness checks, e.g. whether a
   * derivative was extracted from the current version of its source.
   * Default: unsupported. A backend that cannot report a version makes
   * the derivative unverifiable, so callers must re-derive.
   */
  async getObjectMetadata(_path: string): Promise<StorageObjectMetadata | undefined> {
    return undefined
  }

  /**
   * Get project root path
   * Implemented by concrete classes to allow different root paths for storage vs Local
   */
  abstract getProjectRoot(): string

  async getSize(path: string): Promise<number> {
    const absolutePath = this.resolve(path)
    return await this.getSizeInternal(absolutePath)
  }

  // ========== Public interface (implemented using template method pattern) ==========

  getWipPath(relativePath: string): string {
    return `wip/${relativePath}`
  }

  async listFiles(
    prefix: string,
    options?: {
      extension?: string | string[]
      filter?: (filepath: string) => boolean
    },
  ): Promise<string[]> {
    const absolutePrefix = this.resolve(prefix)
    let files = await this.listInternal(absolutePrefix)

    // Apply extension filter
    if (options?.extension) {
      const extensions = Array.isArray(options.extension) ? options.extension : [options.extension]

      // Normalize extensions (ensure they start with '.')
      const normalizedExtensions = extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))

      files = files.filter((file) =>
        normalizedExtensions.some((ext) => file.toLowerCase().endsWith(ext.toLowerCase())),
      )
    }

    // Apply custom filter
    if (options?.filter) {
      files = files.filter(options.filter)
    }

    return files
  }

  async moveFile(sourcePath: string, destPath: string): Promise<void> {
    await this.copyFile(sourcePath, destPath)
    await this.deleteFile(sourcePath)
    logger.info(`storage: Moved file - from=${sourcePath} to=${destPath}`)
  }

  async readdir(dirPath: string): Promise<{
    directories: string[]
    files: string[]
  }> {
    const absoluteDir = this.resolve(dirPath)
    return await this.readdirInternal(absoluteDir)
  }

  async readFile(path: string): Promise<Buffer> {
    const absolutePath = this.resolve(path)
    return await this.readInternal(absolutePath)
  }

  async readJsonFile<T>(path: string): Promise<T> {
    const text = await this.readTextFile(path)
    return JSON.parse(text) as T
  }

  async readTextFile(path: string): Promise<string> {
    const buffer = await this.readFile(path)
    return buffer.toString('utf8')
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    await this.moveFile(oldPath, newPath)
    logger.info(`storage: Renamed file - from=${oldPath} to=${newPath}`)
  }

  abstract uploadFile(
    localPath: string,
    storagePath: string,
    uploadOptions?: Partial<WriteOptions>,
  ): Promise<string>

  async writeFile(path: string, content: Buffer | string): Promise<string> {
    const absolutePath = this.resolve(path)
    await this.writeInternal(absolutePath, content)

    logger.debug(`storage.writeFile - path=${path}`)
    return absolutePath
  }

  async writeFileSafe(
    path: string,
    content: Buffer | string,
    options?: {
      lockTimeout?: number
      retryInterval?: number
      waitTimeout?: number
    },
  ): Promise<string> {
    const lockTimeout = options?.lockTimeout ?? 30
    const waitTimeout = options?.waitTimeout ?? 10000 // 10s in ms
    const retryInterval = options?.retryInterval ?? 1000 // 1s in ms

    const lockKey = `storage:lock:${this.projectId}:${path}`
    const lockValue = `${Date.now()}:${Math.random()}`
    const startTime = Date.now()

    // Try to acquire lock with retry
    while (Date.now() - startTime < waitTimeout) {
      const acquired = await this.tryAcquireLock(lockKey, lockValue, lockTimeout)

      if (acquired) {
        try {
          // Lock acquired, write file
          const absolutePath = this.resolve(path)
          await this.writeInternal(absolutePath, content)

          logger.debug(`storage.writeFileSafe - path=${path}`)

          return absolutePath
        } finally {
          // Always release lock
          await this.releaseLock(lockKey, lockValue)
        }
      }

      // Lock not acquired, wait and retry
      await this.sleep(retryInterval)
    }

    // Timeout waiting for lock
    throw new Error(
      `Failed to acquire lock for ${path} after ${waitTimeout}ms - file may be locked by another process`,
    )
  }

  async writeJsonFile<T>(path: string, data: T): Promise<string> {
    const content = JSON.stringify(data, null, 2)
    return await this.writeFile(path, content)
  }

  async writeJsonFileSafe<T>(
    path: string,
    data: T,
    options?: {
      lockTimeout?: number
      retryInterval?: number
      waitTimeout?: number
    },
  ): Promise<string> {
    const content = JSON.stringify(data, null, 2)
    return await this.writeFileSafe(path, content, options)
  }

  /**
   * Write JSON file under a write lock with an update function (safe for concurrent access)
   * Automatically acquires lock, reads current data, applies update function, writes, and releases lock
   * @param path - Relative path
   * @param updateFn - Function to update the data (receives current data, returns updated data)
   * @param options - Lock options
   * @returns Absolute path of written file
   */
  async writeJsonFileSafeWithUpdate<T>(
    path: string,
    updateFn: (current: T) => Promise<T> | T,
    options?: {
      /**
       * Lock timeout (how long to hold the lock), default 30s
       */
      lockTimeout?: number
      /**
       * Retry interval when waiting for lock, default 1s
       */
      retryInterval?: number
      /**
       * Wait timeout (how long to wait for lock), default 10s
       */
      waitTimeout?: number
    },
  ): Promise<string> {
    const lockTimeout = options?.lockTimeout ?? 30
    const waitTimeout = options?.waitTimeout ?? 10000 // 10s in ms
    const retryInterval = options?.retryInterval ?? 1000 // 1s in ms

    const lockKey = `storage:lock:${this.projectId}:${path}`
    const lockValue = `${Date.now()}:${Math.random()}`
    const startTime = Date.now()

    // Try to acquire lock with retry
    while (Date.now() - startTime < waitTimeout) {
      const acquired = await this.tryAcquireLock(lockKey, lockValue, lockTimeout)

      if (acquired) {
        try {
          // Lock acquired, read current data
          const absolutePath = this.resolve(path)
          const currentData = await this.readJsonFile<T>(path)

          // Apply update function
          const updatedData = await updateFn(currentData)

          // Write updated data
          await this.writeInternal(absolutePath, JSON.stringify(updatedData, null, 2))

          logger.debug(`storage: Wrote JSON file safely with update - path=${path}`)

          return absolutePath
        } finally {
          // Always release lock
          await this.releaseLock(lockKey, lockValue)
        }
      }

      // Lock not acquired, wait and retry
      await this.sleep(retryInterval)
    }

    // Timeout waiting for lock
    throw new Error(
      `Failed to acquire lock for ${path} after ${waitTimeout}ms - file may be locked by another process`,
    )
  }

  /**
   * Delete file from storage (low-level operation)
   */
  protected abstract deleteInternal(absolutePath: string): Promise<void>

  /**
   * Check if file exists in storage (low-level operation)
   */
  protected abstract existsInternal(absolutePath: string): Promise<boolean>

  /**
   * Get full path of absolute path within storage (low-level operation)
   */
  protected abstract getFullPathInternal(absolutePath: string): string

  /**
   * Get file size in bytes (low-level operation)
   */
  protected abstract getSizeInternal(absolutePath: string): Promise<number>

  /**
   * List files with prefix (low-level operation)
   */
  protected abstract listInternal(prefix: string): Promise<string[]>

  /**
   * Read directory (low-level operation)
   * Returns immediate child file names and directory names
   */
  protected abstract readdirInternal(absoluteDir: string): Promise<{
    directories: string[]
    files: string[]
  }>

  /**
   * Read file from storage (low-level operation)
   */
  protected abstract readInternal(absolutePath: string): Promise<Buffer>

  /**
   * Resolve relative path to absolute path within project.
   *
   * An absolute `store://<key>` address is passed through as its key, already
   * absolute within the stored files. Required for cross-subtree reads (e.g.
   * brand-extracted assets staged at `projects/<sid>/brand-extract/...` but read via a
   * storage helper rooted at `projects/<sid>/user-intent-planner/`). Without this
   * branch, the project root is prefixed in front of `store://...`, producing a
   * doubled path that 404s.
   *
   * @param relativePath - Relative path, or absolute `store://...` address
   */
  protected resolve(relativePath: string): string {
    if (isStoreUri(relativePath)) {
      return parseStoreUri(relativePath)
    }
    const projectRoot = this.getProjectRoot()
    return `${projectRoot}/${this.normalizePath(relativePath)}`
  }

  /**
   * Write file to storage (low-level operation)
   */
  protected abstract writeInternal(absolutePath: string, content: Buffer | string): Promise<void>

  /**
   * Normalize path by removing leading/trailing slashes
   * @param path - Path to normalize
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '')
  }

  // ========== File Transfer Operations ==========

  /**
   * Release the write lock, only if we still hold it (compare-and-delete in one
   * synchronous step, so a lock that expired and was re-taken is left alone).
   */
  private async releaseLock(key: string, value: string): Promise<void> {
    try {
      const kv = getKvStore()
      if (kv.get(key) === value) {
        kv.del(key)
      }
    } catch (error) {
      logger.error(
        { error },
        `storage: Failed to release lock - error=${ensureError(error).message}`,
      )
      // Ignore release errors (lock will expire anyway)
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Try to acquire the write lock
   */
  private async tryAcquireLock(
    key: string,
    value: string,
    timeoutSeconds: number,
  ): Promise<boolean> {
    try {
      // Set only if absent, so one writer holds the lock at a time
      return getKvStore().setNX(key, value, timeoutSeconds)
    } catch (error) {
      logger.error(
        { error },
        `storage: Failed to acquire lock - error=${ensureError(error).message}`,
      )
      // On error, proceed without lock (fail-safe)
      return true
    }
  }
}
