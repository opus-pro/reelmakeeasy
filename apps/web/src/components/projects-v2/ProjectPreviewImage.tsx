'use client'

import { Button } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

const IMAGE_AUTO_RETRY_MAX = 3
const IMAGE_AUTO_RETRY_DELAY_MS = 250

/**
 * Thumbnail `<img>` for a projects-v2 grid card: auto-retries a transient load failure up to
 * `IMAGE_AUTO_RETRY_MAX` times, then swaps in a manual "Refresh image" button. Shared by
 * `ProjectListCardV2` so every card recovers from a slow/broken CDN
 * URL the same way instead of drifting into separate implementations.
 */
export function ProjectPreviewImage({ alt, src }: { alt: string; src: string }) {
  return <ProjectPreviewImageWithSrc alt={alt} key={src} src={src} />
}

function ProjectPreviewImageWithSrc({ alt, src }: { alt: string; src: string }) {
  const [autoRetryAttempt, setAutoRetryAttempt] = useState(0)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [showManualRefresh, setShowManualRefresh] = useState(false)
  const retryTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  const retrySrc = useMemo(() => {
    if (!src) {
      return src
    }
    if (refreshNonce === 0) {
      return src
    }

    const [base, hash = ''] = src.split('#')
    const separator = base.includes('?') ? '&' : '?'
    const hashSuffix = hash ? `#${hash}` : ''
    return `${base}${separator}retry=${refreshNonce}${hashSuffix}`
  }, [refreshNonce, src])

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
      }
    }
  }, [])

  if (showManualRefresh) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Button
          className="h-7 rounded-md border border-white/20 bg-black/50 px-2 text-xs text-white hover:bg-black/70"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (retryTimerRef.current) {
              clearTimeout(retryTimerRef.current)
              retryTimerRef.current = null
            }
            setShowManualRefresh(false)
            setAutoRetryAttempt(0)
            setRefreshNonce((prev) => prev + 1)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Refresh image
        </Button>
      </div>
    )
  }

  return (
    <img
      alt={alt}
      className="absolute inset-0 size-full object-contain"
      onError={() => {
        if (autoRetryAttempt >= IMAGE_AUTO_RETRY_MAX) {
          setShowManualRefresh(true)
          return
        }
        if (retryTimerRef.current) {
          return
        }
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          setAutoRetryAttempt((prev) => prev + 1)
          setRefreshNonce((prev) => prev + 1)
        }, IMAGE_AUTO_RETRY_DELAY_MS)
      }}
      src={retrySrc}
    />
  )
}
