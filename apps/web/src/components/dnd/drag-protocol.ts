import { Logger } from '@reelmakeeasy/common/utils/logger'

export type AnchorAssetDragPayload = {
  mime: string
  previewUrl?: string
  resourceId: string
  title: string
}

export type MetaTagNodeDragPayload = {
  duration?: number
  previewUrl?: string
  resourceId: string
  resourceType: MetaTagResourceType
  sourceNodeKey: string
  title: string
}

type DragPayloadRecord = Record<string, unknown>

type MetaTagResourceType = 'audio' | 'file' | 'img' | 'pdf' | 'shot' | 'txt' | 'video' | 'vo'

const nsLogger = Logger.get('components.dnd.drag-protocol')

const serializeDragPayload = (payload: DragPayloadRecord): string => JSON.stringify(payload)

const parseDragPayloadRecord = (raw: string): DragPayloadRecord | null => {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    return parsed as DragPayloadRecord
  } catch (error) {
    nsLogger.error('Failed to parse drag payload json', { error, raw })
    return null
  }
}

const parseAnchorAssetDragPayload = (raw: string): AnchorAssetDragPayload | null => {
  const parsed = parseDragPayloadRecord(raw)
  if (!parsed) {
    return null
  }
  if (
    typeof parsed.mime !== 'string' ||
    typeof parsed.resourceId !== 'string' ||
    typeof parsed.title !== 'string'
  ) {
    nsLogger.error('Failed to parse anchor asset drag payload: invalid shape', raw)
    return null
  }
  return {
    mime: parsed.mime,
    previewUrl: typeof parsed.previewUrl === 'string' ? parsed.previewUrl : undefined,
    resourceId: parsed.resourceId,
    title: parsed.title,
  }
}

const parseMetaTagNodeDragPayload = (raw: string): MetaTagNodeDragPayload | null => {
  const parsed = parseDragPayloadRecord(raw)
  if (!parsed) {
    return null
  }
  if (
    typeof parsed.sourceNodeKey !== 'string' ||
    typeof parsed.resourceId !== 'string' ||
    typeof parsed.resourceType !== 'string' ||
    typeof parsed.title !== 'string'
  ) {
    nsLogger.error('Failed to parse meta tag node drag payload: invalid shape', raw)
    return null
  }
  return {
    sourceNodeKey: parsed.sourceNodeKey,
    resourceId: parsed.resourceId,
    resourceType: parsed.resourceType as MetaTagResourceType,
    title: parsed.title,
    previewUrl: typeof parsed.previewUrl === 'string' ? parsed.previewUrl : undefined,
    duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
  }
}

export const DRAG_PROTOCOLS = {
  anchorAsset: {
    mime: 'application/x-reelmakeeasy-anchor-asset',
    parse: parseAnchorAssetDragPayload,
    serialize: (payload: AnchorAssetDragPayload): string => serializeDragPayload(payload),
  },
  metaTagNode: {
    mime: 'application/x-reelmakeeasy-meta-tag-node',
    parse: parseMetaTagNodeDragPayload,
    serialize: (payload: MetaTagNodeDragPayload): string => serializeDragPayload(payload),
  },
} as const
