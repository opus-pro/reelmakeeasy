import type { VideoModelCapabilities } from '@shared/types/api/models'
import { Button, cn, Popover, Tooltip } from '@shared/ui'
import { useAtom, useAtomValue } from 'jotai'
import React, { useState } from 'react'

import { videoModelChoiceAtom, type VideoQuality, videoQualityAtom } from '@/atom/home'
import { CheckMark } from '@/components/icons/core'
import { useModels } from '@/hooks/useModels'
import { useIsMobile } from '@/util/browserUtils'

import {
  effectiveQuality,
  effectiveVideoModel,
  offeredQualities,
  qualityNote,
} from './video-choices'

/** Price per second and per minute of video, from the registry, when the model lists one. */
function priceLabel(usdPerSecond: number | undefined): null | string {
  if (usdPerSecond === undefined) return null
  const perMinute = usdPerSecond * 60
  return `$${usdPerSecond}/s · ~$${perMinute.toFixed(2)}/min`
}

/**
 * The resolution transition clips are generated at (480p, 720p, 768p, 1080p),
 * with each option's price, for the clip model in use. Shown only when that
 * model offers a choice of resolutions (`capabilities.resolutions`).
 */
export function VideoQualityButton({
  disabled,
  onOpenChange,
}: {
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [quality, setQuality] = useAtom(videoQualityAtom)
  const modelChoice = useAtomValue(videoModelChoiceAtom)
  const isMobile = useIsMobile()
  const { data: registry } = useModels()
  const modelKey = effectiveVideoModel(registry, modelChoice)
  const capabilities = (modelKey ? registry?.models[modelKey]?.capabilities : undefined) as
    | undefined
    | VideoModelCapabilities
  const offered = offeredQualities(registry, modelKey)
  if (offered.length < 2) return null
  const value = effectiveQuality(offered, quality)

  const renderOption = (option: VideoQuality) => {
    const price = priceLabel(capabilities?.usdPerSecond?.[option])
    return (
      <button
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-primary transition-colors hover:bg-fill-hover"
        key={option}
        onClick={() => {
          setQuality(option)
          setOpen(false)
          onOpenChange?.(false)
        }}
        type="button"
      >
        <span className="flex flex-1 flex-col px-0.5">
          <span className="text-sm font-medium">
            {option}
            <span className="ml-1.5 text-xs font-normal text-secondary">
              {qualityNote(option, offered)}
            </span>
          </span>
          {price && <span className="text-xs text-secondary">{price}</span>}
        </span>
        {value === option && <CheckMark className="size-4.5 shrink-0 text-primary" />}
      </button>
    )
  }

  const popover = (
    <Popover
      align="start"
      className="z-[100] w-52 rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={<div className="flex flex-col">{offered.map(renderOption)}</div>}
      modal={isMobile}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      open={open}
      side="bottom"
      sideOffset={4}
    >
      <Button
        className={cn(
          'h-9.5 min-w-[60px] gap-1.5 rounded-full bg-transparent px-2.5 py-0 text-sm font-medium leading-[17px] text-white transition-colors',
          open ? 'bg-fill-secondary' : 'hover:bg-fill-secondary',
        )}
        disabled={disabled}
      >
        <span>{value}</span>
      </Button>
    </Popover>
  )

  if (isMobile) return popover
  return (
    <Tooltip
      className="z-[100] rounded-xs bg-overlay px-2 py-1 text-primary backdrop-blur-xl"
      content={open ? null : 'Video quality'}
      side="top"
      sideOffset={4}
    >
      {popover}
    </Tooltip>
  )
}
