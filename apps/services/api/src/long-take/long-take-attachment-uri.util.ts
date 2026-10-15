import path from 'node:path/posix'

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'

export function buildProjectStorageUri(projectId: string, relativePath: string): string {
  return new ProjectStore(projectId).getFullPath(relativePath)
}

export function buildUserAssetAliases(fileName: string): string[] {
  const trimmed = fileName.trim()
  const withoutExt = trimmed.replace(/\.[^/.]+$/, '')
  return Array.from(
    new Set(
      [
        trimmed,
        trimmed.toLowerCase(),
        withoutExt,
        withoutExt.toLowerCase(),
        withoutExt.replace(/\s+/g, '_'),
        withoutExt.replace(/\s+/g, '-'),
      ].filter(Boolean),
    ),
  )
}

export function extractTempUploadFilename(objectPath: string): string {
  const basename = path.basename(objectPath)
  const timestampPrefixedMatch = basename.match(/^\d{13}-(.+)$/)
  return timestampPrefixedMatch?.[1] || basename
}

export function normalizeAttachmentRelativeUri(projectId: string, uri: string): string {
  const trimmed = uri?.trim() || ''
  if (!trimmed) {
    return ''
  }
  const prefixes = [`${projectId}/`, `projects/${projectId}/`, `agent/workspace/${projectId}/`]
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return trimmed
}
