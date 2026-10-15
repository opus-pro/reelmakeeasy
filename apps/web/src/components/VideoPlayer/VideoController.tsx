import { Button, cn, Slider } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Muted, Pause, Play, Sounds } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { formatSecondsToTime } from '@/util/time-utils'

export interface ShotSegment {
  fallbackThumbnailUrl: string
  id: string
  thumbnailUrl: string
  timeRange: { end: number; start: number }
}

interface VideoControllerProps {
  className?: string
  currentTime: number
  disabled?: boolean
  duration: number
  isMuted?: boolean
  isPlaying: boolean
  onMuteToggle?: () => void
  onPause: () => void
  onPlay: () => void
  onSeek: (time: number) => void
  shots?: ShotSegment[]
  showPlayButton?: boolean
}

const ThumbnailPreview = ({
  thumbnailLeft,
  thumbnailShot,
  thumbnailShotIndex,
  visible,
}: {
  thumbnailLeft: number
  thumbnailShot: null | ShotSegment | undefined
  thumbnailShotIndex: number
  visible: boolean
}) => {
  if (!thumbnailShot || !visible) {
    return null
  }

  return (
    <div
      className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-20"
      style={{ left: thumbnailLeft }}
    >
      <div className="relative w-[90px] h-[160px] rounded-md overflow-hidden shadow-[0px_8px_24px_0px_rgba(0,0,0,0.4)]">
        <img
          alt={`Shot ${thumbnailShotIndex + 1}`}
          className="size-full object-cover"
          crossOrigin="anonymous"
          onError={(e) => {
            if (
              thumbnailShot.fallbackThumbnailUrl &&
              e.currentTarget.src !== thumbnailShot.fallbackThumbnailUrl
            ) {
              e.currentTarget.src = thumbnailShot.fallbackThumbnailUrl
            }
          }}
          src={thumbnailShot.thumbnailUrl}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-[63%] to-black/60" />
        {/* Shot label */}
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-sm font-medium leading-[17px] text-primary whitespace-nowrap">
          SHOT {thumbnailShotIndex + 1}
        </span>
      </div>
    </div>
  )
}

const ShotProgressTrack = ({
  displayTime,
  duration,
  isActive,
  shots,
}: {
  displayTime: number
  duration: number
  isActive: boolean
  shots: ShotSegment[]
}) => {
  return (
    <div
      className={cn(
        'absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center rounded-xl overflow-hidden transition-[height]',
        isActive ? 'h-2' : 'h-1',
      )}
    >
      {shots.map((shot) => {
        const shotDuration = shot.timeRange.end - shot.timeRange.start
        const widthPercent = duration > 0 ? (shotDuration / duration) * 100 : 0
        const shotStart = shot.timeRange.start
        const shotEnd = shot.timeRange.end
        const isFullyPlayed = displayTime >= shotEnd
        const isPartiallyPlayed = displayTime > shotStart && displayTime < shotEnd
        const playedPercent = isPartiallyPlayed
          ? ((displayTime - shotStart) / shotDuration) * 100
          : 0

        return (
          <div
            className={cn('relative h-full', isActive ? 'bg-white/50' : 'bg-fill-tertiary')}
            key={shot.id}
            style={{ width: `${widthPercent}%` }}
          >
            <div
              className={cn(
                'absolute inset-y-0 left-0 transition-colors',
                isActive ? 'bg-white' : 'bg-white/50',
              )}
              style={{
                width: isFullyPlayed ? '100%' : isPartiallyPlayed ? `${playedPercent}%` : 0,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

const useVideoScrubber = (
  duration: number,
  disableControl: boolean,
  onSeek: (time: number) => void,
) => {
  const [isDragging, setIsDragging] = useState(false)
  const [dragTime, setDragTime] = useState<null | number>(null) // Local time during drag for instant feedback
  const [hoverTime, setHoverTime] = useState<null | number>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [isHovering, setIsHovering] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)

  const handleProgressMouseLeave = useRefCallback(() => {
    setHoverTime(null)
    setIsHovering(false)
  })

  const handleProgressMouseEnter = useRefCallback(() => {
    setIsHovering(true)
  })

  const updateHoverFromClientX = useRefCallback((clientX: number) => {
    if (!progressRef.current || !duration) {
      return null
    }
    const rect = progressRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    const nextTime = percentage * duration
    setHoverTime(nextTime)
    // Clamp hoverX to keep thumbnail within bounds (45px padding for 90px thumbnail)
    const minX = 45
    const maxX = rect.width - 45
    setHoverX(Math.max(minX, Math.min(maxX, x)))
    return nextTime
  })

  const handlePointerDown = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disableControl) {
      return
    }
    setIsDragging(true)
    // Capture pointer to receive events even when moving outside
    e.currentTarget.setPointerCapture(e.pointerId)
    const time = updateHoverFromClientX(e.clientX)
    if (time !== null) {
      setDragTime(time) // Instant visual update
      onSeek(time)
    }
  })

  const handlePointerMove = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const time = updateHoverFromClientX(e.clientX)
    // If dragging, seek to position
    if (isDragging && time !== null) {
      setDragTime(time) // Instant visual update
      onSeek(time)
    }
  })

  const handlePointerUp = useRefCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false)
      setDragTime(null) // Clear drag time, fall back to actual currentTime
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  })

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      setIsDragging(false)
      setDragTime(null)
    }

    window.addEventListener('pointerup', handleGlobalPointerUp)
    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp)
    }
  }, [])

  return {
    dragTime,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleProgressMouseEnter,
    handleProgressMouseLeave,
    hoverTime,
    hoverX,
    isDragging,
    isHovering,
    progressRef,
    setDragTime,
    setHoverTime,
    setIsDragging,
  }
}

