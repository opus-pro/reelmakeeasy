'use client'

import { MediaPreviewTooltip } from '@shared/ui/artifact-panel'
import type { ReactNode } from 'react'

interface AssetImageTooltipProps {
  alt: string
  children: ReactNode
  src?: string
  triggerClassName?: string
}

/**
 * Asset-flavoured name for `MediaPreviewTooltip`, for the chat panel: mention pills, shot chips,
 * and the narrow tiles the chat column leaves room for, none of which show enough of the asset to
 * read it. The canvas frames the same tiles large enough to read, so its surfaces pass no `src`
 * and render the tile alone - previewing what is already on screen is noise.
 */
export function AssetImageTooltip({
  alt,
  children,
  src,
  triggerClassName,
}: AssetImageTooltipProps) {
  return (
    <MediaPreviewTooltip alt={alt} src={src} triggerClassName={triggerClassName}>
      {children}
    </MediaPreviewTooltip>
  )
}
