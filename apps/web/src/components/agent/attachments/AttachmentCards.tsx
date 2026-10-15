'use client'

import type { AgentAttachment, AgentAttachmentKind } from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { CrossSmall } from '@/components/icons/core'

import { Spinner } from '../Spinner'

import type { PendingAttachment } from './attachments'
import { readableSize } from './attachments'
import { AttachmentViewer, KIND_ICON, type ViewedFile } from './AttachmentViewer'

const EXT_KIND: [RegExp, AgentAttachmentKind][] = [
  [/\.(png|jpe?g|gif|webp|heic|avif)$/i, 'image'],
  [/\.(mp3|wav|m4a|aac|flac|ogg)$/i, 'audio'],
  [/\.(mp4|mov|m4v|webm|mkv|avi)$/i, 'video'],
]

/** A picked file's kind, by its type, else its extension (the browser leaves some types blank). */
export function fileKind(file: { name: string; type: string }): AgentAttachmentKind {
  const type = file.type.split('/')[0]
  if (type === 'image' || type === 'audio' || type === 'video') return type
  return EXT_KIND.find(([re]) => re.test(file.name))?.[1] ?? 'file'
}

/** The URL that serves a file attached to the chat (pictures, sound and video play inline). */
export function attachmentUrl(apiOrigin: string, sessionId: string, name: string): string {
  return new URL(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(name)}`,
    apiOrigin,
  ).toString()
}

/**
 * One file as a square tile, the same size whatever it is: a picture shown whole (scaled to
 * fit, never cropped), else its kind's icon with the name and size. A click opens the viewer.
 */
function Tile({
  children,
  className,
  file,
  onOpen,
  title,
}: {
  children?: React.ReactNode
  className?: string
  file: ViewedFile
  onOpen?: () => void
  title?: string
}) {
  const Icon = KIND_ICON[file.kind]
  // A picture the browser can't show (HEIC...) gets the icon tile instead of a broken image.
  const [broken, setBroken] = useState(false)
  const picture = file.kind === 'image' && file.url && !broken
  return (
    <button
      aria-label={`Open ${file.name}`}
      className={cn(
        'relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-white/10 bg-fill-secondary p-1.5 text-center transition-colors',
        onOpen ? 'cursor-pointer hover:border-white/30' : 'cursor-default',
        className,
      )}
      disabled={!onOpen}
      onClick={onOpen}
      title={title ?? file.name}
      type="button"
    >
      {picture ? (
        <img
          alt={file.name}
          className="size-full object-contain"
          onError={() => setBroken(true)}
          src={file.url}
        />
      ) : (
        <>
          <Icon className="size-5 shrink-0 text-secondary" />
          <span className="line-clamp-2 w-full text-[11px] leading-tight font-medium break-all text-primary">
            {file.name}
          </span>
          <span className="text-[10px] text-secondary">{readableSize(file.size)}</span>
        </>
      )}
      {children}
    </button>
  )
}

/** The files waiting in the chat box, above the input: each can be opened or removed. */
export function PendingAttachmentCards({
  items,
  onRemove,
}: {
  items: PendingAttachment[]
  onRemove: (id: string) => void
}) {
  const [viewing, setViewing] = useState<null | ViewedFile>(null)
  if (!items.length) return null
  return (
    <div aria-label="Attached files" className="flex flex-wrap gap-2 px-3 pt-3" role="list">
      {items.map((item) => {
        const file: ViewedFile = {
          kind: fileKind(item.file),
          name: item.file.name || 'Pasted image',
          size: item.file.size,
          url: item.status === 'error' ? undefined : item.previewUrl,
        }
        return (
          <div className="relative flex flex-col" key={item.id} role="listitem">
            <Tile
              className={cn('size-20', item.status === 'error' && 'border-red-400/60')}
              file={file}
              onOpen={file.url ? () => setViewing(file) : undefined}
              title={item.error ?? file.name}
            >
              {item.status === 'uploading' && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Spinner className="size-4 text-primary" />
                </span>
              )}
            </Tile>
            {item.error && (
              <span className="mt-1 block w-20 text-[10px] leading-tight text-red-400">
                {item.error}
              </span>
            )}
            <button
              aria-label={`Remove ${file.name}`}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-white/20 bg-background text-secondary hover:text-primary"
              onClick={() => onRemove(item.id)}
              type="button"
            >
              <CrossSmall className="size-3.5" />
            </button>
          </div>
        )
      })}
      <AttachmentViewer file={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/** The files sent with one of the user's messages, under it in the chat. */
export function SentAttachmentCards({
  attachments,
  sessionId,
}: {
  attachments: AgentAttachment[]
  sessionId: string
}) {
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [viewing, setViewing] = useState<null | ViewedFile>(null)
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((attachment) => {
        const file: ViewedFile = {
          kind: attachment.kind,
          name: attachment.name,
          path: attachment.path,
          size: attachment.size,
          url: attachmentUrl(apiOrigin, sessionId, attachment.name),
        }
        return (
          <Tile
            className="size-24"
            file={file}
            key={attachment.path}
            onOpen={() => setViewing(file)}
            title={attachment.path}
          />
        )
      })}
      <AttachmentViewer file={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
