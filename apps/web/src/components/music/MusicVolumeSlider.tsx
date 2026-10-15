'use client'

import { describeBgmVolume } from '@reelmakeeasy/common/long-take/bgm-volume'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@shared/ui'

import { useDebouncedCommit } from './useDebouncedCommit'

/** The quietest the slider goes: 0% would silence the music while it reads as on. */
export const MUSIC_VOLUME_MIN = 5

/**
 * The music volume as a percentage of the narration (100% is as loud as the narration).
 * The previews follow the slider while it moves (`onChange`); the delivered file is
 * rebaked once it is let go (`onCommit`). Built on Radix directly so the handle itself
 * carries the label screen readers announce.
 */
export function MusicVolumeSlider({
  className,
  disabled = false,
  onChange,
  onCommit,
  volume,
}: {
  className?: string
  disabled?: boolean
  onChange: (volume: number) => void
  onCommit: (volume: number) => void
  volume: number
}) {
  const text = describeBgmVolume(volume)
  // Arrow keys commit on every press; save once they pause.
  const commit = useDebouncedCommit(onCommit, 500)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="shrink-0 text-xs text-secondary">Volume</span>
      <SliderPrimitive.Root
        className="relative flex h-4 w-28 shrink-0 cursor-pointer touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        disabled={disabled}
        max={100}
        min={MUSIC_VOLUME_MIN}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => commit(v)}
        step={1}
        value={[Math.max(MUSIC_VOLUME_MIN, volume)]}
      >
        <SliderPrimitive.Track className="relative h-[4px] grow overflow-hidden rounded-full bg-fill-hover">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Music volume"
          aria-valuetext={text}
          className="block size-3 rounded-full bg-fill shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </SliderPrimitive.Root>
      <span className="w-9 shrink-0 text-xs tabular-nums text-secondary">{text}</span>
    </div>
  )
}
