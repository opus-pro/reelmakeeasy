'use client'

import { Tooltip } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { Quotes, Voiceover } from '@/components/icons/core'

import { getRenderStateAtom } from '../state/atoms/planner'
import { getAssetsPoolByIdAtom } from '../state/computed/planner'
import { getPlannerEvents, selectAssetEvent, selectTextEvent } from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'
import type { AssetRef } from '../state-types'

import { AssetImageTooltip } from './AssetImageTooltip'
import { AssetPreviewImage } from './AssetPreviewImage'
import { MetaTagTextTooltipContent } from './MetaTagTextTooltipContent'

// Allow one level of balanced parens inside the previewUrl so CDN URLs with
// "(1)" in the path (from video filenames like "My-Song (1).mp4") don't
// terminate the match early and cause the tag to render as raw text.
const META_TAG_GLOBAL_REGEX =
  /@(vo|img|video|audio|txt|pdf|file|shot)\[([^\]]*)\]\(([^)|]+)(?:\|((?:[^()]|\([^)]*\))*))?\)/g
const TAG_LABEL_MAX_CHARS = 10

interface InlineMessageContentProps {
  anchorAssets?: AssetRef[]
  text: string
  uploadedAssets?: AssetRef[]
}

type InlinePart = InlineTagPart | InlineTextPart

interface InlineTagPart {
  kind: 'tag'
  label: string
  previewUrl?: string
  resourceId: string
  type: 'shot' | AssetRef['type']
}

interface InlineTagPillProps {
  label: string
  latestAssetsById: Map<string, AssetRef>
  messageAssetsById: Map<string, AssetRef>
  previewUrl?: string
  resourceId: string
  type: 'shot' | AssetRef['type']
}

interface InlineTextPart {
  kind: 'text'
  text: string
}

export function hasVisibleInlineMessageContent(text: string): boolean {
  return hasVisibleInlineContent(parseInlineParts(text, new Map()))
}

export function InlineMessageContent({
  anchorAssets = [],
  text,
  uploadedAssets = [],
}: InlineMessageContentProps) {
  const state = usePlannerState()
  const { assetsPool } = useAtomValue(getRenderStateAtom(state))
  const latestAssetsById = useMemo(
    () => new Map(assetsPool.map((asset) => [asset.id, asset] as const)),
    [assetsPool],
  )
  const assetsPoolById = useAtomValue(getAssetsPoolByIdAtom(state))
  const messageAssetsById = useMemo(
    () => new Map([...uploadedAssets, ...anchorAssets].map((asset) => [asset.id, asset] as const)),
    [anchorAssets, uploadedAssets],
  )
  const inlineParts = parseInlineParts(text, assetsPoolById)

  if (!hasVisibleInlineContent(inlineParts)) {
    return null
  }

  return <>{renderInlineParts(inlineParts, messageAssetsById, latestAssetsById)}</>
}

function formatShotLabelFromResourceId(resourceId: string): string {
  const match = resourceId.match(/^shot[_-]?(\d+)$/i)
  if (match?.[1]) {
    return `Shot${match[1]}`
  }
  return 'Shot'
}

function hasVisibleInlineContent(parts: InlinePart[]): boolean {
  return parts.some((part) => part.kind === 'tag' || part.text.length > 0)
}

