'use client'

import type { AgentAttachmentKind } from '@shared/types/api/agent'
import { Dialog } from '@shared/ui'
import { useState } from 'react'

import { File, Film, Image as ImageIcon, Music } from '@/components/icons/core'

import { readableSize } from './attachments'

/** A file the viewer can open: `url` serves it (a local preview before it's sent). */
export interface ViewedFile {
  kind: AgentAttachmentKind
  name: string
  /** Where it is saved on this computer, once sent. */
  path?: string
  size: number
  url?: string
}

/** Each kind of file's icon, on its tile and in the viewer. */
export const KIND_ICON: Record<AgentAttachmentKind, typeof File> = {
  audio: Music,
  file: File,
  image: ImageIcon,
  video: Film,
}

/** The viewer's content: the picture, a player for sound or video, else the download. */
function Body({ file }: { file: ViewedFile }) {
  // A picture or clip the browser can't show (HEIC, MKV...) falls back to the download.
  const [failed, setFailed] = useState(false)
  if (!file.url || failed || file.kind === 'file') return <FileFallback file={file} />
  if (file.kind === 'image') {
    return (
      <img
        alt={file.name}
        className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain"
        onError={() => setFailed(true)}
        src={file.url}
      />
    )
  }
  if (file.kind === 'video') {
    return (
      <video
        autoPlay
        className="mx-auto max-h-[75vh] max-w-full rounded-lg bg-black"
        controls
        onError={() => setFailed(true)}
        src={file.url}
      />
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <Music className="size-10 text-secondary" />
      <audio autoPlay className="w-full" controls onError={() => setFailed(true)} src={file.url} />
    </div>
  )
}

/** What the viewer shows for a file it can't play: its icon, name, size and a download link. */
function FileFallback({ file }: { file: ViewedFile }) {
  const Icon = KIND_ICON[file.kind]
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Icon className="size-10 text-secondary" />
      <span className="text-sm font-medium break-all text-primary">{file.name}</span>
      <span className="text-xs text-secondary">{readableSize(file.size)}</span>
      {file.url && (
        <a
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-white/90"
          download={file.name}
          href={file.url}
        >
          Download
        </a>
      )}
    </div>
  )
}

/** A pop-up for an attached file: a picture enlarged, sound or video playing, else a download. */
export function AttachmentViewer({
  file,
  onClose,
}: {
  file: null | ViewedFile
  onClose: () => void
}) {
  return (
    <Dialog
      classNames={{
        content:
          'backdrop-blur-2xl bg-menu/80 border-tertiary rounded-2xl p-5 w-[min(92vw,960px)] max-w-[min(92vw,960px)]',
        description: 'text-secondary text-xs break-all',
        header: 'gap-1 pb-3 pr-8',
        title: 'text-primary text-base font-semibold break-all',
      }}
      description={file?.path ?? (file ? readableSize(file.size) : undefined)}
      footer={null}
      onOpenChange={(open) => !open && onClose()}
      open={!!file}
      showClose
      title={file?.name ?? ''}
    >
      {/* A new file starts fresh: a failed picture doesn't make the next one a download. */}
      {file && <Body file={file} key={file.url ?? file.name} />}
    </Dialog>
  )
}
