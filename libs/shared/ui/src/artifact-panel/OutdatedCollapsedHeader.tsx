'use client'

import { FONT_FEATURE_SETTINGS } from './constants'
import { OutdatedCollapseToggle } from './OutdatedCollapseToggle'

interface OutdatedCollapsedHeaderProps {
  isCollapsed: boolean
  label: string
  onToggle: () => void
}

export function OutdatedCollapsedHeader({
  isCollapsed,
  label,
  onToggle,
}: OutdatedCollapsedHeaderProps) {
  return (
    <button
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label} outdated block`}
      className="-m-6 flex w-[calc(100%+48px)] items-center gap-4 rounded-2xl p-6 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)]"
      onClick={onToggle}
      type="button"
    >
      <p
        className="min-w-0 flex-1 truncate text-base font-medium leading-5 text-white/50"
        style={FONT_FEATURE_SETTINGS}
      >
        {label}
      </p>
      <OutdatedCollapseToggle interactive={false} isCollapsed={isCollapsed} onToggle={onToggle} />
    </button>
  )
}
