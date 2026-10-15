/**
 * Local Storage - concrete implementation using local file system
 * Layer 3: Concrete Implementation (internal use only)
 */

import fs from 'node:fs'
import path from 'node:path'

import { logger } from '../../logger'
import { ensureError } from '../../utils/error-handler'
import { getCwd, getNodeLocalScratchRoot } from '../../utils/path.util'

import { AbstractStorage } from './abstract-storage'

/**
 * Local Storage concrete implementation
 * Extends AbstractStorage and implements local file system operations
 */
export class LocalStorage extends AbstractStorage {
  private readonly baseDir: string

  constructor(projectId: string, baseDir?: string) {
    super(projectId)
    // The default local base is the node-local scratch root. This
    // keeps LocalStorage consistent with getAbsolutePath and the path resolver, which
    // both resolve project scratch under the same node-local root. A caller may
    // still pass an explicit baseDir (resolved relative to the cwd).
    this.baseDir = baseDir ? path.join(getCwd(), baseDir) : getNodeLocalScratchRoot()
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    const absoluteSource = this.resolve(sourcePath)
    const absoluteDest = this.resolve(destPath)
    const sourceFullPath = this.getFullPathInternal(absoluteSource)
    const destFullPath = this.getFullPathInternal(absoluteDest)

    await fs.promises.mkdir(path.dirname(destFullPath), { recursive: true })
    await fs.promises.copyFile(sourceFullPath, destFullPath)
    logger.info(`storage: Copied file in local storage - from=${sourcePath} to=${destPath}`)
  }

  async copyFileFromStorage(
    sourceStorage: import('./storage').Storage,
    filePath: string,
  ): Promise<void> {
    try {
      const sourceFullPath = sourceStorage.getFullPath(filePath)
      const destFullPath = this.getFullPath(filePath)

      await fs.promises.mkdir(path.dirname(destFullPath), { recursive: true })
      await fs.promises.copyFile(sourceFullPath, destFullPath)
      logger.info(`storage: Copied file to local storage - path=${filePath}`)
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
      // Remove trailing slash for consistency
      const normalizedFolderPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath

      const sourceFullPath = sourceStorage.getFullPath(normalizedFolderPath)
      const destFullPath = this.getFullPath(normalizedFolderPath)

      // Use fs.cp to recursively copy the entire folder
      // This is much faster than copying files one by one
      await fs.promises.cp(sourceFullPath, destFullPath, {
        recursive: true,
        force: true,
      })
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, folderPath }, 'storage: Failed to copy folder from storage')
      throw err
    }
  }

  async deleteFolder(folderPath: string): Promise<void> {
    try {
      const absolutePath = this.resolve(folderPath)
      const fullPath = this.getFullPathInternal(absolutePath)

      await fs.promises.rm(fullPath, { recursive: true, force: true })
      logger.info(`storage: Deleted folder from local storage - path=${folderPath}`)
    } catch (error) {
      const err = ensureError(error)
      logger.error({ error: err, folderPath }, 'storage: Failed to delete folder')
      throw err
    }
  }

  async downloadFile(storagePath: string, localPath: string): Promise<void> {
    const absolutePath = this.resolve(storagePath)
    const fullPath = this.getFullPathInternal(absolutePath)

    // localPath is treated as absolute path (can be outside project directory)
    const absoluteLocalPath = path.isAbsolute(localPath) ? localPath : path.resolve(localPath)
    await fs.promises.mkdir(path.dirname(absoluteLocalPath), { recursive: true })
    await fs.promises.copyFile(fullPath, absoluteLocalPath).catch()
    logger.debug(
      `storage: Downloaded file from local storage - storage=${storagePath} local=${absoluteLocalPath}`,
    )
  }

  async ensureDir(dirPath: string): Promise<string> {
    const absolutePath = this.resolve(dirPath)
    const fullPath = this.getFullPathInternal(absolutePath)

    if (!fs.existsSync(fullPath)) {
      await fs.promises.mkdir(fullPath, { recursive: true })
      logger.info(`storage: Created directory - path=${dirPath}`)
    }

    return absolutePath
  }

  getProjectRoot(): string {
    return this.projectId
  }

  async uploadFile(
    localPath: string,
    storagePath: string,
    _uploadOptions?: unknown,
  ): Promise<string> {
    const absolutePath = this.resolve(storagePath)
    const fullPath = this.getFullPathInternal(absolutePath)

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.copyFile(localPath, fullPath)
    logger.info(
      `storage: Uploaded file to local storage - local=${localPath} storage=${storagePath}`,
    )

    return absolutePath
  }

  protected async deleteInternal(absolutePath: string): Promise<void> {
    const fullPath = this.getFullPathInternal(absolutePath)

    try {
      await fs.promises.unlink(fullPath)
      logger.debug(`storage: Deleted file from local - path=${absolutePath}`)
    } catch (error) {
      // Ignore ENOENT (file not found) - deletion is idempotent
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  protected async existsInternal(absolutePath: string): Promise<boolean> {
    try {
      const fullPath = this.getFullPathInternal(absolutePath)
      await fs.promises.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  protected getFullPathInternal(absolutePath: string): string {
    // If it's already an absolute path, use it directly
    if (path.isAbsolute(absolutePath)) {
      return absolutePath
    }
    // Otherwise, join with baseDir
    return path.join(this.baseDir, absolutePath)
  }

  protected async getSizeInternal(absolutePath: string): Promise<number> {
    const fullPath = this.getFullPathInternal(absolutePath)
    const stats = await fs.promises.stat(fullPath)
    return stats.size
  }

  // ========== File Transfer Operations ==========

  protected async listInternal(prefix: string): Promise<string[]> {
    const fullPath = this.getFullPathInternal(prefix)

    if (!fs.existsSync(fullPath)) {
      return []
    }

    const files: string[] = []
    const walk = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else {
          const relativePath = path.relative(fullPath, entryPath)
          files.push(relativePath)
        }
      }
    }

    await walk(fullPath)

    logger.debug(`storage: Listed files from local - prefix=${prefix} count=${files.length}`)

    return files
  }

  protected async readdirInternal(absoluteDir: string): Promise<{
    directories: string[]
    files: string[]
  }> {
    const fullPath = this.getFullPathInternal(absoluteDir)
    if (!fs.existsSync(fullPath)) {
      return { files: [], directories: [] }
    }
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true })
    const files: string[] = []
    const directories: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) {
        directories.push(entry.name)
      } else if (entry.isFile()) {
        files.push(entry.name)
      }
    }
    logger.debug(
      `storage: Read directory from local - dir=${absoluteDir} files=${files.length} dirs=${directories.length}`,
    )
    return { files, directories }
  }

  protected async readInternal(absolutePath: string): Promise<Buffer> {
    const fullPath = this.getFullPathInternal(absolutePath)
    const content = await fs.promises.readFile(fullPath)

    logger.debug(`storage: Read file from local - path=${absolutePath}`)

    return content
  }

  protected async writeInternal(absolutePath: string, content: Buffer | string): Promise<void> {
    const fullPath = this.getFullPathInternal(absolutePath)

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.writeFile(fullPath, content)

    logger.debug(`storage: Wrote file to local - path=${absolutePath}`)
  }
}
