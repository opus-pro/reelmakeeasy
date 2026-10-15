import { File, FileText, Film, Music } from 'lucide-react'

/** Icon representing a file's type by MIME type, sized via className. */
export function AttachmentFileIcon({
  className,
  mimeType,
}: {
  className?: string
  mimeType: string
}) {
  if (mimeType.startsWith('video/')) {
    return <Film className={className} />
  }
  if (mimeType.startsWith('audio/')) {
    return <Music className={className} />
  }
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf') {
    return <FileText className={className} />
  }
  return <File className={className} />
}

/** Human-readable label for a MIME type. */
export function mimeTypeLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    return 'Image'
  }
  if (mimeType.startsWith('audio/')) {
    return 'Audio'
  }
  if (mimeType.startsWith('video/')) {
    return 'Video'
  }
  if (mimeType.startsWith('text/')) {
    return 'Text'
  }
  if (mimeType === 'application/pdf') {
    return 'PDF'
  }
  return 'File'
}
