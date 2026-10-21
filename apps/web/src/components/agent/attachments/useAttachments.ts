'use client'

import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import {
  attachmentName,
  attachmentProblem,
  MAX_ATTACHMENTS,
  type PendingAttachment,
  uploadAttachment,
} from './attachments'

let nextId = 0

/** Past the limit (files added while a send that's then refused was out), the later ones can't
 *  go: they're marked so, and left out of what's sent. */
function withinLimit(items: PendingAttachment[]): PendingAttachment[] {
  let count = 0
  return items.map((item) => {
    if (item.status === 'error' || ++count <= MAX_ATTACHMENTS) return item
    const { attachment: _dropped, ...rest } = item
    return { ...rest, error: attachmentProblem(item.file, MAX_ATTACHMENTS) ?? '', status: 'error' }
  })
}

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
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  // Whether this box is still on screen: a chat switch or a missing chat replaces it.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

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

  /** Takes the files out of the box for a send without letting them go yet: `release` them
   *  once the message went, or `restore` them to the box when it was refused. */
  const take = useCallback(() => {
    const taken = itemsRef.current
    const from = sessionRef.current
    setItems([])
    return {
      release: () => {
        for (const item of taken) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      },
      restore: () => {
        // Gone, or another chat by now: there is no box of theirs to put them back in.
        if (mounted.current && sessionRef.current === from)
          setItems((list) => withinLimit([...taken, ...list]))
        else for (const item of taken) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      },
    }
  }, [])

  // A different chat starts with an empty box.
  useEffect(() => clear, [clear, sessionId])

  const ready = items.flatMap((item) => (item.attachment ? [item.attachment.name] : []))
  const busy = items.some((item) => item.status === 'uploading')
  return { add, busy, clear, items, ready, remove, take }
}
