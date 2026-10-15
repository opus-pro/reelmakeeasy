'use client'

import { useAtomValue } from 'jotai'

import { renderSettingsAtom } from '@/atom/longtake-history.store'
import { Caption } from '@/components/icons/core'

interface MobileVideoStatusStripProps {
  /** Whether captions are a thing on this project at all. */
  showCaption?: boolean
}

const TEXT_CLASS = 'text-xs font-medium leading-4 text-white/50'
const ICON_CLASS = 'size-4 shrink-0 text-white/50'

/**
 * The one-line summary under the mobile player: `Caption ON`.
 *
 * The caption setting changes what the finished video looks like but is
 * otherwise only visible behind the `...` menu, so on mobile there was no way to
 * tell what state a project was in without opening it. This restates it, read
 * only -- the menu stays the place to change it. A project without captions
 * renders nothing.
 */
export function MobileVideoStatusStrip({ showCaption = false }: MobileVideoStatusStripProps) {
  const renderSettings = useAtomValue(renderSettingsAtom)
  const captionEnabled = renderSettings.captionEnabled.latest

  if (!showCaption) {
    return null
  }

  return (
    <div className="flex w-full items-center justify-center gap-2 px-4">
      <span className="flex min-w-0 items-center gap-1">
        <Caption className={ICON_CLASS} />
        <span className={TEXT_CLASS}>Caption {captionEnabled ? 'ON' : 'OFF'}</span>
      </span>
    </div>
  )
}
