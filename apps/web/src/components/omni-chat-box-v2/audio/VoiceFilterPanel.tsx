'use client'

import { formatVoiceSpeedLabel } from '@shared/types/api/voice-over-metadata'
import { cn } from '@shared/ui'
import { useRef } from 'react'

import { CheckMark, CrossSmall, SemiArrowRightSmall, SettingsLine } from '@/components/icons/core'

import { type VoiceFilterState } from './useVoiceFilter'

type FilterSubmenu = 'category' | 'gender' | 'speed'

const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

const DROPDOWN_STYLE: React.CSSProperties = {
  background: '#403F3F',
  boxShadow: '0 12px 60px 0 rgba(0, 0, 0, 0.30)',
  backdropFilter: 'blur(40px)',
  WebkitBackdropFilter: 'blur(40px)',
}

type VoiceFilterPanelProps = Pick<
  VoiceFilterState,
  | 'activeFilterCount'
  | 'availableCategories'
  | 'availableSpeeds'
  | 'filterCategory'
  | 'filterContainerRef'
  | 'filterGender'
  | 'filterSpeed'
  | 'handleClearAllFilters'
  | 'isFilterPanelOpen'
  | 'openSubmenu'
  | 'setFilterCategory'
  | 'setFilterGender'
  | 'setFilterSpeed'
  | 'setOpenSubmenu'
  | 'setSortBy'
  | 'sortBy'
  | 'toggleFilterPanel'
>