interface VideoProgressSectionProps {
  currentTime: number
  disableControl: boolean
  displayTime: number
  duration: number
  handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  handleProgressMouseEnter: () => void
  handleProgressMouseLeave: () => void
  hasShots: boolean
  hoverTime: null | number
  isActive: boolean
  isDragging: boolean
  onSeek: (time: number) => void
  progressRef: React.RefObject<HTMLDivElement | null>
  setIsDragging: (isDragging: boolean) => void
  shots: ShotSegment[] | undefined
  thumbnailLeft: number
  thumbnailShot: null | ShotSegment | undefined
  thumbnailShotIndex: number
  thumbPosition: number
}

const VideoProgressSection = ({
  currentTime,
  disableControl,
  displayTime,
  duration,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handleProgressMouseEnter,
  handleProgressMouseLeave,
  hasShots,
  hoverTime,
  isActive,
  isDragging,
  onSeek,
  progressRef,
  setIsDragging,
  shots,
  thumbnailLeft,
  thumbnailShot,
  thumbnailShotIndex,
  thumbPosition,
}: VideoProgressSectionProps) => {
  if (hasShots) {
    return (
      <div className="relative w-full">
        <ThumbnailPreview
          thumbnailLeft={thumbnailLeft}
          thumbnailShot={thumbnailShot}
          thumbnailShotIndex={thumbnailShotIndex}
          visible={hoverTime !== null || isDragging}
        />
        <div
          className={cn(
            'relative h-6 cursor-pointer touch-none',
            disableControl && 'opacity-50 cursor-not-allowed',
          )}
          onMouseEnter={handleProgressMouseEnter}
          onMouseLeave={handleProgressMouseLeave}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={progressRef}
        >
          <ShotProgressTrack
            displayTime={displayTime}
            duration={duration}
            isActive={isActive}
            shots={shots || []}
          />
          {/* Thumb - outside overflow hidden container */}
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 pointer-events-none bg-white rounded-full shadow-sm transition-[width,height]',
              isDragging ? 'size-4' : isActive ? 'size-3' : 'size-2',
            )}
            style={{ left: `${thumbPosition}%` }}
          />
        </div>
      </div>
    )
  }

  if (duration > 0) {
    return (
      <Slider
        disabled={disableControl}
        max={duration}
        min={0}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onValueChange={(value) => {
          onSeek(value[0])
        }}
        rangeClassName="rounded-l-none rounded-r-full"
        thumbClassName={cn(
          isDragging ? 'size-4' : 'size-3',
          'bg-white rounded-full cursor-pointer shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 relative z-10 transition-all',
        )}
        trackClassName="h-[5px] bg-fill-hover"
        value={[currentTime]}
      />
    )
  }

  return <div className="h-2 w-full rounded-full bg-white/10" />
}

