'use client'

import { cn, ExternalImage } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

const MAX_RETRIES = 3

interface AssetPreviewImageProps {
  alt: string
  className?: string
  src?: string
}

export function AssetPreviewImage({ alt, className, src }: AssetPreviewImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const prevSrcRef = useRef<string | undefined>(src)

  useEffect(() => {
    if (prevSrcRef.current === src) {
      return
    }
    prevSrcRef.current = src
    setImageLoaded(false)
    setRetryCount(0)
  }, [src])

  if (!src || retryCount > MAX_RETRIES) {
    return null
  }

  return (
    <ExternalImage
      alt={alt}
      className={cn(
        'transition-opacity duration-200',
        imageLoaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
      key={retryCount}
      loading="lazy"
      onError={() => {
        if (retryCount < MAX_RETRIES) {
          setTimeout(() => setRetryCount((c) => c + 1), 2000 * (retryCount + 1))
        }
      }}
      onLoad={() => {
        setImageLoaded(true)
      }}
      src={retryCount === 0 ? src : `${src}?retry=${retryCount}`}
    />
  )
}
