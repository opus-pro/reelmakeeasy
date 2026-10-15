import path from 'node:path/posix'

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFolder,
  isStoreUri,
  storedFileExists,
  workspaceUri,
} from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException } from '@nestjs/common'

export function buildAttachmentCopySourceCandidates(params: {
  attachmentUri: string
  fileName: string
  sourceProjectId: string
}): string[] {
  const { attachmentUri, fileName, sourceProjectId } = params
  const candidates = new Set<string>()
  const trimmedUri = attachmentUri?.trim()

  if (isStoreUri(trimmedUri)) {
    candidates.add(trimmedUri)
  }

  const relativeUri = stripProjectPrefix(sourceProjectId, trimmedUri || '')
  if (relativeUri) {
    candidates.add(getProjectV2StorageUri(sourceProjectId, relativeUri))
    candidates.add(workspaceUri(sourceProjectId, relativeUri))
  }

  const baseName = path.basename(fileName || trimmedUri || '')
  if (baseName) {
    const userUploadedPath = path.join('user_uploaded', baseName)
    candidates.add(getProjectV2StorageUri(sourceProjectId, userUploadedPath))
    candidates.add(workspaceUri(sourceProjectId, userUploadedPath))
  }

  return Array.from(candidates)
}

export async function copyProjectUserUploadedPrefixes(
  sourceProjectId: string,
  targetProjectId: string,
): Promise<void> {
  const prefixes = ['user_uploaded', 'user-intent-planner/uploads']
  for (const prefix of prefixes) {
    const sourceUri = getProjectV2StorageUri(sourceProjectId, prefix)
    const targetUri = getProjectV2StorageUri(targetProjectId, prefix)
    try {
      await copyStoredFolder(sourceUri, targetUri)
    } catch (error) {
      throw new BadRequestException(
        `Failed to copy project files from ${prefix}, ${ensureError(error).message}`,
        { cause: error },
      )
    }
  }
}

export function getProjectV2StorageUri(projectId: string, relativePath: string): string {
  return new ProjectStore(projectId).getFullPath(relativePath)
}

export async function resolveAttachmentCopySourceUri(params: {
  attachmentUri: string
  fileName: string
  sourceProjectId: string
}): Promise<string> {
  const candidates = buildAttachmentCopySourceCandidates(params)
  if (!candidates.length) {
    throw new Error(`No copy source candidates found for attachment ${params.fileName}`)
  }
  for (const candidate of candidates) {
    try {
      if (await storedFileExists(candidate)) {
        return candidate
      }
    } catch {
      // Try the next candidate; the final copy reports a useful error if none exist.
    }
  }
  return candidates[0]
}

function stripProjectPrefix(projectId: string, uri: string): string {
  if (!uri || isStoreUri(uri) || uri.startsWith('http://') || uri.startsWith('https://')) {
    return ''
  }
  const prefixes = [`${projectId}/`, `projects/${projectId}/`, `agent/workspace/${projectId}/`]
  for (const prefix of prefixes) {
    if (uri.startsWith(prefix)) {
      return uri.slice(prefix.length)
    }
  }
  return uri
}