const VideoController: React.FC<VideoControllerProps> = ({
  className,
  duration,
  currentTime,
  isPlaying,
  isMuted = false,
  onMuteToggle,
  onPlay,
  onPause,
  onSeek,
  disabled,
  shots,
  showPlayButton = false,
}: VideoControllerProps) => {
  const disableControl = useMemo(() => {
    return disabled || !duration
  }, [duration, disabled])

  const {
    dragTime,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleProgressMouseEnter,
    handleProgressMouseLeave,
    hoverTime,
    hoverX,
    isDragging,
    isHovering,
    progressRef,
    setIsDragging,
  } = useVideoScrubber(duration, !!disableControl, onSeek)

  // Active state: hovering or dragging
  const isActive = isHovering || isDragging

  // Use drag time during dragging for instant feedback, otherwise use actual currentTime
  const displayTime = isDragging && dragTime !== null ? dragTime : currentTime

  const currentTimestamp = useMemo(
    () => (duration > 0 ? formatSecondsToTime(displayTime || 0) : '--:--'),
    [displayTime, duration],
  )
  const durationTimestamp = useMemo(
    () => (duration > 0 ? formatSecondsToTime(duration) : '--:--'),
    [duration],
  )

  const hasShots = !!(shots && shots.length > 0)

  const currentShotIndex = useMemo(() => {
    if (!hasShots || !shots) {
      return -1
    }
    return shots.findIndex(
      (shot) => displayTime >= shot.timeRange.start && displayTime < shot.timeRange.end,
    )
  }, [hasShots, shots, displayTime])

  const hoverShotIndex = useMemo(() => {
    if (!hasShots || !shots || hoverTime === null) {
      return -1
    }
    return shots.findIndex(
      (shot) => hoverTime >= shot.timeRange.start && hoverTime < shot.timeRange.end,
    )
  }, [hasShots, shots, hoverTime])

  // Shot to display in thumbnail: use current shot during drag, otherwise hover shot
  const thumbnailShotIndex = isDragging ? currentShotIndex : hoverShotIndex
  const thumbnailShot = thumbnailShotIndex >= 0 ? shots?.[thumbnailShotIndex] : null

  const onTogglePlay = () => {
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
  }

  // Thumb position as percentage - directly from displayTime for instant feedback
  const thumbPosition = duration > 0 ? (displayTime / duration) * 100 : 0

  const thumbnailLeft = hoverX

  return (
    <div className={cn('relative flex w-full flex-col pt-3 pb-4', className)}>
      {/* Row 1: Progress Track */}
      <div className="relative w-full">
        <VideoProgressSection
          currentTime={currentTime}
          disableControl={!!disableControl}
          displayTime={displayTime}
          duration={duration}
          handlePointerDown={handlePointerDown}
          handlePointerMove={handlePointerMove}
          handlePointerUp={handlePointerUp}
          handleProgressMouseEnter={handleProgressMouseEnter}
          handleProgressMouseLeave={handleProgressMouseLeave}
          hasShots={hasShots}
          hoverTime={hoverTime}
          isActive={isActive}
          isDragging={isDragging}
          onSeek={onSeek}
          progressRef={progressRef}
          setIsDragging={setIsDragging}
          shots={shots}
          thumbnailLeft={thumbnailLeft}
          thumbnailShot={thumbnailShot}
          thumbnailShotIndex={thumbnailShotIndex}
          thumbPosition={thumbPosition}
        />
      </div>

      {/* Row 2: Controls - Play button, Time/Label, Volume */}
      <div className="flex items-center justify-start gap-4">
        {/* Left: Play button (optional) */}
        {showPlayButton && (
          <div className="flex items-center gap-2">
            <Button
              className="hover:bg-fill-hover size-8 flex items-center justify-center bg-transparent rounded-sm"
              disabled={!!disableControl}
              onClick={onTogglePlay}
              size="icon"
            >
              {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
            </Button>
          </div>
        )}

        {/* Time display - left aligned */}
        <div className="flex items-center shrink-0 select-none text-primary">
          <span className="text-sm font-medium leading-[17px] text-right tabular-nums">
            {currentTimestamp}
          </span>
          <div className="mx-1">/</div>
          <span className="text-sm font-medium leading-[17px] text-left tabular-nums">
            {durationTimestamp}
          </span>
        </div>

        {onMuteToggle && (
          <div className="flex items-center gap-2 text-secondary ml-auto">
            <Button
              className="hover:bg-fill-secondary size-8 flex items-center justify-center bg-transparent"
              onClick={onMuteToggle}
              size="icon"
            >
              {isMuted ? <Muted className="size-5" /> : <Sounds className="size-5" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoController
