'use client'

import {
  CAMERA_STYLE_OPTIONS,
  type CameraStyle,
  sanitizeCameraStyle,
} from '@reelmakeeasy/common/long-take/camera-craft'
import { Button, cn, Popover, Tooltip } from '@shared/ui'
import { useAtom } from 'jotai'
import React, { useState } from 'react'

import { cameraStyleAtom } from '@/atom/home'
import { CheckMark } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

const STYLES: CameraStyle[] = ['calm', 'dynamic']

/** How the camera moves in the video's clips: Calm (steady, longer shots) or Dynamic. */
export function CameraStyleButton({
  disabled,
  onOpenChange,
}: {
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [stored, setStyle] = useAtom(cameraStyleAtom)
  const isMobile = useIsMobile()
  const value = sanitizeCameraStyle(stored)

  const renderOption = (option: CameraStyle) => (
    <button
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-primary transition-colors hover:bg-fill-hover"
      key={option}
      onClick={() => {
        setStyle(option)
        setOpen(false)
        onOpenChange?.(false)
      }}
      type="button"
    >
      <span className="flex flex-1 flex-col px-0.5">
        <span className="text-sm font-medium">{CAMERA_STYLE_OPTIONS[option].label}</span>
        <span className="text-xs text-secondary">{CAMERA_STYLE_OPTIONS[option].description}</span>
      </span>
      {value === option && <CheckMark className="size-4.5 shrink-0 text-primary" />}
    </button>
  )

  const popover = (
    <Popover
      align="start"
      className="z-[100] w-64 rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={<div className="flex flex-col">{STYLES.map(renderOption)}</div>}
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
        <span>{CAMERA_STYLE_OPTIONS[value].label}</span>
      </Button>
    </Popover>
  )

  if (isMobile) return popover
  return (
    <Tooltip
      className="z-[100] rounded-xs bg-overlay px-2 py-1 text-primary backdrop-blur-xl"
      content={open ? null : 'Camera style'}
      side="top"
      sideOffset={4}
    >
      {popover}
    </Tooltip>
  )
}
