/**
 * Unified File Operations for local files and the file store
 *
 * This module provides unified file operation APIs that automatically detect
 * whether to use local filesystem (fs) or the file store based on environment:
 * - AO_V2=false (or unset) -> Local filesystem with absolute paths
 * - AO_V2=true -> the file store with relative paths
 *
 * This abstraction allows code to work seamlessly in both local and storage modes
 * by checking the environment variable consistently.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { isAgentV2 } from '@reelmakeeasy/common/constant/agent-v2'

import { getSandboxedPath } from './utils'

/**
 * Create directory (unified)
 * - Local mode: Creates directory using fs.mkdir
 * - storage mode: Skips (storage doesn't require directory creation)
 *
 * @param dirPath - Directory path (relative path will be resolved for local mode)
 * @param projectId - Project ID (required for path resolution in local mode)
 */
export async function mkdirUnified(dirPath: string, projectId?: string): Promise<void> {
  if (isAgentV2()) {
    // storage mode: Skip (directories don't need to be created in storage)
    return
  }

  // Local mode: Resolve path and create directory
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : getSandboxedPath({ targetPath: dirPath, projectId: projectId || '' })
  await fs.mkdir(absolutePath, { recursive: true })
}

/**
 * Write file (unified)
 * - Local mode: Writes to local filesystem (creates parent directory if needed)
 * - storage mode: Uploads to the file store
 *
 * @param filePath - File path (relative path, will be resolved for local mode)
 * @param content - File content (string or Buffer)
 * @param projectId - Project ID (required for both modes)
 */
