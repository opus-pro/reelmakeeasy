'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import React, { useCallback } from 'react'

import { Caption, CaptionOff } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

interface CaptionTogglePillProps {
  /** Appended last, so a caller can resize the pill without forking it. */
  className?: string
  disabled?: boolean
  onShowCaptionsChange: (show: boolean) => void
  /** 'full' (default) at every breakpoint, or 'sm' from md up. */
  radius?: 'full' | 'sm'
  showCaptions: boolean
}

const CaptionTogglePillComponent: React.FC<CaptionTogglePillProps> = ({
  className,
  disabled = false,
  radius = 'full',
  showCaptions,
  onShowCaptionsChange,
}) => {
  const isMobile = useIsMobile()
  const tooltipContent = isMobile
    ? undefined
    : showCaptions
      ? 'Caption is on, click to turn off'
      : 'Caption is off, click to turn on'

  const handleClick = useCallback(
    () => onShowCaptionsChange(!showCaptions),
    [onShowCaptionsChange, showCaptions],
  )

  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl p-1.5 text-sm"
      content={tooltipContent}
      side="top"
      sideOffset={8}
    >
      <Button
        aria-label={showCaptions ? 'Turn captions off' : 'Turn captions on'}
        aria-pressed={showCaptions}
        className={cn(
          'h-9.5 min-w-9.5 gap-1.5 rounded-full px-2.5 py-0 text-sm font-medium text-primary transition-colors',
          'bg-transparent hover:bg-fill-hover',
          radius === 'sm' && 'md:rounded-sm',
          className,
        )}
        disabled={disabled}
        onClick={handleClick}
      >
        {showCaptions ? (
          <Caption className="size-4.5 shrink-0" />
        ) : (
          <CaptionOff className="size-4.5 shrink-0" />
        )}
        <span className="max-sm:hidden">Caption</span>
      </Button>
    </Tooltip>
  )
}

export const CaptionTogglePill = React.memo(CaptionTogglePillComponent)

export default CaptionTogglePill
