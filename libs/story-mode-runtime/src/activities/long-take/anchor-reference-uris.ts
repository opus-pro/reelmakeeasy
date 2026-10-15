import * as path from 'node:path'

import type { LongTakeAnchorAssetTask } from '../../workflows/long-take/types'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

export function getAnchorTaskReferenceImageUris(
  task: LongTakeAnchorAssetTask,
  storage: { getFullPath: (relativePath: string) => string },
): string[] {
  return dedupeStrings(
    (task.reference_image_uris?.length ? task.reference_image_uris : task.source_image_uris).map(
      (uri) => resolveAnchorReferenceUri(storage, uri),
    ),
  )
}

function dedupeStrings(values: Array<null | string | undefined>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  )
}

function resolveAnchorReferenceUri(
  storage: { getFullPath: (relativePath: string) => string },
  value: null | string | undefined,
): null | string {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }
  if (
    isStoreUri(normalized) ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    path.isAbsolute(normalized)
  ) {
    return normalized
  }
  return storage.getFullPath(normalized)
}
