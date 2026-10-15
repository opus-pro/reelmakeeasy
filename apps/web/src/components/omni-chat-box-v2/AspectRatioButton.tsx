import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { Button, cn, Popover, Tooltip } from '@shared/ui'
import React, { useState } from 'react'

import { CheckMark, Ratio11, Ratio169, Ratio916 } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

interface AspectRatioButtonProps {
  /** Appended last on the trigger, so a caller can resize it without forking. */
  className?: string
  disabled?: boolean
  onChange: (ratio: AspectRatio) => void
  onOpenChange?: (open: boolean) => void
  /** 'full' (default) at every breakpoint, or 'sm' from md up. */
  radius?: 'full' | 'sm'
  suppressTooltip?: boolean
  value: AspectRatio
  variant?: 'default' | 'story-bar'
}

// Shared ratio -> icon mapping, reused by other aspect-ratio displays (e.g.
// SummarySettingsChips) so the icon set doesn't drift across call sites.
export function AspectRatioIcon({
  className = 'size-4.5',
  ratio,
}: {
  className?: string
  ratio: AspectRatio
}) {
  switch (ratio) {
    case '1:1': {
      return <Ratio11 className={className} />
    }
    case '16:9': {
      return <Ratio169 className={className} />
    }
    default: {
      return <Ratio916 className={className} />
    }
  }
}

export const AspectRatioButton: React.FC<AspectRatioButtonProps> = ({
  className,
  disabled,
  onChange,
  onOpenChange,
  radius = 'full',
  suppressTooltip = false,
  value,
  variant = 'default',
}) => {
  const [open, setOpen] = useState(false)
  const isStoryBar = variant === 'story-bar'
  const isMobile = useIsMobile()
  const iconClassName = isStoryBar ? 'size-4.5 shrink-0 text-white' : 'size-4.5'

  const renderOption = (ratio: AspectRatio) => (
    <button
      className="h-9.5 px-2.5 rounded-sm text-sm font-medium cursor-pointer hover:bg-fill-hover flex items-center gap-1.5 w-full text-left transition-colors text-primary"
      onClick={() => {
        onChange(ratio)
        setOpen(false)
        onOpenChange?.(false)
      }}
      type="button"
    >
      <AspectRatioIcon className={iconClassName} ratio={ratio} />
      <span className="flex-1 px-0.5">{ratio}</span>
      {value === ratio && <CheckMark className="size-4.5 text-primary" />}
    </button>
  )

  const popover = (
    <Popover
      align="start"
      className={cn(
        'bg-menu-background shadow-none backdrop-blur-2xl w-32 rounded-2xl border-0 p-1.5 text-primary',
        isStoryBar && 'z-[100]',
      )}
      content={
        <div className="flex flex-col">
          {renderOption('9:16')}
          {renderOption('16:9')}
          {renderOption('1:1')}
        </div>
      }
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
          isStoryBar
            ? 'h-9.5 w-[76px] min-w-[76px] gap-1.5 rounded-full bg-transparent px-2.5 py-0 text-sm font-medium leading-[17px] text-white transition-colors'
            : 'h-9 min-w-9 px-2.5 gap-1.5 rounded-full flex items-center justify-center font-medium bg-transparent transition-colors text-primary',
          isStoryBar
            ? open
              ? 'bg-fill-secondary'
              : 'hover:bg-fill-secondary'
            : open
              ? 'bg-fill-secondary text-primary'
              : 'hover:bg-fill-secondary hover:text-primary',
          radius === 'sm' && 'md:rounded-sm',
          className,
        )}
        disabled={disabled}
      >
        <AspectRatioIcon className={iconClassName} ratio={value} />
        <span>{value}</span>
      </Button>
    </Popover>
  )

  // Mobile users see the button directly.
  if (isMobile) {
    return popover
  }

  return (
    <Tooltip
      className={cn(
        'bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1',
        isStoryBar && 'z-[100]',
      )}
      content={open || suppressTooltip ? null : 'Aspect Ratio'}
      side="top"
      sideOffset={4}
    >
      {popover}
    </Tooltip>
  )
}
