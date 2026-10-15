'use client'

import { Button } from '@shared/ui'
import type { ReactNode } from 'react'

import { Cross } from '@/components/icons/core'

interface StoryModeFrameProps {
  // Center column content. The viewer renders its playback card here; the
  // editor renders its sequencer canvas.
  center: ReactNode
  // Optional siblings rendered after the row (context menus,
  // dialogs). They sit on top of the main layout via their own z-index.
  extras?: ReactNode
  // Optional overlay rendered as a sibling of the main row (e.g. prev/next
  // project arrows). Mount first so it sits beneath the close button.
  navOverlay?: ReactNode
  // Close button handler.
  onClose: () => void
  // Right-side detail panel content.
  panel: ReactNode
  // Optional thumbnail strip column rendered to the right of the panel.
  siblingStrip?: ReactNode
  // Optional overlay anchored to the top of the center (video) column. Used by
  // the share view to center a banner over the video, not the full row.
  topOverlay?: ReactNode
}

export function StoryModeFrame({
  center,
  panel,
  siblingStrip,
  navOverlay,
  extras,
  onClose,
  topOverlay,
}: StoryModeFrameProps) {
  return (
    <div className="relative flex size-full flex-col bg-background">
      {navOverlay}
      {!topOverlay && (
        <Button
          aria-label="Close"
          className="absolute left-6 top-6 z-50 rounded-full hover:bg-white/18 hover:text-white"
          onClick={onClose}
          size="icon"
        >
          <Cross className="size-3.5" />
        </Button>
      )}
      <div className="flex size-full min-h-0 min-w-0 flex-row items-stretch justify-center gap-6 px-5 py-6">
        <div className="flex min-w-0 flex-1 flex-col">
          {topOverlay ? (
            <CenterColumnWithBanner banner={topOverlay} center={center} onClose={onClose} />
          ) : (
            center
          )}
        </div>
        <div className="h-full w-88 shrink-0">{panel}</div>
        {siblingStrip}
      </div>
      {extras}
    </div>
  )
}

// Share view: a header row (close button + banner, kept centered over the video by a
// mirror spacer) stacked above the center content.
function CenterColumnWithBanner({
  banner,
  center,
  onClose,
}: {
  banner: ReactNode
  center: ReactNode
  onClose: () => void
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 pb-3 md:pb-4">
        <Button
          aria-label="Close"
          className="size-9 shrink-0 rounded-full hover:bg-white/18 hover:text-white"
          onClick={onClose}
          size="icon"
        >
          <Cross className="size-3.5" />
        </Button>
        <div className="min-w-0 flex-1">{banner}</div>
        {/* Mirrors the close button so the banner stays centered over the video column. */}
        <div aria-hidden className="size-9 shrink-0" />
      </div>
      <div className="min-h-0 flex-1">{center}</div>
    </>
  )
}
