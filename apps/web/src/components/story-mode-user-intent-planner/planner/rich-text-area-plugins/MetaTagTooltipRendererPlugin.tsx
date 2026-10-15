'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import {
  type MetaTagTooltipPayload,
  type MetaTagTooltipRenderer,
  registerMetaTagTooltipRenderer,
} from '@/components/markdown-editor/custom-nodes/meta-tag-tooltip-registry'
import { formatSecondsToTime } from '@/util/time-utils'

import { MetaTagTextTooltipContent } from '../MetaTagTextTooltipContent'

export function MetaTagTooltipRendererPlugin({ renderer }: { renderer?: MetaTagTooltipRenderer }) {
  const [editor] = useLexicalComposerContext()
  const resolvedRenderer = renderer ?? defaultMetaTagTooltipRenderer

  useEffect(() => {
    return registerMetaTagTooltipRenderer(editor, resolvedRenderer)
  }, [editor, resolvedRenderer])

  return null
}

function defaultMetaTagTooltipRenderer({
  duration,
  isDragging,
  previewUrl,
  resourceId,
  resourceType,
  resolvedLabel,
  title,
  tooltipPosition,
}: MetaTagTooltipPayload): ReactNode {
  if (isDragging) {
    return null
  }

  const normalizedTitle = title.trim()
  const displayTitle = normalizedTitle || resolvedLabel || resourceId
  const isImage = resourceType === 'img'
  const isVideo = resourceType === 'video'

  return (
    <div
      className="pointer-events-none fixed z-[201]"
      style={{
        left: tooltipPosition.left,
        top: tooltipPosition.top,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {previewUrl && (isImage || isVideo) ? (
        <div className="relative rounded-lg bg-black/80 shadow-lg">
          <img
            alt={displayTitle}
            className="block h-[120px] w-auto rounded-lg object-contain"
            src={previewUrl}
          />
          {isVideo && duration !== undefined ? (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
              {formatSecondsToTime(duration)}
            </span>
          ) : null}
        </div>
      ) : (
        <MetaTagTextTooltipContent text={displayTitle} />
      )}
    </div>
  )
}
