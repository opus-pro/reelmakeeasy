import { readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path, { join } from 'node:path'

import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  readJsonFile,
  readJsonFileSync,
  writeJsonFile,
  writeJsonFileSync,
} from '@reelmakeeasy/common/utils/path.util'
import { exists, readJson, readJsonSync } from 'fs-extra'

import { getSandboxedPath } from './utils'

/**
 * binary: binary file
 * json: json file
 * text: text file
 */
export type FileType = 'binary' | 'json' | 'text' | null

export class FileOrDirectoryEntry<T> {
  constructor(
    public readonly projectId: string,
    /** relative path inside projectId */
    public readonly path: string,
    public readonly fileType: FileType = 'json',
    /** is directory, fileType should be null */
    public readonly isDirectory = false,
  ) {
    if (this.isDirectory) {
      this.fileType = null
    }
  }

  // PATH related methods
  absPath(): string {
    return getSandboxedPath({ targetPath: this.path, projectId: this.projectId })
  }
  basename(): string {
    return path.basename(this.absPath())
  }
  dirname(): string {
    return path.dirname(this.absPath())
  }
  /**
   * return false if file does not exist
   * @returns boolean
   */
  async exists(): Promise<boolean> {
    return await exists(this.absPath()).catch(() => false)
  }
  getChildPath({
    childPath,
    isDirectory = false,
    fileType = 'json',
  }: {
    childPath: string
    fileType?: FileType
    isDirectory?: boolean
  }): FileOrDirectoryEntry<T> {
    return new FileOrDirectoryEntry<T>(
      this.projectId,
      path.join(this.path, childPath),
      fileType,
      isDirectory,
    )
  }

  async read(): Promise<T | void> {
    if (this.isDirectory) {
      throw new Error('Cannot read directory')
    }

    const fullPath = this.absPath()
    if (this.fileType === 'json') {
      return await readJsonFile<T>(fullPath)
    }
    if (this.fileType === 'binary') {
      return (await readFile(fullPath, 'binary')) as T
    }
    return (await readFile(fullPath, 'utf8')) as T
  }

  async readOrThrow(customError?: Error): Promise<T> {
    if (this.isDirectory) {
      throw new Error('Cannot read directory')
    }

    const fullPath = this.absPath()
    try {
      if (this.fileType === 'json') {
        return (await readJson(fullPath)) as T
      }
      if (this.fileType === 'binary') {
        return (await readFile(fullPath, 'binary')) as T
      }
      return (await readFile(fullPath, 'utf8')) as T
    } catch (e) {
      throw customError ?? ensureError(e)
    }
  }

  readOrThrowSync(): T {
    if (this.isDirectory) {
      throw new Error('Cannot read directory')
    }

    const fullPath = this.absPath()
    if (this.fileType === 'json') {
      return readJsonSync(fullPath) as T
    }
    if (this.fileType === 'binary') {
      return readFileSync(fullPath, 'binary') as T
    }

    return readFileSync(fullPath, 'utf8') as T
  }

  readSync(): T | undefined {
    if (this.isDirectory) {
      throw new Error('Cannot read directory')
    }

    const fullPath = this.absPath()
    if (this.fileType === 'json') {
      return readJsonFileSync<T>(fullPath)
    }
    if (this.fileType === 'binary') {
      return readFileSync(fullPath, 'binary') as T
    }
    return readFileSync(fullPath, 'utf8') as T
  }

  relativePath(): string {
    return join(this.projectId, this.path)
  }

  async write(data: T): Promise<void> {
    if (this.isDirectory) {
      throw new Error('Cannot write to directory')
    }

    const fullPath = this.absPath()
    if (this.fileType === 'json') {
      return await writeJsonFile<T>(fullPath, data)
    }
    if (this.fileType === 'binary') {
      return await writeFile(fullPath, data as unknown as Buffer)
    }
    return await writeFile(fullPath, data as string)
  }

  writeSync(data: T): void {
    if (this.isDirectory) {
      throw new Error('Cannot write to directory')
    }

    const fullPath = this.absPath()
    if (this.fileType === 'json') {
      return writeJsonFileSync<T>(fullPath, data)
    }
    if (this.fileType === 'binary') {
      return writeFileSync(fullPath, data as unknown as Buffer)
    }
    return writeFileSync(fullPath, `${data}`)
  }
}
