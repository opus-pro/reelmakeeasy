import type { Attachment } from '@shared/types/assets/attachment'

import type {
  AnchorAssetCategory,
  AnchorAssetPromptGroup,
  AnchorAssetPromptItem,
} from './anchor-assets.types'

const FALLBACK_ANCHOR_ASSET_NAME = 'Assets'
const ANCHOR_ASSET_DISPLAY_NAME_PREFIXES: Record<AnchorAssetCategory, string> = {
  actor: 'Actor image',
  assets: 'Assets image',
  logo: 'Logo image',
  object: 'Object image',
}
const ANCHOR_ASSET_NAME_ALIASES: Record<AnchorAssetCategory, string[]> = {
  actor: ['actor image'],
  assets: ['assets image'],
  logo: ['logo image'],
  object: ['object image'],
}
const PROMPT_META_TAG_REGEX =
  /@(vo|img|video|audio|txt|pdf|file)\[([^\]]*)\]\((pasted:\/\/[a-f0-9-]{36}|https?:\/\/[^)|]+|.+?-[a-f0-9]{32})(?:\|([^)]*))?\)/

export const ANCHOR_ASSET_CATEGORY_ORDER: AnchorAssetCategory[] = [
  'actor',
  'logo',
  'object',
  // 'assets', // hide for now
]

export const ANCHOR_ASSET_CATEGORY_LABELS: Record<AnchorAssetCategory, string> = {
  actor: 'Actor',
  assets: 'Assets',
  object: 'Object',
  logo: 'Logo',
}

export type AnchorAssetIndexMap = Record<AnchorAssetCategory, number>