function InlineTagPill({
  latestAssetsById,
  label,
  messageAssetsById,
  previewUrl,
  resourceId,
  type,
}: InlineTagPillProps) {
  const state = usePlannerState()
  const messageAsset = messageAssetsById.get(resourceId)
  const latestAsset = latestAssetsById.get(resourceId)
  const isAudioType = type === 'audio' || type === 'vo'
  const isTextTag = type === 'txt'
  const shouldRenderLabel = label.trim().length > 0
  const isSelectable =
    isTextTag || (messageAsset && latestAsset && isSameAssetRevision(messageAsset, latestAsset))
  const displayLabel = isTextTag ? truncateLabel(label, TAG_LABEL_MAX_CHARS) : label
  const { stem: labelStem, ext: labelExt } = isTextTag
    ? { stem: displayLabel, ext: '' }
    : splitFileNameForDisplay(displayLabel)
  const tooltipAlt = shouldRenderLabel ? label : type
  const shouldUseTooltip = !isAudioType && Boolean(previewUrl)
  const shouldUseTextTooltip = isTextTag && shouldRenderLabel

  if (isAudioType) {
    return null
  }

  const pillContent = (
    <>
      {isAudioType ? (
        <span className="inline-flex size-[18px] items-center justify-center rounded-[4px] bg-white/10">
          <Voiceover className="size-3 text-white/70" />
        </span>
      ) : previewUrl ? (
        <AssetPreviewImage
          alt={tooltipAlt}
          className="size-[18px] rounded-[4px] object-cover"
          src={previewUrl}
        />
      ) : type === 'shot' || type === 'txt' ? (
        <span className="inline-flex size-[18px] items-center justify-center rounded-[4px] bg-white/10">
          <Quotes className="size-3 text-white/70" />
        </span>
      ) : (
        <span className="uppercase text-white/60">{type}</span>
      )}
      {shouldRenderLabel ? (
        <span className="inline-flex min-w-0 max-w-[120px] items-baseline text-base leading-[26px] tracking-[-0.12px]">
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">{labelStem}</span>
          {labelExt ? <span className="shrink-0 whitespace-nowrap">{labelExt}</span> : null}
        </span>
      ) : null}
    </>
  )

  const pill = isSelectable ? (
    <button
      className="mx-0.5 inline-flex cursor-pointer select-none items-center justify-center gap-1 rounded-[8px] bg-[rgba(255,255,255,0.08)] px-[3px] align-middle text-white"
      onClick={() => {
        if (latestAsset && messageAsset && isSameAssetRevision(messageAsset, latestAsset)) {
          getPlannerEvents(state).emit(selectAssetEvent, latestAsset)
        } else if (isTextTag) {
          getPlannerEvents(state).emit(selectTextEvent, { text: label })
        }
      }}
      type="button"
    >
      {pillContent}
    </button>
  ) : (
    <span className="mx-0.5 inline-flex cursor-default select-none items-center justify-center gap-1 rounded-[8px] bg-[rgba(255,255,255,0.08)] px-[3px] align-middle text-white">
      {pillContent}
    </span>
  )

  if (!shouldUseTooltip) {
    if (!shouldUseTextTooltip) {
      return pill
    }

    return (
      <Tooltip
        className="max-w-none border-0 bg-transparent p-0 shadow-none"
        content={<MetaTagTextTooltipContent text={label} />}
        side="top"
        sideOffset={8}
      >
        <span className="inline align-baseline">{pill}</span>
      </Tooltip>
    )
  }

  return (
    <AssetImageTooltip alt={tooltipAlt} src={previewUrl} triggerClassName="inline align-baseline">
      {pill}
    </AssetImageTooltip>
  )
}

function isSameAssetRevision(messageAsset: AssetRef, latestAsset: AssetRef): boolean {
  if (messageAsset.previewAssetId && latestAsset.previewAssetId) {
    return messageAsset.previewAssetId === latestAsset.previewAssetId
  }
  if (messageAsset.previewUrl && latestAsset.previewUrl) {
    return messageAsset.previewUrl === latestAsset.previewUrl
  }
  return messageAsset.id === latestAsset.id
}

function parseInlineParts(text: string, assetsPoolById: Map<string, AssetRef>): InlinePart[] {
  const parts: InlinePart[] = []
  const regex = new RegExp(META_TAG_GLOBAL_REGEX.source, 'g')
  let cursor = 0
  let match: null | RegExpExecArray

  while ((match = regex.exec(text)) !== null) {
    const [rawTag, type, label, resourceId, previewUrl] = match
    if (match.index > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, match.index) })
    }

    if (type === 'audio' || type === 'vo') {
      cursor = match.index + rawTag.length
      continue
    }

    const previewFromAssets = assetsPoolById.get(resourceId)?.previewUrl
    const normalizedLabel =
      label?.trim() || (type === 'shot' ? formatShotLabelFromResourceId(resourceId) : resourceId)
    parts.push({
      kind: 'tag',
      label: normalizedLabel,
      ...(previewUrl?.trim() || previewFromAssets
        ? { previewUrl: previewUrl?.trim() || previewFromAssets }
        : {}),
      resourceId,
      type: type as 'shot' | AssetRef['type'],
    })

    cursor = match.index + rawTag.length
  }

  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) })
  }

  return parts
}

function renderInlineParts(
  parts: InlinePart[],
  messageAssetsById: Map<string, AssetRef>,
  latestAssetsById: Map<string, AssetRef>,
) {
  return parts.map((part, index) => {
    if (part.kind === 'text') {
      return <span key={`text-${index}`}>{part.text}</span>
    }

    return (
      <InlineTagPill
        key={`tag-${part.resourceId}-${index}`}
        label={part.label}
        latestAssetsById={latestAssetsById}
        messageAssetsById={messageAssetsById}
        previewUrl={part.previewUrl}
        resourceId={part.resourceId}
        type={part.type}
      />
    )
  })
}

function splitFileNameForDisplay(value: string): { ext: string; stem: string } {
  const lastDot = value.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === value.length - 1) {
    return { ext: '', stem: value }
  }
  return { ext: value.slice(lastDot), stem: value.slice(0, lastDot) }
}

function truncateLabel(value: string, maxChars: number): string {
  const chars = Array.from(value)
  if (chars.length <= maxChars) {
    return value
  }
  return `${chars.slice(0, maxChars).join('')}...`
}
