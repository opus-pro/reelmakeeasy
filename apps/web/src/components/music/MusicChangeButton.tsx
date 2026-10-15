'use client'

import type { MusicRequest } from '@reelmakeeasy/common/long-take/music-craft'
import { cn, Popover } from '@shared/ui'
import { useState } from 'react'

import { useIsMobile } from '@/util/browserUtils'

import { MusicSourceMenu } from './MusicSourceMenu'

/**
 * "Change" beside a delivered video's music: opens the music menu with the current pick
 * marked; a pick rewrites the delivered file (the caller's `onPick`).
 */
export function MusicChangeButton({
  className,
  current,
  disabled = false,
  onPick,
}: {
  className?: string
  current: MusicRequest
  disabled?: boolean
  onPick: (request: MusicRequest) => void
}) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  return (
    <Popover
      align="start"
      className="z-[100] w-auto rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={
        <MusicSourceMenu
          current={current}
          disabled={disabled}
          onPick={(request) => {
            setOpen(false)
            onPick(request)
          }}
        />
      }
      modal={isMobile}
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      sideOffset={4}
    >
      <button
        className={cn(
          'w-fit text-sm text-primary underline underline-offset-2 hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        disabled={disabled}
        type="button"
      >
        Change
      </button>
    </Popover>
  )
}
