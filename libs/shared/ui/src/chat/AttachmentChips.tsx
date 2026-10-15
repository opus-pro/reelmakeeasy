import { AttachmentFileIcon } from './AttachmentFileIcon'

export interface AttachmentChip {
  fileName: string
  id: string
  mimeType?: string
  previewUrl: string
  status: 'error' | 'ready' | 'uploading'
}

/**
 * The staged-attachment chip row shared by every composer that accepts attachments (`Composer`).
 * Presentational: chips in, remove callback out. Renders nothing when
 * empty so a caller can drop it in unconditionally.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentChip[]
  onRemove?: (id: string) => void
}) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {attachments.map((a) => (
        <div
          className="relative flex items-center gap-2 overflow-hidden rounded-md bg-muted py-0.5 pl-0 pr-2"
          key={a.id}
        >
          <ChipThumbnail chip={a} />
          {a.status === 'uploading' && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse rounded-b-md bg-primary/60" />
          )}
          <span className="max-w-[72px] truncate text-xs text-muted-foreground">{a.fileName}</span>
          {a.status === 'error' && <span className="text-xs font-medium text-destructive">!</span>}
          <button
            aria-label={`Remove ${a.fileName}`}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => onRemove?.(a.id)}
            type="button"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}

function ChipThumbnail({ chip }: { chip: AttachmentChip }) {
  if (!chip.mimeType || chip.mimeType.startsWith('image/')) {
    return <img alt={chip.fileName} className="size-8 rounded object-cover" src={chip.previewUrl} />
  }
  if (chip.mimeType.startsWith('video/')) {
    return (
      <video
        className="size-8 shrink-0 rounded object-cover"
        muted
        playsInline
        preload="metadata"
        src={`${chip.previewUrl}#t=0.001`}
      />
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
      <AttachmentFileIcon className="size-4 text-muted-foreground" mimeType={chip.mimeType} />
    </span>
  )
}
