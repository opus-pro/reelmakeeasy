'use client'

import { cn } from '@shared/ui'

import { CrossSmall } from '@/components/icons/core'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useImageLightbox } from '@/hooks/use-image-lightbox'

import type { DraftFileUpload } from '../../state/atoms/planner'

export function DraftUploadThumbnail({
  upload,
  onRemove,
}: {
  onRemove: () => void
  upload: DraftFileUpload
}) {
  const isImage = upload.file.type.startsWith('image/')
  const {
    close: closeLightbox,
    isOpen: isLightboxOpen,
    triggerProps: lightboxTriggerProps,
  } = useImageLightbox(isImage)
  return (
    <div
      aria-label={lightboxTriggerProps.role ? `Expand ${upload.file.name}` : undefined}
      className={cn(
        'relative size-8 shrink-0 rounded-xxs bg-white/5',
        lightboxTriggerProps.role && 'cursor-zoom-in',
      )}
      {...lightboxTriggerProps}
    >
      <img
        alt={upload.file.name}
        className="block size-full rounded-xxs object-cover"
        src={upload.blobUrl}
      />
      {/* A touch device has no hover state, so this stays visible -- gating it behind hover puts
          the only way to unstage an upload out of reach there. */}
      <button
        aria-label={`Remove ${upload.file.name}`}
        className="absolute right-0 top-0 z-20 inline-flex size-4 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-sm transition hover:bg-black/90"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemove()
        }}
        type="button"
      >
        <CrossSmall className="size-3" />
      </button>
      {isLightboxOpen && (
        <ImageLightbox alt={upload.file.name} onClose={closeLightbox} src={upload.blobUrl} />
      )}
    </div>
  )
}
