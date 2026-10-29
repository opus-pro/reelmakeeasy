'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import { VIDEO_SPEED, videoSpeedLabel } from '@reelmakeeasy/common/motion-reel/video-speed'
import { cn, toast } from '@shared/ui'
import { useState } from 'react'

import { useApi } from '@/hooks/useApi'

/**
 * A code video's pace: the slider plays the preview at that speed at once (the browser keeps the
 * voices' pitch), and the download is the video at that speed, made on the server from the
 * finished render (voices stretched in time, never pitched up).
 */
export function VideoSpeedSlider({
  className,
  onChange,
  speed,
}: {
  className?: string
  onChange: (speed: number) => void
  speed: number
}) {
  const label = videoSpeedLabel(speed)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="shrink-0 text-xs text-secondary">Speed</span>
      <SliderPrimitive.Root
        className="relative flex h-4 w-32 shrink-0 cursor-pointer touch-none select-none items-center"
        max={VIDEO_SPEED.max}
        min={VIDEO_SPEED.min}
        onValueChange={([v]) => onChange(Math.round(v * 100) / 100)}
        step={VIDEO_SPEED.step}
        value={[speed]}
      >
        <SliderPrimitive.Track className="relative h-[4px] grow overflow-hidden rounded-full bg-fill-hover">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Video speed"
          aria-valuetext={label}
          className="block size-3 rounded-full bg-fill shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </SliderPrimitive.Root>
      <span className="w-10 shrink-0 text-xs tabular-nums text-secondary">{label}</span>
      {speed !== 1 && (
        <button
          className="text-xs text-secondary underline underline-offset-2 hover:text-primary"
          onClick={() => onChange(1)}
          type="button"
        >
          Reset
        </button>
      )}
    </div>
  )
}

/** The file's URL that saves it as `name` instead of opening it (the files are served from the
 *  API's origin, where a link's `download` attribute is ignored). */
function savingUrl(url: string, name: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
}

/** "Download" at 1x; at another speed, the video at that speed (made the first time). */
export function VideoSpeedDownload({
  itemId,
  sessionId,
  speed,
  videoUrl,
}: {
  itemId: string
  sessionId: string
  speed: number
  videoUrl: string
}) {
  const { fetchApiDomain } = useApi()
  const [making, setMaking] = useState(false)
  const className = 'text-primary underline underline-offset-2 disabled:opacity-50'
  if (speed === 1)
    return (
      <a className={className} href={savingUrl(videoUrl, `${itemId}.mp4`)}>
        Download
      </a>
    )

  const download = async () => {
    setMaking(true)
    try {
      const res = await fetchApiDomain<{ videoUrl: string }>(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/videos/${encodeURIComponent(itemId)}/speed`,
        { data: { speed }, method: 'POST', noThrowError: true },
      )
      if (!res.ok || !res.data) {
        toast.error(res.error || `Couldn't make the video at ${videoSpeedLabel(speed)}`)
        return
      }
      const link = document.createElement('a')
      link.href = savingUrl(res.data.videoUrl, `${itemId}-${speed}x.mp4`)
      link.click()
    } finally {
      setMaking(false)
    }
  }
  return (
    <button className={className} disabled={making} onClick={() => void download()} type="button">
      {making ? `Making it at ${videoSpeedLabel(speed)}…` : `Download at ${videoSpeedLabel(speed)}`}
    </button>
  )
}
