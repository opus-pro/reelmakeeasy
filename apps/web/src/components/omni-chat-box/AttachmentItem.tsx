import { cn } from '@shared/ui'
import { useEffect, useMemo, useState } from 'react'

import { Camera, Cross, File as FileIconIcon, Image, Loading, Music } from '@/components/icons/core'

interface AttachmentItemProps {
  canClose?: boolean
  className?: string
  file?: Blob | File
  isUploading: boolean
  name: string
  onRemove?: () => void
  previewImage?: string
  type: string
}

export const AttachmentItem: React.FC<AttachmentItemProps> = ({
  name,
  type,
  previewImage,
  file,
  isUploading,
  canClose = true,
  className,
  onRemove,
}) => {
  const [objectUrl, setObjectUrl] = useState<string | undefined>()

  useEffect(() => {
    if (previewImage) {
      setObjectUrl(undefined)
      return
    }

    if (file && type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setObjectUrl(url)

      return () => {
        URL.revokeObjectURL(url)
      }
    }

    setObjectUrl(undefined)
  }, [file, type, previewImage])

  const displaySrc = previewImage || objectUrl

  const FileIcon = useMemo(() => {
    if (!type) {
      return FileIconIcon
    }

    if (type.startsWith('image/')) {
      return Image
    }
    if (type.startsWith('video/')) {
      return Camera
    }
    if (type.startsWith('audio/')) {
      return Music
    }
    return FileIconIcon
  }, [type])

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 px-3 py-[10px] h-[60px] max-w-[188px] bg-tertiary text-sm group',
        isUploading ? 'opacity-60' : '',
        className,
      )}
    >
      <div className="bg-fill-tertiary rounded-xs flex size-10 shrink-0 items-center justify-center overflow-hidden">
        {isUploading ? (
          <Loading className="text-primary size-5 animate-spin" />
        ) : displaySrc ? (
          <img alt={name} className="size-full object-fill" src={displaySrc} />
        ) : (
          <FileIcon className="text-primary size-5" />
        )}
      </div>
      <span className="text-primary flex-1 truncate font-medium">
        {isUploading ? (
          'Uploading...'
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className={cn('truncate text-sm')}>{name.split('.')[0]}</span>
            <span className="text-secondary text-xs">
              {type.split('/')[1]?.toUpperCase() || 'FILE'}
            </span>
          </div>
        )}
      </span>
      {!isUploading && canClose && (
        <button
          aria-label={`Remove ${name}`}
          className="text-primary hover:text-primary border-secondary bg-panel absolute right-0 top-0 z-10 flex size-5 -translate-y-1.5 translate-x-1.5 items-center justify-center rounded-full border opacity-0 group-hover:opacity-100"
          onClick={() => onRemove?.()}
          type="button"
        >
          <Cross className="size-2.5" />
        </button>
      )}
    </div>
  )
}
