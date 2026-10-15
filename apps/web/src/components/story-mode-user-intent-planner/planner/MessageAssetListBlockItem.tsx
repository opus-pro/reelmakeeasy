'use client'

import { cn } from '@shared/ui'

import { getPlannerEvents, selectAssetEvent } from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'
import type { AssetRef, MessageAssetListBlock } from '../state-types'

import { AssetFallbackBackground } from './AssetFallbackBackground'
import { AssetImageTooltip } from './AssetImageTooltip'
import { AssetPreviewImage } from './AssetPreviewImage'
import { useCanMentionInComposer } from './useCanMentionInComposer'

interface MessageAssetListBlockItemProps {
  block: MessageAssetListBlock
}

const CHIP_CLASSES = 'relative size-18 shrink-0 overflow-hidden rounded-lg bg-white/5'
const FALLBACK_CLASSES =
  'inline-flex max-w-[200px] shrink-0 items-center rounded-lg bg-white/10 px-2 py-1 text-xs leading-[18px] text-white/90'

export function MessageAssetListBlockItem({ block }: MessageAssetListBlockItemProps) {
  const state = usePlannerState()
  const canMention = useCanMentionInComposer()
  // A chip only mentions its asset while a composer exists to mention into, so past
  // that point it keeps its place under the bubble as a plain thumbnail -- not a disabled control,
  // which would still claim a tab stop and announce itself.
  const mention = (assetRef: AssetRef) => getPlannerEvents(state).emit(selectAssetEvent, assetRef)
  const assetRefsWithPreview = block.items.filter((assetRef) => Boolean(assetRef.previewUrl))
  // Chips hang off the user turn above, pulling out of the timeline's 24px gap to sit 8px
  // under the bubble. Scoped to a rendered bubble sibling: MessageBlockItem renders nothing
  // for an upload-only message, so with no bubble to hug the full gap stands.
  return (
    <div className="ml-auto flex w-full max-w-[480px] flex-col items-end [[data-role=user]+&]:-mt-4">
      <div className="scrollbar-thumb-muted-gray flex max-w-full gap-2 overflow-x-auto pb-1">
        {assetRefsWithPreview.length > 0
          ? assetRefsWithPreview.map((assetRef) => (
              // The chip holds its 72px in the scrolling row: the trigger is the flex child, so
              // shrink-0 belongs on it and not only on the tile inside.
              <AssetImageTooltip
                alt={assetRef.label}
                key={`asset-preview-${assetRef.id}-${assetRef.type}`}
                src={assetRef.previewUrl}
                triggerClassName="inline-flex shrink-0"
              >
                {canMention ? (
                  <button
                    className={cn(CHIP_CLASSES, 'cursor-pointer')}
                    onClick={() => mention(assetRef)}
                    type="button"
                  >
                    <AssetChipMedia assetRef={assetRef} />
                  </button>
                ) : (
                  <div className={CHIP_CLASSES}>
                    <AssetChipMedia assetRef={assetRef} />
                  </div>
                )}
              </AssetImageTooltip>
            ))
          : block.items.map((assetRef) =>
              canMention ? (
                <button
                  className={cn(FALLBACK_CLASSES, 'cursor-pointer')}
                  key={`asset-fallback-${assetRef.id}-${assetRef.type}`}
                  onClick={() => mention(assetRef)}
                  type="button"
                >
                  {assetRef.label}
                </button>
              ) : (
                <span
                  className={FALLBACK_CLASSES}
                  key={`asset-fallback-${assetRef.id}-${assetRef.type}`}
                >
                  {assetRef.label}
                </span>
              ),
            )}
      </div>
    </div>
  )
}

/**
 * The chip's visual half, shared by its interactive and inert forms so the two cannot drift.
 * The image is named here, unlike the anchor tiles: the chip shows no text beside it, so this alt
 * is the only thing that names the chip.
 */
function AssetChipMedia({ assetRef }: Readonly<{ assetRef: AssetRef }>) {
  return (
    <>
      <AssetFallbackBackground />
      <AssetPreviewImage
        alt={assetRef.label}
        className="absolute inset-0 size-full rounded-lg object-cover object-center"
        src={assetRef.previewUrl}
      />
    </>
  )
}
