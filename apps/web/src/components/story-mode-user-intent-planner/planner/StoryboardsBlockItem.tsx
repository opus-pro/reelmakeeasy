'use client'

import { cn } from '@shared/ui'
import {
  OutdatedCollapsedHeader,
  OutdatedCollapseToggle,
  UpdatedStatusBadge,
} from '@shared/ui/artifact-panel'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useEffect, useState } from 'react'

import {
  formatShotDurationLabel,
  formatShotLabel,
  formatShotTimeRangeLabel,
  getShotDescription,
  getShotSecondsBounds,
} from '@/util/shot-display'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { getPlannerEvents, selectAssetEvent, selectShotEvent } from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'
import type { StoryboardsBlock } from '../state-types'

import { AssetImageTooltip } from './AssetImageTooltip'
import { AssetPreviewImage } from './AssetPreviewImage'
import { isAssetReady } from './assetStatus'
import { useCanMentionInComposer } from './useCanMentionInComposer'

type Shot = StoryboardsBlock['shots'][number]

type ShotAsset = Shot['assets'][number]

interface ShotAssetTagProps {
  asset: ShotAsset
  isReadonly: boolean
  onHoverChange?: (isHovered: boolean) => void
}

interface StoryboardsBlockItemProps {
  block: StoryboardsBlock
  showHeader?: boolean
}

interface StoryboardShotCardProps {
  isReadonly: boolean
  shot: Shot
}

export function getShotSecondaryText(shot: Shot): string {
  const normalized = shot.voiceOver.trim()
  if (!normalized) {
    return ''
  }
  if (normalized.startsWith('VO:') || normalized.startsWith('Script:')) {
    return normalized
  }
  return `VO: ${normalized}`
}

export function getStoryboardDisplayTitle(shotCount: number): string {
  return `Storyboard · ${shotCount} shots`
}

export function hasTextSelectionWithin(container: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) {
    return false
  }
  const { anchorNode, focusNode } = selection
  if (!anchorNode || !focusNode) {
    return false
  }
  return container.contains(anchorNode) && container.contains(focusNode)
}

export function ShotAssetTag({ asset, isReadonly, onHoverChange }: ShotAssetTagProps) {
  const state = usePlannerState()
  const canMention = useCanMentionInComposer()
  // Same rule as the canvas grid and shot list: a non-ready anchor has no image to mention, so its
  // chip is display-only.
  const isSelectable = !isReadonly && canMention && isAssetReady(asset)

  return (
    <AssetImageTooltip alt={asset.label} src={asset.previewUrl}>
      <span
        className={cn(
          'inline-flex h-6 items-center justify-center gap-1 rounded-xs bg-white/5 px-1 transition-colors',
          isSelectable ? 'cursor-pointer hover:bg-white/16' : 'cursor-default',
        )}
        onClick={
          isSelectable
            ? (event) => {
                // The chip sits inside a clickable shot card; swallow the click so the card does
                // not mention the whole shot instead of this one asset.
                event.stopPropagation()
                getPlannerEvents(state).emit(selectAssetEvent, asset)
              }
            : undefined
        }
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        {asset.previewUrl ? (
          <AssetPreviewImage
            alt={asset.label}
            className="size-4.5 rounded-xxs object-cover"
            src={asset.previewUrl}
          />
        ) : (
          <span className="inline-flex size-4.5 items-center justify-center rounded-xxs bg-white/10 text-[10px] uppercase text-white/70">
            {asset.type}
          </span>
        )}
        <span
          className="text-xs font-medium leading-[15px] text-white"
          style={FONT_FEATURE_SETTINGS}
        >
          {asset.label}
        </span>
      </span>
    </AssetImageTooltip>
  )
}

