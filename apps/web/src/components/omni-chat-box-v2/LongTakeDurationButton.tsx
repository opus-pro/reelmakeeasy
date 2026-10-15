'use client'

import { Button, cn, DropdownMenu, Tooltip } from '@shared/ui'
import React, { useState } from 'react'

import { Clock } from '@/components/icons/core'

/**
 * Default expanded-product options (10-min). Callers should pass their own
 * `optionsSeconds` from `useStoryModeUserLimits().pickerOptionsSeconds`
 * so non-gated users see the legacy 3-min option set instead.
 */
export const LONG_TAKE_DURATION_OPTIONS_SECONDS: Array<null | number> = [
  null,
  60,
  120,
  180,
  240,
  300,
  360,
  420,
  480,
  540,
  600,
]

interface LongTakeDurationButtonProps {
  disabled?: boolean
  onChange: (durationSeconds: null | number) => void
  /**
   * Selectable duration values. Defaults to the full expanded set; pass
   * the user-gated `StoryModeUserLimits.pickerOptionsSeconds` to honor
   * the long-video gate.
   */
  optionsSeconds?: Array<null | number>
  valueSeconds: null | number
  visible: boolean
}

function formatLabel(seconds: null | number): string {
  if (seconds == null) {
    return 'Auto'
  }
  const minutes = seconds / 60
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`
}

export const LongTakeDurationButton: React.FC<LongTakeDurationButtonProps> = ({
  disabled = false,
  onChange,
  optionsSeconds = LONG_TAKE_DURATION_OPTIONS_SECONDS,
  valueSeconds,
  visible,
}) => {
  const [isOpen, setIsOpen] = useState(false)

  if (!visible) {
    return null
  }

  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
      content="Target video duration"
      open={isOpen ? false : undefined}
      side="top"
      sideOffset={8}
    >
      <div>
        <DropdownMenu
          align="center"
          classNames={{
            content:
              'bg-menu-background shadow-none backdrop-blur-[40px] w-44 rounded-2xl border-0 p-1.5 text-primary',
          }}
          items={optionsSeconds.map((seconds) => ({
            type: 'item' as const,
            key: seconds == null ? 'auto' : String(seconds),
            checked: valueSeconds === seconds,
            className:
              'h-[38px] px-2.5 rounded-sm text-sm font-medium data-[highlighted]:bg-fill-hover focus:bg-fill-hover hover:bg-fill-hover data-[highlighted]:text-primary focus:text-primary hover:text-primary cursor-pointer',
            onClick: () => onChange(seconds),
            label: formatLabel(seconds),
          }))}
          onOpenChange={setIsOpen}
          side="top"
        >
          <Button
            className={cn(
              'h-[38px] min-w-[38px] px-2.5 gap-1.5 bg-transparent hover:bg-fill-hover hover:text-primary rounded-full flex items-center justify-center transition-colors text-sm font-medium leading-[17px] text-primary',
              isOpen && 'bg-fill-hover text-primary',
            )}
            disabled={disabled}
          >
            <Clock className="size-[18px] shrink-0" />
            <span className="max-sm:hidden">{formatLabel(valueSeconds)}</span>
          </Button>
        </DropdownMenu>
      </div>
    </Tooltip>
  )
}
