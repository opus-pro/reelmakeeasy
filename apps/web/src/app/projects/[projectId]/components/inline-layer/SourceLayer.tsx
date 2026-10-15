import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { useProjectId } from '@/contexts/ProjectContext'
import { useFileUrl } from '@/hooks/use-file-url'

import { useSourceData } from '../embedded-block/hooks/useSourceData'

interface LazyImageProps {
  alt: string
  className?: string
  src: string
}

const SourceLayer: React.FC = () => {
  const { projectId } = useProjectId()
  const { parseUrl } = useFileUrl()
  const websiteAssets = useSourceData()

  const INITIAL_BATCH = 24
  const BATCH_SIZE = 24
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(INITIAL_BATCH)
  }, [websiteAssets])

  useEffect(() => {
    if (!sentinelRef.current) {
      return
    }
    if (visibleCount >= websiteAssets.length) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, websiteAssets.length))
        }
      },
      { root: null, rootMargin: '200px', threshold: 0.01 },
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [visibleCount, websiteAssets.length])

  return (
    <div className="h-[70dvh] scrollbar-hide overflow-y-auto pb-6">
      <div className="2xl:columns-4 columns-3 gap-x-6">
        {websiteAssets.length > 0 &&
          projectId &&
          websiteAssets.slice(0, visibleCount).map((asset) => {
            const src = parseUrl(projectId, asset.previewImageUrl || '')
            return (
              <div
                className={cn(
                  'group mb-6 inline-block w-full break-inside-avoid',
                  asset.url && 'cursor-pointer',
                )}
                key={asset.id}
                onClick={() => {
                  if (asset.url) {
                    window.open(asset.url, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                <div className="relative w-full overflow-hidden rounded-xs">
                  {asset.previewImageUrl ? (
                    <LazyImage
                      alt={asset.description || ''}
                      className="block h-auto w-full transition-transform duration-300 ease-out group-hover:scale-110 group-hover:shadow-[0_8px_40px_0_rgba(0,0,0,0.30)]"
                      src={src}
                    />
                  ) : (
                    <div className="aspect-video w-full rounded-xs bg-fill-tertiary" />
                  )}
                </div>
                <div className="mt-2 flex max-w-full flex-col gap-1 text-sm">
                  {asset.name && (
                    <span className="text-primary line-clamp-2 hidden text-lg font-medium leading-6">
                      {asset.name}
                    </span>
                  )}
                  {asset.description && (
                    <span className="text-secondary group-hover:text-primary line-clamp-2 text-sm font-normal leading-6 transition-colors duration-300">
                      {asset.description}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        {visibleCount < websiteAssets.length && <div className="h-1" ref={sentinelRef} />}
      </div>
    </div>
  )
}

const LazyImage: React.FC<LazyImageProps> = ({ src, alt, className }) => {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  return (
    <div className="relative w-full">
      {!errored && (
        <img
          alt={alt}
          className={cn(
            'block h-auto w-full transition-opacity duration-500 ease-out',
            className,
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          loading="lazy"
          onError={() => setErrored(true)}
          onLoad={() => setLoaded(true)}
          src={src}
        />
      )}
      {!loaded && !errored && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xs bg-fill-tertiary">
          <div className="size-4 animate-spin rounded-full border-2 border-transparent border-t-primary border-r-primary opacity-50" />
        </div>
      )}
      {errored && <div className="rounded-xs bg-fill-tertiary min-h-60 w-full" />}
    </div>
  )
}

SourceLayer.displayName = 'SourceLayer'

export default SourceLayer
