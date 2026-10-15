import type { Attachment } from '@shared/types/assets/attachment'
import { atom } from 'jotai'

import type { ResourceType } from '@/components/markdown-editor/custom-nodes/MetaTagNode'

type AttachmentItem = {
  file?: File
  title: string
  type: ResourceType
  url?: string
  value: string
}
export const attachmentsAtom = atom<Attachment[]>([])
attachmentsAtom.debugLabel = 'attachmentsAtom'

export const embeddedMetaTagsAtom = atom<AttachmentItem[]>((get) => {
  const attachments = get(attachmentsAtom)
  return attachments.map((attachment) => {
    let type: ResourceType = 'file'
    if (attachment.type.startsWith('video/')) {
      type = 'video'
    }
    if (attachment.type.startsWith('audio/')) {
      type = 'audio'
    }
    if (attachment.type.startsWith('image/')) {
      type = 'img'
    }
    if (attachment.type.startsWith('text/')) {
      type = 'txt'
    }
    if (attachment.type.startsWith('application/pdf')) {
      type = 'pdf'
    }

    return {
      file: attachment.file,
      url: attachment.url,
      title: attachment.name,
      type,
      value: attachment.id || '',
    }
  })
})
embeddedMetaTagsAtom.debugLabel = 'embeddedMetaTagsAtom'

export type ActiveAttachment = {
  id: string
  title: string
  type: ResourceType
}

export const activeAttachmentsAtom = atom<ActiveAttachment[]>([])
activeAttachmentsAtom.debugLabel = 'activeAttachmentsAtom'
