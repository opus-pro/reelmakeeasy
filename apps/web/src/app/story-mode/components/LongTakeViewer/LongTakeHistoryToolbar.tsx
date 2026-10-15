'use client'

import { Button, cn } from '@shared/ui'
import React, { memo } from 'react'

import { Redo, Undo } from '@/components/icons/core'

interface LongTakeHistoryToolbarProps {
  canRedo?: boolean
  canUndo?: boolean
  className?: string
  onRedo?: () => void
  onUndo?: () => void
}

const LongTakeHistoryToolbar: React.FC<LongTakeHistoryToolbarProps> = ({
  canRedo = false,
  canUndo = false,
  className,
  onRedo,
  onUndo,
}) => {
  return (
    <div
      className={cn('flex items-center gap-1', className)}
      data-onboarding-target="editor-history-toolbar"
    >
      <Button
        className={cn(
          'flex size-9.5 items-center justify-center rounded-sm bg-transparent hover:bg-fill-hover',
          !canUndo && 'cursor-not-allowed',
        )}
        disabled={!canUndo}
        onClick={canUndo ? onUndo : undefined}
      >
        <Undo className={cn('size-4.5', canUndo ? 'text-primary' : 'text-tertiary')} />
      </Button>

      <Button
        className={cn(
          'flex size-9.5 items-center justify-center rounded-sm bg-transparent hover:bg-fill-hover',
          !canRedo && 'cursor-not-allowed',
        )}
        disabled={!canRedo}
        onClick={canRedo ? onRedo : undefined}
      >
        <Redo className={cn('size-4.5', canRedo ? 'text-primary' : 'text-tertiary')} />
      </Button>
    </div>
  )
}

LongTakeHistoryToolbar.displayName = 'LongTakeHistoryToolbar'

export default memo(LongTakeHistoryToolbar)
