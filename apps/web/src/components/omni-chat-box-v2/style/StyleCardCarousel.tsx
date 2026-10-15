'use client'

import { cn } from '@shared/ui'
import React, { useEffect, useMemo, useState } from 'react'

// How long each scene preview is shown before auto-advancing (ms). Kept a touch
// longer than the 500ms slide transition so each frame still gets a beat to rest.
const SLIDE_INTERVAL_MS = 1000

interface StyleCardCarouselProps {
  className?: string
  // Shown when every scene preview fails to load (e.g. the promoted blobs 404 /
  // expired). Usually the uploaded reference thumbnail. Without it a dead set
  // would leave the card stuck on the blank shimmer forever.
  fallbackUrl?: string
  // Rendered scene-preview URLs (portrait/landscape/action). May contain blanks
  // or duplicates from upstream; we de-dupe + drop empties before cycling.
  imageUrls: string[]
  // Larger thumbnails (the popup gallery) eager-load; small inline rows lazy-load.
  priority?: boolean
}

// Auto-advancing slideshow of a saved style's rendered scene previews, used as
// the card's front image. A single image renders statically (no
// timer); 2+ cycle on a fixed interval. Images that fail to load are dropped so
// a 404 preview never freezes the rotation on a blank frame; if every preview
// dies we fall back to `fallbackUrl` (the reference) rather than a perpetual
// shimmer. Each advance slides the current frame out to the left while the next
// slides in from the right, so the rotation reads as a moving slideshow.
export const StyleCardCarousel = React.memo(function StyleCardCarousel({
  className,
  fallbackUrl,
  imageUrls,
  priority = false,
}: StyleCardCarouselProps) {
  const slides = useMemo(
    () => Array.from(new Set(imageUrls.filter((url) => url.trim().length > 0))),
    [imageUrls],
  )
  const [erroredUrls, setErroredUrls] = useState<string[]>([])
  const visible = useMemo(
    () => slides.filter((url) => !erroredUrls.includes(url)),
    [erroredUrls, slides],
  )
  const [index, setIndex] = useState(0)
  // The frame we just advanced from; it animates out to the left while `index`
  // animates in from the right. null on the initial frame / after a reset.
  const [prevIndex, setPrevIndex] = useState<null | number>(null)
  const [isHovered, setIsHovered] = useState(false)

  // Keep the active index in range as slides drop out (load error) or the set
  // changes, so we never point past the end of `visible`.
  useEffect(() => {
    setIndex((prev) => (visible.length === 0 ? 0 : prev % visible.length))
  }, [visible.length])

  // Cycle only while the cursor is over the card; idle cards rest on the first
  // frame so the gallery isn't a wall of motion.
  useEffect(() => {
    if (!isHovered || visible.length < 2) {
      return
    }
    const id = setInterval(() => {
      setIndex((prev) => {
        setPrevIndex(prev)
        return (prev + 1) % visible.length
      })
    }, SLIDE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isHovered, visible.length])

  if (visible.length === 0) {
    // Every scene preview failed to load. Fall back to the reference thumbnail
    // (if any) instead of leaving the card on a perpetual shimmer. Skip it if it
    // already errored above (it shares the same `erroredUrls` set).
    const fallback = fallbackUrl?.trim()
    if (fallback && !erroredUrls.includes(fallback)) {
      return (
        <img
          alt=""
          className={cn(
            'pointer-events-none absolute inset-0 size-full max-w-none object-cover object-center',
            className,
          )}
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          onError={() =>
            setErroredUrls((prev) => (prev.includes(fallback) ? prev : [...prev, fallback]))
          }
          src={fallback}
        />
      )
    }
    return <div className={cn('absolute inset-0 animate-pulse bg-white/20', className)} />
  }

  return (
    // Full-card hover target. Images are pointer-events-none, so clicks bubble
    // to the parent card (selection) while this captures enter/leave to drive
    // the slideshow.
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        setPrevIndex(null)
        setIndex(0)
      }}
    >
      {visible.map((url, i) => {
        const active = i === index % visible.length
        const leaving = !active && i === prevIndex
        // Active frame sits centered; the one we just left slides off to the
        // left; everything else waits parked off to the right, ready to enter.
        // Only the active + leaving frames transition -- parked frames teleport
        // (no transition) so a reset frame doesn't visibly sweep across the card.
        return (
          <img
            alt=""
            className={cn(
              'pointer-events-none absolute inset-0 size-full max-w-none object-cover object-center ease-out',
              active ? 'translate-x-0' : leaving ? '-translate-x-full' : 'translate-x-full',
              active || leaving ? 'transition-transform duration-500' : '',
              className,
            )}
            draggable={false}
            key={url}
            loading={priority ? 'eager' : 'lazy'}
            onError={() => setErroredUrls((prev) => (prev.includes(url) ? prev : [...prev, url]))}
            src={url}
          />
        )
      })}
    </div>
  )
})
