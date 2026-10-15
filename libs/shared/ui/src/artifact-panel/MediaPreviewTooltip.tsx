'use client'

import type { ReactNode } from 'react'

import { TransparentImage } from '../primitives'
import Tooltip from '../tooltip'

/**
 * Hover preview (lightbox) for a media thumbnail: shows the full image above the trigger, capped so
 * a large asset stays on screen. The trigger is a `span`, so it can wrap an interactive tile without
 * nesting anything inside a button. With no `src` there is nothing to preview, so it renders the
 * trigger alone.
 */
export function MediaPreviewTooltip({
  alt,
  children,
  src,
  triggerClassName,
}: Readonly<{
  alt: string
  children: ReactNode
  src?: string
  triggerClassName?: string
}>) {
  const triggerClass = triggerClassName ?? 'inline-flex'

  if (!src) {
    return triggerClassName ? <span className={triggerClass}>{children}</span> : <>{children}</>
  }

  return (
    <Tooltip
      className="overflow-hidden rounded-lg border-0 bg-transparent p-0"
      content={
        <div className="relative overflow-hidden rounded-lg border border-white/10 shadow-xl">
          <TransparentImage
            alt={alt}
            className="block max-h-80 min-h-20 min-w-20 max-w-80 object-contain"
            src={src}
          />
        </div>
      }
      side="top"
      sideOffset={8}
    >
      <span className={triggerClass}>{children}</span>
    </Tooltip>
  )
}
