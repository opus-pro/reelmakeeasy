/**
 * Storage interface definition
 * Defines the contract that all storage implementations must follow
 */

import type { WriteOptions } from '../../storage/file-store'

import { isAgentV2 } from '../../constant/agent-v2'

import type { StorageObjectMetadata } from './abstract-storage'
import { LocalStorage } from './local-storage'
import { ProjectStore } from './project-store'

export type { StorageObjectMetadata }

/**
 * Core storage interface
 * Provides unified file operations for the file store and the test-only local storage
 */
export interface Storage {
  // ========== File Operations ==========

  /**
   * Clean up local cache directory (optional)
   * Only implemented by ProjectStore in V2 mode
   * Deletes: tmp/agents_workspace/{projectId}/{runId}/
   */
  cleanupLocalCache?(): Promise<void>

  /**
   * Copy file within storage
   * @param sourcePath - Source path (relative to project root)
   * @param destPath - Destination path (relative to project root)
   */
  copyFile(sourcePath: string, destPath: string): Promise<void>

  /**
   * Copy a single file from another storage to the same path
   * @param sourceStorage - Source storage to copy from
   * @param filePath - File path (relative to project root) to copy
   */
  copyFileFromStorage(sourceStorage: Storage, filePath: string): Promise<void>

  /**
   * Copy a directory from another storage to the same path
   * @param sourceStorage - Source storage to copy from
   * @param folderPath - Folder path (relative to project root) to copy
   */
  copyFolderFromStorage(sourceStorage: Storage, folderPath: string): Promise<void>

  /**
   * Delete file
   * @param path - Relative path (e.g., 'storyboard/scenes.json' or 'wip/my-tool-impl/file.txt')
   */
  deleteFile(path: string): Promise<void>

  /**
   * Delete a folder and all its contents
   * @param folderPath - Folder path (relative to project root) to delete
   */
  deleteFolder(folderPath: string): Promise<void>

  /**
   * Download file from storage to local
   * @param storagePath - Storage path (relative to project root)
   * @param localPath - Local file path (absolute)
   */
  downloadFile(storagePath: string, localPath: string): Promise<void>

  /**
   * Ensure directory exists (creates if not exists)
   * @param dirPath - Directory path (relative to project root)
   * @returns Absolute directory path
   */
  ensureDir(dirPath: string): Promise<string>

  /**
   * Check if file exists
   * @param path - Relative path
   */
  exists(path: string): Promise<boolean>

  /**
   * Get full path of relative path
   * @param relativePath - Path relative to project root
   * @returns Full path
   */
  getFullPath(relativePath: string): string

  /**
   * Get generation + custom metadata for staleness checks
   * @param path - Relative path
   * @returns Object metadata, or undefined if the backend can't report a generation
   */
  getObjectMetadata(path: string): Promise<StorageObjectMetadata | undefined>

  /**
   * Get project root path
   * @returns Project root ('projects/{projectId}')
   */
  getProjectRoot(): string

  /**
   * Get file size in bytes
   * @param path - Relative path
   */
  getSize(path: string): Promise<number>

  /**
   * Get WIP path (developer controls structure)
   * @param relativePath - Path relative to WIP (e.g., 'my-tool-impl/file.txt' returns 'wip/my-tool-impl/file.txt')
   * @returns WIP path
   */
  getWipPath(relativePath: string): string

  /**
   * List files with given prefix
   * @param prefix - Path prefix
   * @param options - Optional filter options
   * @returns Array of file paths
   */
  listFiles(
    prefix: string,
    options?: {
      /**
       * File extension filter (e.g., '.json', '.txt')
       * Can be a single extension or an array of extensions
       */
      extension?: string | string[]
      /**
       * Custom filter function
       * Return true to include the file
       */
      filter?: (filepath: string) => boolean
    },
  ): Promise<string[]>

  /**
   * Move file within storage (copy + delete source)
   * @param sourcePath - Source path (relative to project root)
   * @param destPath - Destination path (relative to project root)
   */
  moveFile(sourcePath: string, destPath: string): Promise<void>