export type AnchorAssetNameParseResult = {
  category: AnchorAssetCategory
  displayName: string
  index: number
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

export const stripFileExtension = (value: string): string => {
  const normalized = normalizeWhitespace(value)
  const lastDot = normalized.lastIndexOf('.')
  if (lastDot <= 0) {
    return normalized
  }
  return normalized.slice(0, lastDot)
}

export const isAnchorAssetDisplayName = (value: string): boolean =>
  parseAnchorAssetName(value) !== null

export const parseAnchorAssetName = (value: string): AnchorAssetNameParseResult | null => {
  const normalized = stripFileExtension(value)
  const match = normalized.match(/^(.*?)\s+(\d+)$/i)
  if (!match) {
    return null
  }
  const index = Number(match[2])
  if (!Number.isFinite(index) || index <= 0) {
    return null
  }
  const prefix = normalizeWhitespace(match[1]).toLowerCase()
  const category = (Object.keys(ANCHOR_ASSET_NAME_ALIASES) as AnchorAssetCategory[]).find((key) =>
    ANCHOR_ASSET_NAME_ALIASES[key].includes(prefix),
  )
  if (!category) {
    return null
  }
  return {
    category,
    displayName: buildAnchorAssetDisplayName(category, index),
    index,
  }
}

export const buildAnchorAssetDisplayName = (category: AnchorAssetCategory, index: number): string =>
  `${ANCHOR_ASSET_DISPLAY_NAME_PREFIXES[category]} ${index}`

const sanitizeAnchorAssetBaseName = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

export const createAnchorAssetFileName = (displayName: string, sourceFileName: string): string => {
  const sanitizedDisplayName = sanitizeAnchorAssetBaseName(displayName) || displayName
  const trimmedSourceName = sourceFileName.trim()
  const lastDot = trimmedSourceName.lastIndexOf('.')
  const extension = lastDot === -1 ? '' : trimmedSourceName.slice(lastDot + 1).trim()
  return extension ? `${sanitizedDisplayName}.${extension}` : sanitizedDisplayName
}

export const renameFileToAnchorAsset = (
  file: File,
  category: AnchorAssetCategory,
  index: number,
): { displayName: string; file: File } => {
  const displayName = buildAnchorAssetDisplayName(category, index)
  const fileName = createAnchorAssetFileName(displayName, file.name)
  return {
    displayName,
    file: new File([file], fileName, { lastModified: file.lastModified, type: file.type }),
  }
}

const resolveMaxAnchorIndexFromAttachment = (
  attachment: Attachment,
  category: AnchorAssetCategory,
): number => {
  const candidates = [attachment.name, attachment.file?.name].filter(Boolean) as string[]
  let maxIndex = 0
  for (const candidate of candidates) {
    const parsed = parseAnchorAssetName(candidate)
    if (parsed?.category === category) {
      maxIndex = Math.max(maxIndex, parsed.index)
    }
  }
  return maxIndex
}

export const createAnchorAssetIndexMap = (attachments: Attachment[]): AnchorAssetIndexMap => {
  const map: AnchorAssetIndexMap = {
    actor: 0,
    assets: 0,
    object: 0,
    logo: 0,
  }

  for (const category of ANCHOR_ASSET_CATEGORY_ORDER) {
    map[category] = attachments.reduce((currentMax, attachment) => {
      const next = resolveMaxAnchorIndexFromAttachment(attachment, category)
      return Math.max(currentMax, next)
    }, 0)
  }

  return map
}

export const consumeAnchorAssetIndex = (
  indexMap: AnchorAssetIndexMap,
  category: AnchorAssetCategory,
): number => {
  const next = indexMap[category] + 1
  indexMap[category] = next
  return next
}

const resolveAttachmentForResourceId = (
  attachments: Attachment[],
  resourceId: string,
): Attachment | null => {
  return (
    attachments.find(
      (attachment) => attachment.id === resourceId || attachment.url === resourceId,
    ) || null
  )
}

const resolvePromptItemDisplay = ({
  attachment,
  fallbackOrdinal,
  title,
}: {
  attachment: Attachment
  fallbackOrdinal: number
  title: string
}): { category: AnchorAssetCategory; displayName: string } => {
  const parsedFromTitle = parseAnchorAssetName(title)
  if (parsedFromTitle) {
    return { category: parsedFromTitle.category, displayName: parsedFromTitle.displayName }
  }

  const parsedFromAttachmentName = parseAnchorAssetName(attachment.name)
  if (parsedFromAttachmentName) {
    return {
      category: parsedFromAttachmentName.category,
      displayName: parsedFromAttachmentName.displayName,
    }
  }

  const normalizedName = stripFileExtension(title || attachment.name || '')
  return {
    category: 'assets',
    displayName:
      normalizeWhitespace(normalizedName) || `${FALLBACK_ANCHOR_ASSET_NAME} ${fallbackOrdinal}`,
  }
}

export const resolveAnchorAssetsFromPrompt = (
  promptText: string,
  attachments: Attachment[],
): AnchorAssetPromptItem[] => {
  if (!promptText.trim()) {
    return []
  }

  const regex = new RegExp(PROMPT_META_TAG_REGEX.source, 'g')
  const resolved: AnchorAssetPromptItem[] = []
  const seenResourceIds = new Set<string>()
  let fallbackOrdinal = 1
  let match: null | RegExpExecArray

  while ((match = regex.exec(promptText)) !== null) {
    const resourceType = match[1]
    const title = normalizeWhitespace(match[2] || '')
    const resourceId = match[3]
    if (resourceType !== 'img' || !resourceId || seenResourceIds.has(resourceId)) {
      continue
    }

    const attachment = resolveAttachmentForResourceId(attachments, resourceId)
    if (!attachment || !attachment.type.startsWith('image/')) {
      continue
    }

    const previewUrl = attachment.url || ''
    if (!previewUrl) {
      continue
    }

    seenResourceIds.add(resourceId)
    const { category, displayName } = resolvePromptItemDisplay({
      attachment,
      fallbackOrdinal,
      title,
    })
    fallbackOrdinal += 1
    resolved.push({
      attachment,
      category,
      displayName,
      previewUrl,
      resourceId,
    })
  }

  return resolved
}

export const resolveAnchorAssetsFromAttachments = (
  attachments: Attachment[],
): AnchorAssetPromptItem[] => {
  let fallbackOrdinal = 1

  return attachments
    .filter((attachment) => attachment.type.startsWith('image/') && Boolean(attachment.url))
    .map((attachment) => {
      const title = attachment.file?.name || attachment.name || ''
      const { category, displayName } = resolvePromptItemDisplay({
        attachment,
        fallbackOrdinal,
        title,
      })
      fallbackOrdinal += 1

      return {
        attachment,
        category,
        displayName,
        previewUrl: attachment.url || '',
        resourceId: attachment.id || attachment.url || displayName,
      }
    })
}

export const groupAnchorAssetsByCategory = (
  assets: AnchorAssetPromptItem[],
): AnchorAssetPromptGroup[] => {
  return ANCHOR_ASSET_CATEGORY_ORDER.map((category) => ({
    category,
    items: assets.filter((item) => item.category === category),
    label: ANCHOR_ASSET_CATEGORY_LABELS[category],
  })).filter((group) => group.items.length > 0)
}
