import { cn, ScrollArea } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'

import { ChevronDownSmall, ChevronUpSmall, Pause, Play } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { formatSecondsToTime } from '@/util/time-utils'

import { editorUiStore } from '../../editor/stores/editor-ui.store'

interface ShotItem {
  id: string
  script: string
  thumbnailUrl?: string
}

interface ShotNavigationPanelProps {
  activeShotId?: string
  className?: string
  currentTime?: number
  disabled?: boolean
  duration?: number
  isPlaying?: boolean
  loading?: boolean
  onShotSelect?: (shot: ShotItem, index: number) => void
  onTogglePlay?: () => void
  shots: ShotItem[]
}

interface VideoControlBarProps {
  currentTime?: number
  duration?: number
  isPlaying?: boolean
  onTogglePlay?: () => void
  shotCount?: number
}

const VideoControlBar = memo(
  ({
    currentTime = 0,
    duration = 0,
    isPlaying = false,
    onTogglePlay,
    shotCount = 0,
  }: VideoControlBarProps) => {
    const currentTimestamp = duration > 0 ? formatSecondsToTime(currentTime) : '--:--'
    const durationTimestamp = duration > 0 ? formatSecondsToTime(duration) : '--:--'

    return (
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-3.5 backdrop-blur-[20px] bg-[rgba(26,26,26,0.3)]">
        <button
          className="flex items-center gap-2 px-1.5 text-secondary cursor-pointer hover:text-primary transition-colors"
          onClick={onTogglePlay}
          type="button"
        >
          {isPlaying ? <Pause className="size-4.5" /> : <Play className="size-4.5" />}
          <span className="text-sm font-medium">{shotCount} Shots</span>
        </button>
        <div className="flex items-center gap-1 font-mono text-xs font-medium text-secondary">
          <span>{currentTimestamp}</span>
          <span>/</span>
          <span>{durationTimestamp}</span>
        </div>
      </div>
    )
  },
)

VideoControlBar.displayName = 'VideoControlBar'

interface KeyboardShortcutHintProps {
  loading?: boolean
}

const KeyboardShortcutHint = memo(({ loading }: KeyboardShortcutHintProps) => {
  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex items-end justify-center gap-1 px-0 py-4',
        loading
          ? 'h-80 bg-gradient-to-b from-transparent to-[var(--bg-background)] to-[70%]'
          : 'backdrop-blur-xl bg-[rgba(26,26,26,0.3)]',
      )}
    >
      <span className="text-sm text-tertiary">Use the keyboard</span>
      <kbd className="flex size-5 items-center justify-center rounded-md bg-fill-tertiary">
        <ChevronUpSmall className="size-3 text-secondary" />
      </kbd>
      <kbd className="flex size-5 items-center justify-center rounded-md bg-fill-tertiary">
        <ChevronDownSmall className="size-3 text-secondary" />
      </kbd>
      <span className="text-sm text-tertiary">to switch shots</span>
    </div>
  )
})

KeyboardShortcutHint.displayName = 'KeyboardShortcutHint'

interface ShotItemRowProps {
  active: boolean
  description: string
  disabled?: boolean
  index: number
  isGenerating?: boolean
  onItemClick: (shotId: string, index: number) => void
  shotId: string
  thumbnailUrl?: string
}

