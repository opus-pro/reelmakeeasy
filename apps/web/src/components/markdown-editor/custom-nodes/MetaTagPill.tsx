'use client'

import { cn, Tooltip } from '@shared/ui'
import { memo, useState } from 'react'

import { formatSecondsToTime } from '@/util/time-utils'

import { getFileIcon } from '../plugins/MetaTypeaheadPlugin'

import type { ResourceType } from './MetaTagNode'
import { getFileNameWithoutExtension, truncateText } from './utils'

const MAX_NAME_CHAR_LENGTH = 20

export type MetaTagPillProps = {
  duration?: number
  previewUrl?: string
  resourceType?: ResourceType
  tagType: 'meta-tag'
  title: string
}

/**
 * MetaTagPill: A pill component for displaying meta tags with hover preview for images/videos.
 * Used in chat messages and other places where meta tags need to be displayed inline.
 */
export const MetaTagPill = memo(function MetaTagPill({
  duration,
  previewUrl,
  resourceType,
  tagType,
  title,
}: MetaTagPillProps) {
  const [isHovered, setIsHovered] = useState(false)

  const name = getFileNameWithoutExtension(title)
  const truncatedName = truncateText(name, MAX_NAME_CHAR_LENGTH)

  const isImage = resourceType === 'img'
  const isVideo = resourceType === 'video'
  const hasPreview = previewUrl && (isImage || isVideo)
  const FileIcon = getFileIcon(resourceType)

  const pillContent = (
    <span
      className={cn(
        'inline-flex items-center gap-1 border-tertiary border rounded-sm h-6 p-1 mx-0.5 leading-none select-none cursor-default align-middle transition-colors',
        {
          'text-white': tagType === 'meta-tag',
          'bg-fill-hover': isHovered,
        },
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {hasPreview ? (
        <img
          alt={title}
          className="size-4.5 rounded-xxs object-cover"
          crossOrigin="anonymous"
          src={previewUrl}
        />
      ) : tagType === 'meta-tag' ? (
        <FileIcon className="size-4.5 shrink-0" />
      ) : null}
      <span className="truncate max-w-[120px] text-xs">{truncatedName}</span>
    </span>
  )

  // Only wrap with Tooltip if there's a preview
  if (!hasPreview) {
    return <span className="inline align-baseline">{pillContent}</span>
  }

  return (
    <Tooltip
      className="p-0 bg-transparent border-none shadow-none"
      content={
        <div className="relative">
          <img
            alt={title}
            className="block h-[120px] w-auto rounded-lg object-contain"
            crossOrigin="anonymous"
            src={previewUrl}
          />
          {isVideo && duration !== undefined && (
            <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
              {formatSecondsToTime(duration)}
            </span>
          )}
        </div>
      }
      delayDuration={200}
      portal
      side="bottom"
      sideOffset={8}
    >
      <span className="inline align-baseline">{pillContent}</span>
    </Tooltip>
  )
})
