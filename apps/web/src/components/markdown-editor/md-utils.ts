import { Attachment } from '@shared/types/assets/attachment'

import { META_TAG_REGEX } from './custom-nodes/MetaTagNode'

/**
 * Extract all resource IDs referenced in the text via meta tags
 */
export const extractActiveResourceIds = (text: string): Set<string> => {
  const resourceIds = new Set<string>()
  const re = new RegExp(META_TAG_REGEX.source, 'g')
  let m: null | RegExpExecArray
  while ((m = re.exec(text)) !== null) {
    const resourceId = m[3]
    if (resourceId) {
      resourceIds.add(resourceId)
    }
  }
  return resourceIds
}

/**
 * Get attachments that are actively referenced in the text
 * This is used to filter the resource pool to only upload files that are actually used
 */
export const getActiveAttachments = (text: string, attachments: Attachment[]): Attachment[] => {
  const activeIds = extractActiveResourceIds(text)
  return attachments.filter((att) => activeIds.has(att.id) || activeIds.has(att.url || ''))
}

export const findUnlinkedMetaIds = (text: string, attachments: Attachment[]): string[] => {
  const referenced = new Set<string>()
  const valid = new Set<string>()

  for (const a of attachments) {
    if (a.id) {
      valid.add(a.id)
    }
    if (a.url) {
      valid.add(a.url)
    }
  }

  const re = new RegExp(META_TAG_REGEX.source, 'gu')
  let m: null | RegExpExecArray
  while ((m = re.exec(text)) !== null) {
    const resourceId = m[3]
    if (resourceId) {
      referenced.add(resourceId)
    }
  }

  return [...referenced].filter((id) => !valid.has(id))
}

/**
 * Find attachments that are missing uploadable content.
 * An attachment needs either:
 * - A local file object (for new uploads)
 * - A remote URL (for existing resources like templates)
 *
 * blob: URLs without a file object are invalid (memory may have been cleared).
 */
export const findAttachmentsWithMissingContent = (attachments: Attachment[]): Attachment[] => {
  return attachments.filter((att) => {
    const hasLocalFile = Boolean(att.file)
    const hasRemoteUrl = att.url && !att.url.startsWith('blob:')

    return !hasLocalFile && !hasRemoteUrl
  })
}
