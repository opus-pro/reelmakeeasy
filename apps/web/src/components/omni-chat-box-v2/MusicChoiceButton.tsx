'use client'

import {
  MUSIC_CHOICE_OPTIONS,
  MUSIC_INFO,
  type MusicCatalog,
  type MusicRequest,
  musicRequestLabel,
  musicTrackTitle,
  sanitizeMusicChoice,
  sanitizeMusicRequest,
} from '@reelmakeeasy/common/long-take/music-craft'
import { Button, cn, Popover, Tooltip } from '@shared/ui'
import { useAtom } from 'jotai'
import React, { useEffect, useState } from 'react'

import { musicRequestAtom } from '@/atom/home'
import { MusicSourceMenu } from '@/components/music/MusicSourceMenu'
import { useMusicCatalog } from '@/components/music/useMusicCatalog'
import { useIsMobile } from '@/util/browserUtils'

/**
 * A stored track the catalog no longer has (the user deleted it, or the library dropped
 * it). Only known once the catalog has loaded; before that a track is just unnamed yet.
 */
export function isStaleMusicTrack(
  stored: MusicRequest | unknown,
  catalog: MusicCatalog | undefined,
  loaded: boolean,
): boolean {
  const request = sanitizeMusicRequest(stored)
  if (!loaded || !request.track || sanitizeMusicChoice(request.choice) === 'off') return false
  return musicTrackTitle(request.track, catalog) === null
}

/**
 * The pill's text for a request: the choice, a track's title ("Track" before the catalog
 * loads, Auto once it is known to be gone), or "Custom" for the user's own words. Unknown
 * stored values read as Auto.
 */
export function musicPillText(
  stored: MusicRequest | unknown,
  catalog?: MusicCatalog,
  loaded = false,
): string {
  const request = sanitizeMusicRequest(stored)
  const choice = sanitizeMusicChoice(request.choice)
  if (choice === 'off') return `Music: ${MUSIC_CHOICE_OPTIONS.off.pill}`
  if (request.track) {
    if (isStaleMusicTrack(request, catalog, loaded))
      return `Music: ${MUSIC_CHOICE_OPTIONS.auto.pill}`
    return `Music: ${musicTrackTitle(request.track, catalog) ?? 'Track'}`
  }
  if (request.note) return 'Music: Custom'
  return `Music: ${musicRequestLabel(request, catalog)}`
}

/** The background music for the video: made for it (a mood or the user's words), a library
 *  track, one of the user's own tracks, or none. Remembered between videos. */
export function MusicChoiceButton({
  disabled,
  onOpenChange,
}: {
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [stored, setRequest] = useAtom(musicRequestAtom)
  const { catalog, loaded } = useMusicCatalog()
  const isMobile = useIsMobile()
  const value = sanitizeMusicRequest(stored)
  // A remembered track that is gone would quietly become a generated bed on the next
  // video: forget it, so the pill and the start say Auto.
  const stale = isStaleMusicTrack(value, catalog, loaded)
  useEffect(() => {
    if (stale) setRequest({ choice: 'auto' })
  }, [setRequest, stale])

  const popover = (
    <Popover
      align="start"
      className="z-[100] w-auto rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={
        <MusicSourceMenu
          current={value}
          onPick={(request) => {
            setRequest(request)
            setOpen(false)
            onOpenChange?.(false)
          }}
        />
      }
      modal={isMobile}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      open={open}
      side="bottom"
      sideOffset={4}
    >
      <Button
        className={cn(
          'h-9.5 min-w-[60px] max-w-[220px] gap-1.5 rounded-full bg-transparent px-2.5 py-0 text-sm font-medium leading-[17px] text-white transition-colors',
          open ? 'bg-fill-secondary' : 'hover:bg-fill-secondary',
        )}
        disabled={disabled}
      >
        <span className="truncate">{musicPillText(value, catalog, loaded)}</span>
      </Button>
    </Popover>
  )

  if (isMobile) return popover
  return (
    <Tooltip
      className="z-[100] max-w-64 rounded-xs bg-overlay px-2 py-1 text-primary backdrop-blur-xl"
      content={open ? null : MUSIC_INFO}
      side="top"
      sideOffset={4}
    >
      {popover}
    </Tooltip>
  )
}
