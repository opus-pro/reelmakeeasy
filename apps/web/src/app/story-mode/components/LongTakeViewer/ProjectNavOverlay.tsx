'use client'

import { Button } from '@shared/ui'

import { ChevronDownSmall, ChevronUpSmall } from '@/components/icons/core'

import { STORY_MODE_ICON_BUTTON_CLASS } from '../../constants'

interface ProjectNavOverlayProps {
  attemptLeave?: (action: () => void) => void
  hasNext: boolean
  hasPrev: boolean
  onNext?: () => void
  onPrev?: () => void
}

export function ProjectNavOverlay({
  attemptLeave = (action) => action(),
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: ProjectNavOverlayProps) {
  return (
    <div className="absolute left-6 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-3">
      <Button
        aria-label="Previous project"
        className={STORY_MODE_ICON_BUTTON_CLASS}
        disabled={!hasPrev}
        onClick={onPrev ? () => attemptLeave(onPrev) : undefined}
        variant="ghost"
      >
        <ChevronUpSmall className="size-5" />
      </Button>
      <Button
        aria-label="Next project"
        className={STORY_MODE_ICON_BUTTON_CLASS}
        disabled={!hasNext}
        onClick={onNext ? () => attemptLeave(onNext) : undefined}
        variant="ghost"
      >
        <ChevronDownSmall className="size-5" />
      </Button>
    </div>
  )
}
