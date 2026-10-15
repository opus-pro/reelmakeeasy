'use client'

import { cn } from '@shared/ui'
import { memo, type TransitionEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const FADE_MS = 500
/** Cross-fade when `imageUrl` changes while the backdrop is open (e.g. switching shots). */
const IMAGE_CROSSFADE_MS = 500

export interface BackdropPortalProps {
  className?: string
  imageUrl: string
  open: boolean
}

function ImageStack({ imageUrl, open }: { imageUrl: string; open: boolean }) {
  const [baseUrl, setBaseUrl] = useState(imageUrl)
  const [fadeUrl, setFadeUrl] = useState<null | string>(null)
  const [fadeIn, setFadeIn] = useState(false)
  const committedRef = useRef(imageUrl)

  useEffect(() => {
    if (!open) {
      committedRef.current = imageUrl
      setBaseUrl(imageUrl)
      setFadeUrl(null)
      setFadeIn(false)
      return
    }
    if (imageUrl === committedRef.current) {
      return
    }

    const next = imageUrl
    if (next) {
      const img = new Image()
      img.src = next
    }

    setFadeUrl(next)
    setFadeIn(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFadeIn(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) {
        cancelAnimationFrame(raf2)
      }
    }
  }, [imageUrl, open])

  const handleFadeLayerTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.propertyName !== 'opacity') {
      return
    }
    if (e.target !== e.currentTarget) {
      return
    }
    if (fadeUrl === null || !fadeIn) {
      return
    }
    committedRef.current = fadeUrl
    setBaseUrl(fadeUrl)
    setFadeUrl(null)
    setFadeIn(false)
  }

  const layerClass = 'absolute inset-0 bg-cover bg-center'

  return (
    <div className="absolute inset-0">
      {baseUrl ? (
        <div className={layerClass} style={{ backgroundImage: `url(${baseUrl})` }} />
      ) : (
        <div className="absolute inset-0 bg-background" />
      )}
      {fadeUrl !== null &&
        (fadeUrl ? (
          <div
            className={cn(
              layerClass,
              'transition-opacity ease-in-out-soft',
              fadeIn ? 'opacity-100' : 'opacity-0',
            )}
            onTransitionEnd={handleFadeLayerTransitionEnd}
            style={{
              backgroundImage: `url(${fadeUrl})`,
              transitionDuration: `${IMAGE_CROSSFADE_MS}ms`,
            }}
          />
        ) : (
          <div
            className={cn(
              'absolute inset-0 bg-background transition-opacity ease-in-out-soft',
              fadeIn ? 'opacity-100' : 'opacity-0',
            )}
            onTransitionEnd={handleFadeLayerTransitionEnd}
            style={{ transitionDuration: `${IMAGE_CROSSFADE_MS}ms` }}
          />
        ))}
    </div>
  )
}

/** Full-viewport image (optional) + blurred overlay via `document.body` portal. */
function BackdropPortalComponent({ className, imageUrl, open }: BackdropPortalProps) {
  const [ready, setReady] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => setReady(true), [])

  useEffect(() => {
    if (!ready) {
      return
    }
    if (open) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        if (raf2) {
          cancelAnimationFrame(raf2)
        }
      }
    }
    setVisible(false)
    const t = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(t)
  }, [open, ready])

  if (!ready || !mounted) {
    return null
  }

  return createPortal(
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed inset-0 z-[5] transition-opacity duration-500 ease-in-out-soft',
        visible ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      <ImageStack imageUrl={imageUrl} open={open} />
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl" />
    </div>,
    document.body,
  )
}

export const BackdropPortal = memo(BackdropPortalComponent)
