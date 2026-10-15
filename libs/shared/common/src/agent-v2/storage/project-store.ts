/**
 * Project storage on the local file store.
 * Layer 3: Concrete Implementation (internal use only)
 */

import fs from 'node:fs'
import path from 'node:path'

import { Context as ActivityContext } from '@reelmakeeasy/workflow-engine/activity'

import { isAgentV2 } from '../../constant/agent-v2'
import { logger } from '../../logger'
import { storeUri } from '../../storage/address'
import { fileStore, type WriteOptions } from '../../storage/file-store'
import {
  copyStoredFile,
  deleteStoredFile,
  deleteStoredFolder,
  downloadStoredFile,
  projectRootKey,
  storedFileExists,
  storedFileMetadata,
  storedFileSize,
  uploadToStore,
} from '../../storage/stored-files'
import { ensureError } from '../../utils/error-handler'
import { getNodeLocalCacheRoot } from '../../utils/path.util'

import { AbstractStorage, StorageObjectMetadata } from './abstract-storage'

/**
 * A project's files in the file store, under `projects/<projectId>/`.
 * `getFullPath` returns `store://projects/<projectId>/<path>` addresses.
 *
 * `root` roots the store at another key folder, for files that belong to no project
 * (the brand library's anchors): every child of `projects/` is a project id.
 */
export class ProjectStore extends AbstractStorage {
  private readonly root: string

  constructor(projectId: string, options: { root?: string } = {}) {
    super(projectId)
    this.root = options.root ?? projectRootKey(projectId)
  }

  /**
   * Clean up the node-local cache directory for this activity
   * (<node-local-cache>/{projectId}/{runId}/). Only works inside an activity.
   */
  async cleanupLocalCache(): Promise<void> {
    const runId = this.getActivityRunId()
    if (!runId) {
      return
    }

    const localCacheDir = path.join(getNodeLocalCacheRoot(), this.projectId, runId)
    try {
      const stats = await fs.promises.stat(localCacheDir).catch(() => null)
      if (stats) {
        await fs.promises.rm(localCacheDir, { recursive: true, force: true })
        logger.info(`[ProjectStore] Cleaned up local cache: ${localCacheDir}`)
      }
    } catch (error) {
      logger.warn(`[ProjectStore] Failed to cleanup local cache: ${localCacheDir}`, {
        error: ensureError(error),
      })
    }
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    await copyStoredFile(this.getFullPath(sourcePath), this.getFullPath(destPath))
    logger.info(`storage: Copied file - from=${sourcePath} to=${destPath}`)
  }

