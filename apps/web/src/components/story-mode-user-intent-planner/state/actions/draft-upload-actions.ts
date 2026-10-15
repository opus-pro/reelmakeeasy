import { Fetcher } from '@reelmakeeasy/common/utils/fetcher'

import { mapDraftFileType } from '../../utils/draft-file-utils'
import {
  type DraftFileUpload,
  getApiAtom,
  getDraftFileUploadsAtom,
  getDraftMessageAtom,
} from '../atoms/planner'
import type { PlannerState } from '../planner-state'

export function enqueueDraftFileUploads(
  plannerState: PlannerState,
  files: readonly File[],
): DraftFileUpload[] {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length === 0) {
    return []
  }
  const api = plannerState.get(getApiAtom)
  if (!api) {
    return []
  }

  const promises = api.uploadFiles(imageFiles)

  const newEntries: DraftFileUpload[] = imageFiles.map((file, i) => ({
    blobUrl: URL.createObjectURL(file),
    fetcher: new Fetcher(() => promises[i]),
    file,
    id: crypto.randomUUID(),
  }))

  plannerState.set(getDraftFileUploadsAtom, [
    ...plannerState.get(getDraftFileUploadsAtom),
    ...newEntries,
  ])

  return newEntries
}

export function enqueueDraftFileUploadsForOption(
  plannerState: PlannerState,
  files: File[],
  optionText: string,
): void {
  const entries = enqueueDraftFileUploads(plannerState, files)
  if (entries.length === 0) {
    return
  }

  const assetTags = entries
    .map((entry) =>
      buildMetaTagText({
        id: entry.id,
        label: entry.file.name,
        previewUrl: entry.file.type.startsWith('image/') ? entry.blobUrl : undefined,
        type: mapDraftFileType(entry.file.type),
      }),
    )
    .join(' ')
  const nextMessage = [optionText, assetTags].filter(Boolean).join(' ')
  plannerState.set(getDraftMessageAtom, nextMessage)
}

export function removeDraftFileUploadById(plannerState: PlannerState, id: string): void {
  const uploads = plannerState.get(getDraftFileUploadsAtom)
  const targets = uploads.filter((upload) => upload.id === id)
  if (!targets.length) {
    return
  }

  const nextUploads = uploads.filter((upload) => upload.id !== id)

  for (const target of targets) {
    URL.revokeObjectURL(target.blobUrl)
  }
  plannerState.set(getDraftFileUploadsAtom, nextUploads)
  plannerState.set(
    getDraftMessageAtom,
    stripMetaTagByResourceId(plannerState.get(getDraftMessageAtom), id),
  )
}

/**
 * Percent-encodes the two characters the meta-tag format uses as separators (`)` and `|`)
 * so a previewUrl with literal parens or pipes does not terminate the renderer regex
 * mid-URL. Browsers decode these back transparently when used as `<img src>`.
 */
export function encodeMetaTagSeparators(url: string): string {
  return url.replace(/\|/g, '%7C').replace(/\)/g, '%29')
}

function buildMetaTagText(asset: {
  id: string
  label: string
  previewUrl?: string
  type: ReturnType<typeof mapDraftFileType>
}): string {
  const encodedLabel = asset.label.replace(/\]/g, String.raw`\]`)
  const resource = asset.previewUrl
    ? `${asset.id}|${encodeMetaTagSeparators(asset.previewUrl)}`
    : asset.id
  return `@${asset.type}[${encodedLabel}](${resource})`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function stripMetaTagByResourceId(message: string, resourceId: string): string {
  if (!message.trim()) {
    return message
  }

  const escapedResourceId = escapeRegex(resourceId)
  const tagPattern = new RegExp(
    `@(vo|img|video|audio|txt|pdf|file|shot)\\[[^\\]]*\\]\\(${escapedResourceId}(?:\\|[^)]*)?\\)`,
    'g',
  )

  return message.replace(tagPattern, '')
}