  /**
   * Read directory - list immediate child files and directories
   * @param dirPath - Directory path (relative to project root)
   * @returns Object containing child file names and directory names
   */
  readdir(dirPath: string): Promise<{
    directories: string[]
    files: string[]
  }>

  /**
   * Read file as Buffer
   * @param path - Relative path
   */
  readFile(path: string): Promise<Buffer>

  /**
   * Read and parse JSON file
   * @param path - Relative path
   */
  readJsonFile<T>(path: string): Promise<T>

  /**
   * Read file as text string
   * @param path - Relative path
   */
  readTextFile(path: string): Promise<string>

  /**
   * Rename file within storage
   * @param oldPath - Current file path (relative to project root)
   * @param newPath - New file path (relative to project root)
   */
  renameFile(oldPath: string, newPath: string): Promise<void>

  /**
   * Upload local file to storage
   * @param localPath - Local file path (absolute)
   * @param storagePath - Storage path (relative to project root)
   * @param uploadOptions - Upload options
   * @returns Storage path
   */
  uploadFile(localPath: string, storagePath: string, uploadOptions?: WriteOptions): Promise<string>

  /**
   * Write file to specified path
   * @param path - Relative path
   * @param content - File content
   * @returns Absolute path of written file
   */
  writeFile(path: string, content: Buffer | string): Promise<string>

  /**
   * Write file with distributed lock (safe for concurrent access)
   * Automatically acquires lock, writes file, and releases lock
   * @param path - Relative path
   * @param content - File content
   * @param options - Lock options
   * @returns Absolute path of written file
   */
  writeFileSafe(
    path: string,
    content: Buffer | string,
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
  ): Promise<string>

  /**
   * Write JSON file
   * @param path - Relative path
   * @param data - Data to serialize
   * @returns Absolute path of written file
   */
  writeJsonFile<T>(path: string, data: T): Promise<string>

  /**
   * Write JSON file with distributed lock (safe for concurrent access)
   * Automatically acquires lock, writes file, and releases lock
   * @param path - Relative path
   * @param data - Data to serialize
   * @param options - Lock options
   * @returns Absolute path of written file
   */
  writeJsonFileSafe<T>(
    path: string,
    data: T,
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
  ): Promise<string>

  /**
   * Write JSON file with distributed lock and update function (safe for concurrent access)
   * Automatically acquires lock, reads current data, applies update function, writes, and releases lock
   * @param path - Relative path
   * @param updateFn - Function to update the data (receives current data, returns updated data)
   * @param options - Lock options
   * @returns Absolute path of written file
   */
  writeJsonFileSafeWithUpdate<T>(
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
  ): Promise<string>
}

/**
 * Create a storage instance for a project.
 *
 * Routing:
 * 1. V2 process (AO_V2) -> ProjectStore.
 * 2. Unit tests (jest, no AO_V2) -> LocalStorage, so tool tests do hermetic
 *    node-local filesystem round-trips without touching the data dir. Keyed off
 *    JEST_WORKER_ID, which jest always sets and no running app sets. This is
 *    checked AFTER the V2 branch so AO_V2 tests still get the file store.
 * 3. Everything else (the API and its workers) -> ProjectStore.
 *
 * @param projectId - Project ID
 * @returns Storage instance (ProjectStore, or LocalStorage under jest)
 *
 * @example
 * ```typescript
 * const storage = await createStorage('my-project-123')
 * await storage.writeFile('storyboard/scene-1.json', content)
 * ```
 */
export async function createStorage(projectId: string): Promise<Storage> {
  if (isAgentV2()) {
    return new ProjectStore(projectId)
  }

  // Unit tests only (no AO_V2): hermetic node-local filesystem.
  if (process.env['JEST_WORKER_ID'] !== undefined) {
    return new LocalStorage(projectId)
  }

  return new ProjectStore(projectId)
}