export function StoryboardsBlockItem({ block, showHeader = true }: StoryboardsBlockItemProps) {
  const canMention = useCanMentionInComposer()
  const shotCount = block.shots.length
  const isOutdated = block.blockStatus === 'outdated'
  const [isCollapsed, setIsCollapsed] = useState(isOutdated)
  const isOutdatedCollapsed = isOutdated && isCollapsed
  const displayTitle = getStoryboardDisplayTitle(shotCount)

  useEffect(() => {
    setIsCollapsed(isOutdated)
  }, [block.id, isOutdated])

  if (isOutdatedCollapsed) {
    return (
      <section className="w-full overflow-hidden rounded-[20px] border border-white/10 p-6">
        <OutdatedCollapsedHeader
          isCollapsed={isCollapsed}
          label={displayTitle}
          onToggle={() => setIsCollapsed((value) => !value)}
        />
      </section>
    )
  }

  return (
    <section
      className={
        isOutdated
          ? 'flex w-full flex-col gap-3 rounded-[20px] border border-white/10 p-6'
          : 'flex w-full flex-col gap-3 rounded-2xl border border-transparent bg-[rgba(255,255,255,0.05)] p-6'
      }
    >
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h3
              className="text-lg font-semibold leading-[21.8px] text-[#fafafa]"
              style={FONT_FEATURE_SETTINGS}
            >
              {displayTitle}
            </h3>
            {canMention ? (
              <p
                className="text-sm font-normal leading-[22px] text-white/50"
                style={FONT_FEATURE_SETTINGS}
              >
                Review your storyboard, click shots to mention in chat
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {block.blockStatus === 'updated' ? <UpdatedStatusBadge /> : null}
            {isOutdated ? (
              <OutdatedCollapseToggle
                isCollapsed={isCollapsed}
                onToggle={() => setIsCollapsed((value) => !value)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {isCollapsed ? null : (
        <div className="flex flex-col gap-3">
          {shotCount === 0 ? (
            <p
              className="bg-fill-tertiary text-secondary rounded-2xl p-5 text-sm"
              style={FONT_FEATURE_SETTINGS}
            >
              Storyboard is empty
            </p>
          ) : (
            block.shots.map((shot) => (
              <StoryboardShotCard isReadonly={isOutdated} key={shot.id} shot={shot} />
            ))
          )}
        </div>
      )}
    </section>
  )
}

function getShotTimeLabel(shot: Shot): null | string {
  const bounds = getShotSecondsBounds(shot)
  const timeRangeLabel = formatShotTimeRangeLabel(bounds)
  const durationLabel = formatShotDurationLabel(bounds)
  if (!timeRangeLabel || !durationLabel) {
    return null
  }

  return `${timeRangeLabel} · ${durationLabel}`
}

function StoryboardShotCard({ isReadonly, shot }: StoryboardShotCardProps) {
  const state = usePlannerState()
  const canMention = useCanMentionInComposer()
  const [isCardHovered, setIsCardHovered] = useState(false)
  const [isAssetHovered, setIsAssetHovered] = useState(false)
  const shotLabel = formatShotLabel(shot.shotNumber)
  const description = getShotDescription(shot.title)
  const timeLabel = getShotTimeLabel(shot)
  const voiceOverText = getShotSecondaryText(shot)
  const isSelectable = !isReadonly && canMention
  const shouldShowCardHover = isSelectable && isCardHovered && !isAssetHovered
  const mentionShot = () => getPlannerEvents(state).emit(selectShotEvent, shot)
  const selectionProps = isSelectable
    ? {
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (!hasTextSelectionWithin(event.currentTarget)) {
            mentionShot()
          }
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            mentionShot()
          }
        },
        role: 'button' as const,
        tabIndex: 0,
      }
    : {}

  return (
    <article
      className={cn(
        'flex w-full items-end rounded-2xl border p-5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelectable ? 'cursor-pointer' : 'cursor-default',
        shouldShowCardHover ? 'border-white/10 bg-white/8' : 'border-transparent bg-white/5',
      )}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => {
        setIsCardHovered(false)
        setIsAssetHovered(false)
      }}
      {...selectionProps}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1">
              <div className="flex items-center justify-between gap-1 sm:justify-normal">
                <span className="inline-flex h-6 items-center justify-center rounded-[8px] bg-[rgba(255,255,255,0.05)] px-1">
                  <span
                    className="text-xs font-medium leading-[15px] text-white"
                    style={FONT_FEATURE_SETTINGS}
                  >
                    {shotLabel}
                  </span>
                </span>
                {timeLabel ? (
                  <span
                    className="text-xs font-medium leading-[15px] text-[rgba(255,255,255,0.52)] sm:hidden"
                    style={FONT_FEATURE_SETTINGS}
                  >
                    {timeLabel}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {shot.assets.map((asset) => (
                  <ShotAssetTag
                    asset={asset}
                    isReadonly={isReadonly}
                    key={`shot-asset-${shot.id}-${asset.id}`}
                    onHoverChange={setIsAssetHovered}
                  />
                ))}
              </div>
            </div>
            {timeLabel ? (
              <span
                className="hidden shrink-0 text-xs font-medium leading-[15px] text-[rgba(255,255,255,0.52)] sm:block"
                style={FONT_FEATURE_SETTINGS}
              >
                {timeLabel}
              </span>
            ) : null}
          </div>

          <p
            className="text-base leading-[26px] tracking-[-0.12px] text-white"
            style={FONT_FEATURE_SETTINGS}
          >
            {description}
          </p>
          {voiceOverText ? (
            <p
              className="text-base leading-[26px] tracking-[-0.12px] text-[rgba(255,255,255,0.52)]"
              style={FONT_FEATURE_SETTINGS}
            >
              {voiceOverText}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}