  async copyFileFromStorage(
    sourceStorage: import('./storage').Storage,
    filePath: string,
  ): Promise<void> {
    try {
      await copyStoredFile(sourceStorage.getFullPath(filePath), this.getFullPath(filePath))
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, filePath }, 'storage: Failed to copy file from storage')
      throw err
    }
  }

  async copyFolderFromStorage(
    sourceStorage: import('./storage').Storage,
    folderPath: string,
  ): Promise<void> {
    try {
      // Remove trailing slash to avoid double slashes in file paths
      const normalizedFolderPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath
      const files = await sourceStorage.listFiles(normalizedFolderPath)
      if (files.length === 0) {
        logger.info(`storage: No files found in folder - path=${normalizedFolderPath}`)
        return
      }
      await Promise.all(
        files.map(async (file) => {
          const fullPath = `${normalizedFolderPath}/${file}`
          try {
            await this.copyFileFromStorage(sourceStorage, fullPath)
          } catch (error) {
            logger.warn(`storage: Failed to copy file, skipping - path=${fullPath}`, error)
          }
        }),
      )
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, folderPath }, 'storage: Failed to copy folder from storage')
      throw err
    }
  }

  async deleteFolder(folderPath: string): Promise<void> {
    try {
      await deleteStoredFolder(this.getFullPath(folderPath))
      logger.info(`storage: Deleted folder - path=${folderPath}`)
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, folderPath }, 'storage: Failed to delete folder')
      throw err
    }
  }

  async downloadFile(storagePath: string, localPath: string): Promise<void> {
    // localPath is treated as absolute path (can be outside project directory)
    const absoluteLocalPath = path.isAbsolute(localPath) ? localPath : path.resolve(localPath)
    await downloadStoredFile(this.getFullPath(storagePath), absoluteLocalPath)
    logger.info(`storage: Downloaded file - storage=${storagePath} local=${absoluteLocalPath}`)
  }

  /** Folders exist implicitly: writing a file under one creates it. */
  async ensureDir(dirPath: string): Promise<string> {
    return this.resolve(dirPath)
  }

  override async getObjectMetadata(path: string): Promise<StorageObjectMetadata | undefined> {
    return (await storedFileMetadata(this.getFullPath(path))) ?? undefined
  }

  /** Every file of the project lives under `projects/{projectId}/` (or the given root). */
  getProjectRoot(): string {
    return this.root
  }

  async uploadFile(
    localPath: string,
    storagePath: string,
    uploadOptions?: WriteOptions,
  ): Promise<string> {
    const absolutePath = this.resolve(storagePath)
    await uploadToStore(localPath, storeUri(absolutePath), uploadOptions)
    logger.info(`storage: Uploaded file - local=${localPath} storage=${storagePath}`)
    return absolutePath
  }

  protected async deleteInternal(absolutePath: string): Promise<void> {
    await deleteStoredFile(storeUri(absolutePath))
    logger.debug(`storage: Deleted file - path=${absolutePath}`)
  }

  protected async existsInternal(absolutePath: string): Promise<boolean> {
    try {
      if (await storedFileExists(storeUri(absolutePath))) {
        return true
      }
      // Not a file: a folder exists when it holds at least one file.
      const folder = `${absolutePath.replace(/\/+$/, '')}/`
      const { files } = await fileStore.list(folder, { limit: 1 })
      return files.length > 0
    } catch {
      return false
    }
  }

  protected getFullPathInternal(absolutePath: string): string {
    return storeUri(absolutePath)
  }

  protected async getSizeInternal(absolutePath: string): Promise<number> {
    return await storedFileSize(storeUri(absolutePath))
  }

  protected async listInternal(prefix: string): Promise<string[]> {
    // A trailing '/' lists the folder's contents only: 'retrieval_intents/' must
    // not match 'retrieval_intents.json'.
    const folder = prefix.endsWith('/') ? prefix : `${prefix}/`
    const { files } = await fileStore.list(folder)
    const relativePaths = files
      .map((file) => file.key.slice(folder.length))
      .filter((relativePath) => relativePath.length > 0)
    logger.debug(`storage: Listed files - prefix=${prefix} count=${relativePaths.length}`)
    return relativePaths
  }

  protected async readdirInternal(absoluteDir: string): Promise<{
    directories: string[]
    files: string[]
  }> {
    const folder = absoluteDir.endsWith('/') ? absoluteDir : `${absoluteDir}/`
    const listed = await fileStore.list(folder, { shallow: true })
    const files = listed.files
      .map((file) => file.key.slice(folder.length))
      .filter((name) => name && !name.includes('/'))
    const directories = listed.folders
      .map((name) => name.slice(folder.length).replace(/\/$/, ''))
      .filter((name) => !!name)
    logger.debug(
      `storage: Read directory - dir=${absoluteDir} files=${files.length} dirs=${directories.length}`,
    )
    return { files, directories }
  }

  protected async readInternal(absolutePath: string): Promise<Buffer> {
    const content = await fileStore.file(absolutePath).read()
    logger.debug({ absolutePath }, `storage: Read file - path=${absolutePath}`)
    return content
  }

  protected async writeInternal(absolutePath: string, content: Buffer | string): Promise<void> {
    await fileStore.file(absolutePath).write(content)
    logger.debug(`storage: Wrote file - path=${absolutePath}`)
  }

  /** The current Activity run ID, or null outside an activity. */
  private getActivityRunId(): null | string {
    if (!isAgentV2()) {
      return null
    }
    try {
      const context = ActivityContext.current()
      return `${context.info.workflowExecution.workflowId}-${context.info.activityId}`
    } catch {
      return null
    }
  }
}
