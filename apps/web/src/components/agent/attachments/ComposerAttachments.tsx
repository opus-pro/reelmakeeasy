'use client'

import { cn, Tooltip } from '@shared/ui'
import { type ClipboardEvent, type ReactNode, useRef, useState } from 'react'

import { Attachment } from '@/components/icons/core'

import { PendingAttachmentCards } from './AttachmentCards'
import { filesFrom } from './attachments'
import type { Attachments } from './useAttachments'

/**
 * The chat box's frame for files: dropping files on it attaches them (outlined while you
 * drag), and the files waiting to be sent show as cards above the input.
 */
export function AttachmentDropZone({
  canAttach,
  children,
  files,
}: {
  canAttach: boolean
  children: ReactNode
  files: Attachments
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={cn(
        'border-t border-white/10 transition-colors',
        dragging && 'bg-white/5 outline-1 -outline-offset-4 outline-white/30 outline-dashed',
      )}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDragOver={(event) => {
        if (!canAttach || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={(event) => {
        setDragging(false)
        const dropped = canAttach ? filesFrom(event.dataTransfer) : []
        if (!dropped.length) return
        event.preventDefault()
        files.add(dropped)
      }}
    >
      <PendingAttachmentCards items={files.items} onRemove={files.remove} />
      {children}
    </div>
  )
}

/** The paperclip next to the chat box: picks files to attach. */
export function AttachButton({ canAttach, files }: { canAttach: boolean; files: Attachments }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          files.add([...(event.target.files ?? [])])
          event.target.value = ''
        }}
        ref={input}
        type="file"
      />
      <Tooltip content="Attach files: pictures, sound, video..." side="top">
        <button
          aria-label="Attach files"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-fill-secondary text-secondary hover:bg-fill-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canAttach}
          onClick={() => input.current?.click()}
          type="button"
        >
          <Attachment className="size-[18px]" />
        </button>
      </Tooltip>
    </>
  )
}

/** A paste into the chat box: a copied picture or file goes in as an attachment, not its name. */
export function pasteFiles(canAttach: boolean, files: Attachments) {
  return (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = canAttach ? filesFrom(event.clipboardData) : []
    if (!pasted.length) return
    event.preventDefault()
    files.add(pasted)
  }
}

/** Whether Send waits: files still uploading, or nothing to send (no text, no files). */
export function sendWaits(text: string, canAttach: boolean, files: Attachments): boolean {
  return files.busy || (!text && !(canAttach && files.ready.length))
}

/** Files go with a message, so the box takes them only while it takes messages: not while it's
 *  locked, and not while an Easy flow runs (the box then answers its cards). */
export function takesFiles(inputDisabled: boolean, flowActive: boolean): boolean {
  return !inputDisabled && !flowActive
}
