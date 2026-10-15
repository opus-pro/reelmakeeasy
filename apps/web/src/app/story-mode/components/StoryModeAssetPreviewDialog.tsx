'use client'

import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { useKeyPress } from 'ahooks'
import React, { useRef } from 'react'

import { Cross } from '@/components/icons/core'
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick'

export const StoryModeAssetPreviewDialog: React.FC<{
  asset: null | QuickStartTemplateAsset
  onClose: () => void
}> = ({ asset, onClose }) => {
  const isVideo = asset?.mimeType.startsWith('video/')
  const contentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useDismissOnOutsideClick({
    enabled: Boolean(asset),
    ignoreRefs: [contentRef, closeButtonRef],
    onDismiss: onClose,
  })

  useKeyPress(
    (event) => Boolean(asset) && event.key === 'Escape',
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    },
    { events: ['keydown'], useCapture: true },
  )

  if (!asset) {
    return null
  }

  return (
    <div
      aria-label={asset.name || 'User asset preview'}
      aria-modal="true"
      className="absolute inset-0 z-50 bg-black/90"
      role="dialog"
    >
      <div className="relative flex size-full items-center justify-center p-6">
        <div className="relative" ref={contentRef}>
          {isVideo ? (
            <video
              autoPlay
              className="block size-auto rounded-[16px] object-contain"
              controls
              controlsList="nodownload"
              muted
              onContextMenu={(e) => e.preventDefault()}
              playsInline
              src={asset.url}
              style={{ maxHeight: 'calc(100vh - 48px)', maxWidth: 'calc(100vw - 120px)' }}
            />
          ) : (
            <img
              alt={asset.name || 'User asset preview'}
              className="block size-auto rounded-[16px] object-contain"
              src={asset.url}
              style={{ maxHeight: 'calc(100vh - 48px)', maxWidth: 'calc(100vw - 120px)' }}
            />
          )}
        </div>
      </div>
      <button
        aria-label="Close preview"
        className="absolute left-6 top-6 z-20 flex size-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
        onClick={onClose}
        ref={closeButtonRef}
        type="button"
      >
        <Cross className="size-4" />
      </button>
    </div>
  )
}