export function VoiceFilterPanel({
  activeFilterCount,
  availableCategories,
  availableSpeeds,
  filterCategory,
  filterContainerRef,
  filterGender,
  filterSpeed,
  handleClearAllFilters,
  isFilterPanelOpen,
  openSubmenu,
  setFilterCategory,
  setFilterGender,
  setFilterSpeed,
  setOpenSubmenu,
  setSortBy,
  sortBy,
  toggleFilterPanel,
}: VoiceFilterPanelProps) {
  const closeTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  const openRow = (name: FilterSubmenu) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
    }
    setOpenSubmenu(name)
  }

  const scheduleClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = setTimeout(() => setOpenSubmenu(null), 400)
  }

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
    }
  }

  return (
    <div className="relative" ref={filterContainerRef}>
      <button
        aria-label="Filter and sort voices"
        className={cn(
          'relative flex h-[38px] min-w-[38px] shrink-0 items-center justify-center px-2.5 transition-colors',
          'rounded-full md:rounded-sm',
          isFilterPanelOpen
            ? 'bg-white/[0.18]'
            : 'ring-1 ring-inset ring-white/10 hover:ring-0 hover:bg-white/[0.18]',
        )}
        onClick={toggleFilterPanel}
        type="button"
      >
        <SettingsLine className="size-[18px] text-white" />
        {activeFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 overflow-clip items-center justify-center rounded-sm bg-white text-xs font-semibold leading-none text-black">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isFilterPanelOpen && (
        <div
          className={cn(
            'absolute top-[calc(100%+4px)] z-20 w-[215px] overflow-visible rounded-2xl p-1.5',
            'right-0 md:left-0 md:right-auto',
          )}
          style={DROPDOWN_STYLE}
        >
          {/* SORT BY section */}
          <div className="flex h-[28px] items-center px-[10px] py-[6px]">
            <p
              className="text-[12px] font-medium uppercase tracking-wider text-white/40"
              style={FF_STYLE}
            >
              Sort by
            </p>
          </div>
          {(
            [
              { label: 'Sort by trending', value: 'trending' },
              { label: 'Sort by latest', value: 'latest' },
            ] as const
          ).map((opt) => (
            <button
              className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              style={FF_STYLE}
              type="button"
            >
              {opt.label}
              {sortBy === opt.value && <CheckMark className="size-4 shrink-0 text-white" />}
            </button>
          ))}

          {/* FILTERS section */}
          <div className="mt-[6px] border-t border-white/10">
            <div className="flex h-[28px] items-center px-[10px] py-[6px]">
              <p
                className="text-[12px] font-medium uppercase tracking-wider text-white/40"
                style={FF_STYLE}
              >
                Filters
              </p>
            </div>
          </div>

          {/* Gender row */}
          <div
            className="relative"
            onMouseEnter={() => openRow('gender')}
            onMouseLeave={scheduleClose}
          >
            <button
              className={cn(
                'flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.18]',
                openSubmenu === 'gender' && 'bg-white/[0.18]',
              )}
              onClick={() => openRow('gender')}
              style={FF_STYLE}
              type="button"
            >
              <span className="flex-1 text-left">Gender</span>
              <span className="flex items-center gap-1 text-sm text-white/50">
                <span style={FF_STYLE}>
                  {filterGender === 'any'
                    ? 'Any'
                    : filterGender.charAt(0).toUpperCase() + filterGender.slice(1)}
                </span>
                <SemiArrowRightSmall className="size-3.5 shrink-0" />
              </span>
            </button>
            {openSubmenu === 'gender' && (
              <div
                className={cn(
                  'absolute top-0 z-30 min-w-[104px] rounded-2xl p-1.5 md:top-1/2 md:w-[224px] md:-translate-y-1/2',
                  'right-[calc(100%+8px)] w-max md:left-[calc(100%+8px)] md:right-auto',
                )}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
                style={DROPDOWN_STYLE}
              >
                {(
                  [
                    { label: 'Any', value: 'any' },
                    { label: 'Male', value: 'male' },
                    { label: 'Female', value: 'female' },
                  ] as const
                ).map((opt) => (
                  <button
                    className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
                    key={opt.value}
                    onClick={() => {
                      setFilterGender(opt.value)
                      setOpenSubmenu(null)
                    }}
                    style={FF_STYLE}
                    type="button"
                  >
                    {opt.label}
                    {filterGender === opt.value && (
                      <CheckMark className="size-4 shrink-0 text-white" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category row */}
          <div
            className="relative"
            onMouseEnter={() => openRow('category')}
            onMouseLeave={scheduleClose}
          >
            <button
              className={cn(
                'flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.18]',
                openSubmenu === 'category' && 'bg-white/[0.18]',
              )}
              onClick={() => openRow('category')}
              style={FF_STYLE}
              type="button"
            >
              <span className="flex-1 text-left">Category</span>
              <span className="flex items-center gap-1 text-sm text-white/50">
                <span
                  className="max-w-[90px] truncate"
                  style={FF_STYLE}
                  title={filterCategory === 'any' ? undefined : filterCategory}
                >
                  {filterCategory === 'any' ? 'Any' : filterCategory}
                </span>
                <SemiArrowRightSmall className="size-3.5 shrink-0" />
              </span>
            </button>
            {openSubmenu === 'category' && (
              <div
                className={cn(
                  'absolute top-0 z-30 min-w-[128px] overflow-y-auto rounded-2xl p-1.5 md:top-1/2 md:w-[220px] md:-translate-y-1/2 [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-track]:bg-transparent',
                  'right-[calc(100%-24px)] w-max md:left-[calc(100%+8px)] md:right-auto',
                )}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
                style={{ ...DROPDOWN_STYLE, maxHeight: '240px' }}
              >
                <button
                  className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
                  onClick={() => {
                    setFilterCategory('any')
                    setOpenSubmenu(null)
                  }}
                  style={FF_STYLE}
                  type="button"
                >
                  Any
                  {filterCategory === 'any' && <CheckMark className="size-4 shrink-0 text-white" />}
                </button>
                {availableCategories.map((cat) => (
                  <button
                    className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
                    key={cat}
                    onClick={() => {
                      setFilterCategory(cat)
                      setOpenSubmenu(null)
                    }}
                    style={FF_STYLE}
                    type="button"
                  >
                    <span className="mr-2 min-w-0 flex-1 truncate text-left">{cat}</span>
                    {filterCategory === cat && <CheckMark className="size-4 shrink-0 text-white" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Speed row */}
          <div
            className="relative"
            onMouseEnter={() => openRow('speed')}
            onMouseLeave={scheduleClose}
          >
            <button
              className={cn(
                'flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.18]',
                openSubmenu === 'speed' && 'bg-white/[0.18]',
              )}
              onClick={() => openRow('speed')}
              style={FF_STYLE}
              type="button"
            >
              <span className="flex-1 text-left">Speed</span>
              <span className="flex items-center gap-1 text-sm text-white/50">
                <span style={FF_STYLE}>
                  {filterSpeed === 'any' ? 'Any' : formatVoiceSpeedLabel(filterSpeed)}
                </span>
                <SemiArrowRightSmall className="size-3.5 shrink-0" />
              </span>
            </button>
            {openSubmenu === 'speed' && (
              <div
                className={cn(
                  'absolute top-0 z-30 min-w-[112px] rounded-2xl p-[6px] md:top-1/2 md:w-[224px] md:-translate-y-1/2',
                  'right-[calc(100%+8px)] w-max md:left-[calc(100%+8px)] md:right-auto',
                )}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
                style={DROPDOWN_STYLE}
              >
                <button
                  className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
                  onClick={() => {
                    setFilterSpeed('any')
                    setOpenSubmenu(null)
                  }}
                  style={FF_STYLE}
                  type="button"
                >
                  Any
                  {filterSpeed === 'any' && <CheckMark className="size-4 shrink-0 text-white" />}
                </button>
                {availableSpeeds.map((speed) => (
                  <button
                    className="flex h-[38px] w-full items-center justify-between rounded-[10px] px-[10px] text-sm text-white transition-colors hover:bg-white/[0.08]"
                    key={speed}
                    onClick={() => {
                      setFilterSpeed(speed)
                      setOpenSubmenu(null)
                    }}
                    style={FF_STYLE}
                    type="button"
                  >
                    {formatVoiceSpeedLabel(speed)}
                    {filterSpeed === speed && <CheckMark className="size-4 shrink-0 text-white" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear all - shown whenever the badge is visible */}
          {activeFilterCount > 0 && (
            <div className="mt-[6px] border-t border-white/10">
              <button
                className="flex h-[38px] w-full items-center gap-[6px] rounded-[10px] px-[10px] text-sm text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
                onClick={handleClearAllFilters}
                style={FF_STYLE}
                type="button"
              >
                <CrossSmall className="size-[18px] shrink-0" />
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
