'use client'

import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import {
  attachmentName,
  attachmentProblem,
  type PendingAttachment,
  uploadAttachment,
} from './attachments'

let nextId = 0

/**
 * The files in a chat box: `add` uploads each one at once (pasted, dropped or picked), so
 * sending only names them. `ready` are the saved names to send; `busy` while any uploads.
 */
export type Attachments = ReturnType<typeof useAttachments>

export function useAttachments(sessionId: null | string | undefined) {
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [items, setItems] = useState<PendingAttachment[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items

  const update = (id: string, patch: Partial<PendingAttachment>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const add = useCallback(
    (files: File[]) => {
      if (!sessionId || !files.length) return
      let count = itemsRef.current.filter((item) => item.status !== 'error').length
      const added = files.map((file): PendingAttachment => {
        const problem = attachmentProblem(file, count)
        if (!problem) count += 1
        return {
          ...(problem ? { error: problem } : {}),
          file,
          id: `att-${++nextId}`,
          // Every file gets a local URL, so it opens in the viewer before it's sent.
          ...(problem ? {} : { previewUrl: URL.createObjectURL(file) }),
          status: problem ? 'error' : 'uploading',
        }
      })
      setItems((list) => [...list, ...added])
      for (const item of added) {
        if (item.status !== 'uploading') continue
        uploadAttachment(apiOrigin, sessionId, item.file, attachmentName(item.file))
          .then((attachment) => update(item.id, { attachment, status: 'ready' }))
          .catch((error: unknown) =>
            update(item.id, {
              error: error instanceof Error ? error.message : String(error),
              status: 'error',
            }),
          )
      }
    },
    [apiOrigin, sessionId],
  )

  const remove = useCallback((id: string) => {
    setItems((list) => {
      const gone = list.find((item) => item.id === id)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return list.filter((item) => item.id !== id)
    })
  }, [])

  /** Empties the box (after a send): the sent pictures' previews are let go. */
  const clear = useCallback(() => {
    for (const item of itemsRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    setItems([])
  }, [])

  // A different chat starts with an empty box.
  useEffect(() => clear, [clear, sessionId])

  const ready = items.flatMap((item) => (item.attachment ? [item.attachment.name] : []))
  const busy = items.some((item) => item.status === 'uploading')
  return { add, busy, clear, items, ready, remove }
}