export async function writeFileUnified(
  filePath: string,
  content: Buffer | string,
  projectId: string,
): Promise<void> {
  if (isAgentV2()) {
    // storage mode: Upload to storage (no directory creation needed)
    const storage = await createStorage(projectId)
    await storage.writeFile(filePath, content)
  } else {
    // Local mode: Resolve path, ensure parent directory exists, then write
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : getSandboxedPath({ targetPath: filePath, projectId })
    const dir = path.dirname(absolutePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(absolutePath, content)
  }
}

/**
 * Read file (unified)
 * - Local mode: Reads from local filesystem
 * - storage mode: Downloads from the file store
 *
 * @param filePath - File path (relative path, will be resolved for local mode)
 * @param projectId - Project ID (required for both modes)
 * @returns File content as Buffer
 */
export async function readFileUnified(filePath: string, projectId: string): Promise<Buffer> {
  if (isAgentV2()) {
    // storage mode: Download from storage
    const storage = await createStorage(projectId)
    return await storage.readFile(filePath)
  }
  // Local mode: Resolve path and read from filesystem
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : getSandboxedPath({ targetPath: filePath, projectId })
  return await fs.readFile(absolutePath)
}

/**
 * Check if file exists (unified)
 * - Local mode: Checks local filesystem
 * - storage mode: Checks the file store
 *
 * @param filePath - File path (relative path, will be resolved for local mode)
 * @param projectId - Project ID (required for both modes)
 * @returns True if file exists, false otherwise
 */
export async function fileExistsUnified(filePath: string, projectId: string): Promise<boolean> {
  if (isAgentV2()) {
    // storage mode: Check the file store
    const storage = await createStorage(projectId)
    return await storage.exists(filePath)
  }
  // Local mode: Resolve path and check filesystem
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : getSandboxedPath({ targetPath: filePath, projectId })
  return await fs
    .access(absolutePath)
    .then(() => true)
    .catch(() => false)
}

/**
 * Copy file (unified)
 * Supports both storage and local storage, as well as cross-storage operations
 *
 * IMPORTANT: This function intentionally uses path.isAbsolute() to distinguish between:
 * - Relative paths: store paths (in storage mode) or project-relative paths (in local mode)
 * - Absolute paths: Temporary local file paths (e.g., /tmp/...) used for processing
 *
 * Supported scenarios:
 * storage mode:
 *   - storage -> storage: Both paths relative (storage.copyFile)
 *   - storage -> Temp local: src relative, dest absolute (storage.downloadFile)
 *   - Temp local -> storage: src absolute, dest relative (storage.uploadFile)
 *
 * Local mode:
 *   - Project file -> Project file: Both paths resolved via getSandboxedPath
 *   - Temp local -> Project file: src absolute, dest resolved
 *   - Project file -> Temp local: src resolved, dest absolute
 *
 * @param srcPath - Source file path (relative or absolute)
 * @param destPath - Destination file path (relative or absolute)
 * @param projectId - Project ID (required for storage operations and path resolution)
 */
export async function copyFileUnified(
  srcPath: string,
  destPath: string,
  projectId: string,
): Promise<void> {
  const storage = await createStorage(projectId)
  const srcIsAbsolute = path.isAbsolute(srcPath)
  const destIsAbsolute = path.isAbsolute(destPath)

  if (isAgentV2()) {
    // storage mode: Relative paths are store paths, absolute paths are temp local files
    if (srcIsAbsolute && !destIsAbsolute) {
      // Temp local file -> storage: Upload
      await storage.uploadFile(srcPath, destPath)
    } else if (!srcIsAbsolute && destIsAbsolute) {
      // storage -> Temp local file: Download
      const destDir = path.dirname(destPath)
      await fs.mkdir(destDir, { recursive: true })
      await storage.downloadFile(srcPath, destPath)
    } else if (!srcIsAbsolute && !destIsAbsolute) {
      // storage -> storage: Copy within storage
      await storage.copyFile(srcPath, destPath)
    } else {
      // Temp local -> Temp local: Should use fs.copyFile directly instead
      throw new Error(
        'Invalid path combination in storage mode: both paths are absolute temp files',
      )
    }
  } else {
    // Local mode: Resolve relative paths via getSandboxedPath, keep absolute paths as-is
    const resolvedSrc = srcIsAbsolute
      ? srcPath
      : getSandboxedPath({ targetPath: srcPath, projectId })
    const resolvedDest = destIsAbsolute
      ? destPath
      : getSandboxedPath({ targetPath: destPath, projectId })

    // Ensure destination directory exists
    const destDir = path.dirname(resolvedDest)
    await fs.mkdir(destDir, { recursive: true })

    // Perform local file copy
    await fs.copyFile(resolvedSrc, resolvedDest)
  }
}

/**
 * Join path segments (unified)
 * - Local mode: Uses path.join (handles OS-specific separators)
 * - storage mode: Uses forward slash (/) for store paths
 *
 * @param basePath - Base path
 * @param segments - Path segments to join
 * @returns Joined path
 */
export function joinPath(basePath: string, ...segments: string[]): string {
  if (isAgentV2()) {
    // storage mode: Use forward slash
    // Filter out empty strings and join with /
    return [basePath, ...segments].filter(Boolean).join('/')
  }
  // Local mode: Use path.join (OS-aware)
  return path.join(basePath, ...segments)
}

/**
 * Delete file (unified)
 * - Local mode: Deletes from local filesystem
 * - storage mode: Deletes from the file store
 *
 * @param filePath - File path (relative path, will be resolved for local mode)
 * @param projectId - Project ID (required for both modes)
 */
export async function deleteFileUnified(filePath: string, projectId: string): Promise<void> {
  if (isAgentV2()) {
    // storage mode: Delete from storage
    const storage = await createStorage(projectId)
    await storage.deleteFile(filePath)
  } else {
    // Local mode: Resolve path and delete from filesystem
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : getSandboxedPath({ targetPath: filePath, projectId })
    await fs.rm(absolutePath, { force: true })
  }
}

/**
 * List directory contents (unified)
 * - Local mode: Lists files from local filesystem
 * - storage mode: Lists files from the file store with prefix
 *
 * @param dirPath - Directory path (relative path, will be resolved for local mode)
 * @param projectId - Project ID (required for both modes)
 * @returns Array of file names
 */
export async function listDirectoryUnified(dirPath: string, projectId: string): Promise<string[]> {
  if (isAgentV2()) {
    // storage mode: List files with prefix
    const storage = await createStorage(projectId)
    return await storage.listFiles(dirPath)
  }
  // Local mode: Resolve path and list filesystem directory
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : getSandboxedPath({ targetPath: dirPath, projectId })
  return await fs.readdir(absolutePath)
}

/**
 * Download file from storage to local temporary directory
 * Helper function for cases where external tools require local file paths
 *
 * @param fileUri - storage file path (relative)
 * @param projectId - Project ID
 * @returns Local temporary file path
 */
export async function downloadToTemp(fileUri: string, projectId: string): Promise<string> {
  const storage = await createStorage(projectId)
  const tempPath = `/tmp/${projectId}/${fileUri.replace(/\//g, '_')}_${Date.now()}`

  // Ensure temp directory exists
  const tempDir = path.dirname(tempPath)
  await fs.mkdir(tempDir, { recursive: true })

  await storage.downloadFile(fileUri, tempPath)
  return tempPath
}

/**
 * Upload file from local to storage and clean up local file
 * Helper function for cases where external tools generate local files
 *
 * @param localPath - Local file path (absolute)
 * @param fileUri - storage destination path (relative)
 * @param projectId - Project ID
 */
export async function uploadAndCleanup(
  localPath: string,
  fileUri: string,
  projectId: string,
): Promise<void> {
  const storage = await createStorage(projectId)
  await storage.uploadFile(localPath, fileUri)
  await fs.rm(localPath, { force: true }).catch(() => {
    // Ignore cleanup errors
  })
}
