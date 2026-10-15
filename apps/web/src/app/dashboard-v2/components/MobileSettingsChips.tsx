'use client'

import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { Button, cn, Popover } from '@shared/ui'
import React, { useState } from 'react'

import {
  Caption,
  CaptionOff,
  CheckMark,
  Ratio11,
  Ratio169,
  Ratio916,
} from '@/components/icons/core'
import type { OmniBoxSettings } from '@/components/omni-chat-box-v2/omni-chat-box.types'
import type { OmniChatBoxRef } from '@/components/omni-chat-box-v2/OmniChatBox'

interface MobileSettingsChipsProps {
  currentSettings: null | OmniBoxSettings
  omniChatBoxRef: React.RefObject<null | OmniChatBoxRef>
  pageType: 'story-mode' | undefined
}

interface PopoverOption {
  icon: React.ReactNode
  key: string
  label: string
  onSelect: () => void
  selected: boolean
}

export function MobileSettingsChips({
  currentSettings,
  omniChatBoxRef,
  pageType,
}: MobileSettingsChipsProps) {
  if (!currentSettings) {
    return null
  }

  const enableAllRatios = pageType === 'story-mode'
  const ratios: AspectRatio[] = enableAllRatios ? ['9:16', '16:9', '1:1'] : ['9:16']

  const ratioOptions: PopoverOption[] = ratios.map((ratio) => ({
    icon: <RatioIcon ratio={ratio} />,
    key: ratio,
    label: ratio,
    onSelect: () => omniChatBoxRef.current?.setAspectRatio(ratio),
    selected: currentSettings.aspectRatio === ratio,
  }))

  const captionOptions: PopoverOption[] = [
    {
      icon: <Caption className="size-[var(--mobile-icon-size)] shrink-0" />,
      key: 'on',
      label: 'Caption is on',
      onSelect: () => omniChatBoxRef.current?.setShowCaptions(true),
      selected: currentSettings.showCaptions,
    },
    {
      icon: <CaptionOff className="size-[var(--mobile-icon-size)] shrink-0" />,
      key: 'off',
      label: 'Caption is off',
      onSelect: () => omniChatBoxRef.current?.setShowCaptions(false),
      selected: !currentSettings.showCaptions,
    },
  ]

  return (
    <div className="flex flex-row gap-2">
      <SettingPopoverChip
        options={ratioOptions}
        title="Aspect ratio"
        triggerIcon={<RatioIcon ratio={currentSettings.aspectRatio} />}
        triggerLabel={currentSettings.aspectRatio}
      />
      <SettingPopoverChip
        className={currentSettings.showCaptions ? undefined : 'text-secondary'}
        options={captionOptions}
        title="Caption"
        triggerIcon={
          currentSettings.showCaptions ? (
            <Caption className="size-[var(--mobile-icon-size)] shrink-0" />
          ) : (
            <CaptionOff className="size-[var(--mobile-icon-size)] shrink-0 text-secondary" />
          )
        }
        triggerLabel={currentSettings.showCaptions ? 'Caption is on' : 'Caption is off'}
      />
    </div>
  )
}

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  if (ratio === '16:9') {
    return <Ratio169 className="size-[var(--mobile-icon-size)] shrink-0" />
  }
  if (ratio === '1:1') {
    return <Ratio11 className="size-[var(--mobile-icon-size)] shrink-0" />
  }
  return <Ratio916 className="size-[var(--mobile-icon-size)] shrink-0" />
}

// A settings pill that opens a modal popover of options anchored to itself,
// mirroring the desktop dropdown rather than the full-screen drawer. Modal so
// taps on options don't fall through to the buttons beneath on touch.
function SettingPopoverChip({
  className,
  options,
  title,
  triggerIcon,
  triggerLabel,
}: {
  className?: string
  options: PopoverOption[]
  title?: string
  triggerIcon: React.ReactNode
  triggerLabel: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      align="start"
      className="w-52 rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-[0px_12px_60px_0px_rgba(0,0,0,0.30)] backdrop-blur-[80px] [-webkit-backdrop-filter:blur(80px)] z-[80]"
      content={
        <div className="flex flex-col" role="menu">
          {title && (
            <span className="px-2.5 pt-1.5 pb-0.5 text-sm font-medium text-secondary">{title}</span>
          )}
          {options.map((option) => (
            <button
              className="flex h-11 w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-base font-medium text-primary transition-colors md:hover:bg-fill-hover md:active:bg-fill-hover"
              key={option.key}
              onClick={() => {
                option.onSelect()
                setOpen(false)
              }}
              role="menuitem"
              type="button"
            >
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.selected && <CheckMark className="size-[var(--mobile-icon-size)] shrink-0" />}
            </button>
          ))}
        </div>
      }
      modal
      onOpenChange={setOpen}
      open={open}
      side="top"
      sideOffset={8}
    >
      <Button
        className={cn(
          'gap-1.5 rounded-full text-base md:hover:bg-white/15 md:active:bg-white/20 flex-1 shrink-0 justify-start',
          className,
        )}
        size="xlg"
        type="button"
      >
        {triggerIcon}
        {triggerLabel}
      </Button>
    </Popover>
  )
}
