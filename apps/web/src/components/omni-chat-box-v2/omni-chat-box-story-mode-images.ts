import { Attachment } from '@shared/types/assets/attachment'

import { META_TAG_REGEX } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { getActiveAttachments } from '@/components/markdown-editor/md-utils'

import { buildAttachmentNameTokens, STORY_MODE_ATTACHED_IMAGE_REGEX } from './omni-chat-box-helpers'

export function resolveStoryModeReferencedImages(promptText: string, attachments: Attachment[]) {
  const imageAttachments = attachments.filter((att) => att.type.startsWith('image/'))
  const referencedById = new Map<string, Attachment>()
  const shortnameByAttachmentId = new Map<string, string>()
  const unresolvedReferences = new Set<string>()

  const addReferencedAttachment = (attachment: Attachment, shortname?: string) => {
    referencedById.set(attachment.id, attachment)
    const normalizedShortname = shortname?.trim()
    if (normalizedShortname) {
      shortnameByAttachmentId.set(attachment.id, normalizedShortname)
    }
  }

  const imageMetaTagTitleByResource = new Map<string, string>()
  const metaTagRegex = new RegExp(META_TAG_REGEX.source, 'g')
  let metaTagMatch: null | RegExpExecArray
  while ((metaTagMatch = metaTagRegex.exec(promptText)) !== null) {
    const resourceType = metaTagMatch[1]
    const title = metaTagMatch[2]?.trim()
    const resourceId = metaTagMatch[3]
    if (resourceType === 'img' && resourceId && title) {
      imageMetaTagTitleByResource.set(resourceId, title)
    }
  }

  const activeMetaImageAttachments = getActiveAttachments(promptText, attachments).filter((att) =>
    att.type.startsWith('image/'),
  )
  for (const attachment of activeMetaImageAttachments) {
    addReferencedAttachment(
      attachment,
      imageMetaTagTitleByResource.get(attachment.id) ||
        (attachment.url ? imageMetaTagTitleByResource.get(attachment.url) : undefined),
    )
  }

  const attachmentsByName = new Map<string, Attachment[]>()
  for (const attachment of imageAttachments) {
    const nameTokens = new Set([
      ...(attachment.file ? buildAttachmentNameTokens(attachment.file.name) : []),
      ...buildAttachmentNameTokens(attachment.name),
    ])
    for (const token of nameTokens) {
      if (!token) {
        continue
      }
      const existing = attachmentsByName.get(token) || []
      existing.push(attachment)
      attachmentsByName.set(token, existing)
    }
  }

  const attachedImageRegex = new RegExp(STORY_MODE_ATTACHED_IMAGE_REGEX.source, 'gi')
  let attachedImageMatch: null | RegExpExecArray
  while ((attachedImageMatch = attachedImageRegex.exec(promptText)) !== null) {
    const referencedName = attachedImageMatch[1]?.trim()
    if (!referencedName) {
      continue
    }
    const candidateKeys = buildAttachmentNameTokens(referencedName)
    const matchedAttachment = candidateKeys
      .map((key) => attachmentsByName.get(key) || [])
      .find((candidateList) => candidateList.length > 0)?.[0]
    if (!matchedAttachment) {
      unresolvedReferences.add(referencedName)
      continue
    }
    addReferencedAttachment(matchedAttachment, referencedName)
  }

  return {
    referencedImages: Array.from(referencedById.values()),
    shortnameByAttachmentId,
    unresolvedReferences: Array.from(unresolvedReferences),
  }
}
