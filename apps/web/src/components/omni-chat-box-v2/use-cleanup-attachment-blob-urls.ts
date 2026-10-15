import { Attachment } from '@shared/types/assets/attachment'
import { useEffect, useRef } from 'react'

export const useCleanupAttachmentBlobUrls = (attachments: Attachment[]) => {
  const prevAttachmentsRef = useRef<Attachment[]>([])
  useEffect(() => {
    const prev = prevAttachmentsRef.current
    const current = attachments

    const currentById = new Map(current.map((att) => [att.id, att]))
    prev.forEach((prevAtt) => {
      const nextAtt = currentById.get(prevAtt.id)
      const prevUrl = prevAtt.url
      const nextUrl = nextAtt?.url
      if (prevUrl?.startsWith('blob:') && (!nextAtt || !nextUrl || nextUrl !== prevUrl)) {
        URL.revokeObjectURL(prevUrl)
      }
    })

    prevAttachmentsRef.current = attachments
  }, [attachments])

  useEffect(
    () => () => {
      prevAttachmentsRef.current.forEach((att) => {
        if (att.url?.startsWith('blob:')) {
          URL.revokeObjectURL(att.url)
        }
      })
    },
    [],
  )
}
