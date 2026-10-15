'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'

import { Chip } from '../Chip'

interface OutdatedCollapseToggleProps {
  interactive?: boolean
  isCollapsed: boolean
  onToggle?: () => void
}

export function OutdatedCollapseToggle({
  isCollapsed,
  interactive = true,
  onToggle,
}: OutdatedCollapseToggleProps) {
  if (!interactive) {
    return (
      <div className="inline-flex shrink-0 items-center gap-4">
        <OutdatedCollapseToggleContent isCollapsed={isCollapsed} />
      </div>
    )
  }

  return (
    <button
      aria-expanded={!isCollapsed}
      className="inline-flex shrink-0 items-center gap-4"
      onClick={onToggle}
      type="button"
    >
      <OutdatedCollapseToggleContent isCollapsed={isCollapsed} />
    </button>
  )
}

function OutdatedCollapseToggleContent({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <>
      <Chip label="Outdated" variant="glass" />
      {isCollapsed ? (
        <ChevronDown className="size-[18px] shrink-0 text-white/60" />
      ) : (
        <ChevronUp className="size-[18px] shrink-0 text-white/60" />
      )}
    </>
  )
}