const ShotItemRow = memo(
  ({
    active,
    description,
    disabled,
    index,
    isGenerating,
    onItemClick,
    shotId,
    thumbnailUrl,
  }: ShotItemRowProps) => {
    const handleClick = useCallback(() => {
      onItemClick(shotId, index)
    }, [onItemClick, shotId, index])

    return (
      <div
        className={cn(
          'group flex w-full items-center gap-2 text-left pl-2 pr-4 py-3 rounded-xl transition-colors cursor-pointer',
          active ? 'bg-fill-disabled' : 'hover:bg-fill-disabled',
          disabled && 'pointer-events-none opacity-60',
        )}
        onClick={handleClick}
      >
        <div className="w-5 shrink-0 text-center font-mono text-xs font-medium tracking-tight text-tertiary">
          {index + 1}
        </div>
        <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xs">
          {thumbnailUrl ? (
            <>
              <img
                alt={description}
                className="size-full object-cover"
                crossOrigin="anonymous"
                src={thumbnailUrl}
              />
              {/* Dark overlay - show when not active OR when generating */}
              {(!active || isGenerating) && (
                <div
                  className={cn(
                    'absolute inset-0 bg-black/60 rounded-xs transition-opacity pointer-events-none',
                    !isGenerating && 'group-hover:opacity-0',
                  )}
                />
              )}
              {/* Shimmer effect for generating state */}
              {isGenerating && (
                <div className="absolute inset-0 overflow-hidden rounded-xs pointer-events-none">
                  <div
                    className="absolute top-1/2 left-1/2 w-[300%] h-2/3 blur-sm opacity-15 animate-shimmer-diagonal"
                    style={{
                      background:
                        'linear-gradient(270deg, rgba(255, 255, 255, 0.00) 0%, #FFF 30.81%, #FFF 41%, rgba(255, 255, 255, 0.00) 100%)',
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="bg-fill-tertiary size-full" />
          )}
          {active && (
            <div className="absolute inset-0 rounded-xs border-2 border-primary pointer-events-none" />
          )}
        </div>
        <div className="min-w-0 flex-1 ml-1">
          <p
            className={cn(
              'line-clamp-3 text-base leading-[26px] tracking-tight transition-colors',
              active ? 'text-primary' : 'text-secondary group-hover:text-primary',
            )}
          >
            {description}
          </p>
        </div>
      </div>
    )
  },
)

ShotItemRow.displayName = 'ShotItemRow'

const Skeleton = memo(() => {
  return (
    <>
      {Array.from({ length: 15 }).map((_, i) => (
        <div
          className="flex w-full items-center gap-2 pl-2 pr-4 py-3 rounded-xl"
          key={`shot-skeleton-${i}`}
        >
          <div className="w-5 shrink-0 text-center font-mono text-xs font-medium tracking-tight text-tertiary">
            -
          </div>
          <div className="h-16 w-12 shrink-0 rounded-xs bg-fill-disabled" />
          <div className="min-w-0 flex-1 ml-1 flex flex-col gap-1.5">
            <div
              className="h-4 w-full rounded-md"
              style={{
                background:
                  'linear-gradient(to right, rgba(255,255,255,0.05) 0%, transparent 100%)',
              }}
            />
            <div
              className="h-4 w-3/4 rounded-md"
              style={{
                background:
                  'linear-gradient(to right, rgba(255,255,255,0.05) 0%, transparent 100%)',
              }}
            />
          </div>
        </div>
      ))}
    </>
  )
})

const ShotNavigationPanel = ({
  activeShotId,
  className,
  currentTime,
  disabled,
  duration,
  isPlaying,
  onShotSelect,
  onTogglePlay,
  shots,
  loading,
}: ShotNavigationPanelProps) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const activeItemRef = useRef<HTMLDivElement>(null)
  const generatingShots = useAtomValue(editorUiStore.generatingShots)

  // Convert array to Set for O(1) lookup instead of O(n)
  const generatingShotIds = useMemo(
    () => new Set(generatingShots.map((s) => s.id)),
    [generatingShots],
  )

  useEffect(() => {
    if (activeItemRef.current && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]',
      )
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect()
        const itemRect = activeItemRef.current.getBoundingClientRect()
        const isVisible =
          itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom

        if (!isVisible) {
          activeItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [activeShotId])

  const handleItemClick = useRefCallback((shotId: string, index: number) => {
    const shot = shots.find((s) => s.id === shotId)
    if (shot) {
      onShotSelect?.(shot, index)
    }
  })

  return (
    <div className={cn('flex h-full overflow-hidden', className)}>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <VideoControlBar
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          shotCount={shots.length}
        />
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="flex flex-col gap-1 px-2 py-14">
            {loading || shots.length === 0 ? (
              <Skeleton />
            ) : (
              shots.map((shot, index) => {
                const isActive = shot.id === activeShotId
                const isShotGenerating = generatingShotIds.has(shot.id)
                return (
                  <div key={shot.id} ref={isActive ? activeItemRef : undefined}>
                    <ShotItemRow
                      active={isActive}
                      description={shot.script}
                      disabled={disabled}
                      index={index}
                      isGenerating={isShotGenerating}
                      onItemClick={handleItemClick}
                      shotId={shot.id}
                      thumbnailUrl={shot.thumbnailUrl}
                    />
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
        <KeyboardShortcutHint loading={loading || shots.length === 0} />
      </div>
      <div
        className="h-full w-px shrink-0 bg-gradient-to-b from-transparent via-white/20 to-transparent"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.03) 15%, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.03) 70%, rgba(255,255,255,0.03) 85%, transparent 100%)',
        }}
      />
    </div>
  )
}

export default memo(ShotNavigationPanel)
