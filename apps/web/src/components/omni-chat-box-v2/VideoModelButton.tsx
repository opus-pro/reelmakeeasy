import { Button, cn, Popover, Tooltip } from '@shared/ui'
import { useAtom } from 'jotai'
import React, { useState } from 'react'

import { videoModelChoiceAtom } from '@/atom/home'
import { CheckMark } from '@/components/icons/core'
import { useModels } from '@/hooks/useModels'
import { useIsMobile } from '@/util/browserUtils'

import { effectiveVideoModel, type VideoModelChoice, videoModelChoices } from './video-choices'

/** "Veo 3.1 Fast (Gemini)" reads as "Veo 3.1 Fast" in the pill. */
const shortLabel = (label: string): string => label.replace(/ \(Gemini\)$/, '')

/**
 * The clip model, when the generation provider offers several (Gemini: Omni
 * Flash, the default and recommended one, then Veo 3.1 Fast, Lite and
 * Standard), each with its starting price. Hidden on fal, which makes every
 * clip with its one transition model.
 */
export function VideoModelButton({
  disabled,
  onOpenChange,
}: {
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [stored, setStored] = useAtom(videoModelChoiceAtom)
  const isMobile = useIsMobile()
  const { data: registry } = useModels()
  const choices = videoModelChoices(registry)
  if (choices.length < 2) return null
  const value = effectiveVideoModel(registry, stored)
  const current = choices.find((choice) => choice.key === value)

  const renderOption = (choice: VideoModelChoice) => (
    <button
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-primary transition-colors hover:bg-fill-hover"
      key={choice.key}
      onClick={() => {
        setStored(choice.key)
        setOpen(false)
        onOpenChange?.(false)
      }}
      type="button"
    >
      <span className="flex flex-1 flex-col px-0.5">
        <span className="text-sm font-medium">
          {shortLabel(choice.label)}
          {choice.recommended && (
            <span className="ml-1.5 text-xs font-normal text-secondary">Recommended</span>
          )}
        </span>
        {choice.price && <span className="text-xs text-secondary">{choice.price}</span>}
      </span>
      {value === choice.key && <CheckMark className="size-4.5 shrink-0 text-primary" />}
    </button>
  )

  const popover = (
    <Popover
      align="start"
      className="z-[100] w-64 rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={<div className="flex flex-col">{choices.map(renderOption)}</div>}
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
        <span>{current ? shortLabel(current.label) : 'Clip model'}</span>
      </Button>
    </Popover>
  )

  if (isMobile) return popover
  return (
    <Tooltip
      className="z-[100] rounded-xs bg-overlay px-2 py-1 text-primary backdrop-blur-xl"
      content={open ? null : 'Clip model'}
      side="top"
      sideOffset={4}
    >
      {popover}
    </Tooltip>
  )
}
