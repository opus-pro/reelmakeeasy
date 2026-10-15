'use client'

import { cn } from '@shared/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Muted, Pause, Play, Sounds } from '@/components/icons/core'
import { formatSecondsToTime } from '@/util/time-utils'

import { useOverlaySeekBar } from './useOverlaySeekBar'

export interface VideoOverlayControlsProps {
  className?: string
  currentTime: number
  duration: number
  /** When true the controls stay visible regardless of hover (e.g. mobile). */
  forceControlsVisible?: boolean
  isMuted?: boolean
  isPlaying: boolean
  /** Omit to hide the mute button (surfaces without a mute source). */
  onMuteToggle?: () => void
  onPause: () => void
  onPlay: () => void
  onSeek: (time: number) => void
  /** Optional non-playback action for the video surface, such as selecting a comment target. */
  onSurfaceClick?: () => void
  /** `compact` fits a small grid tile; see `SIZES`. */
  size?: VideoOverlaySize
  /** Disable when only the explicit play/pause button should control playback. */
  togglePlaybackOnSurfaceClick?: boolean
}

export type VideoOverlaySize = 'compact' | 'default'

/**
 * The two scales this overlay renders at. `default` is the full-width player; `compact` fits a media
 * grid tile (~160-320px wide), where the default bar swallows the frame: buttons and glyphs shrink,
 * the seekbar thins, the body's reserved height and padding tighten, and the timestamp is dropped -
 * at tile width it crowds the two buttons, and a tile is a preview rather than a scrubbing surface.
 *
 * `thumbRadius` (px) must stay half the `thumb` class size: the seekbar clamps the thumb's center
 * to [thumbRadius, 100% - thumbRadius] so the pill sits flush with the track ends at 0% and 100%.
 */
const SIZES = {
  compact: {
    body: 'min-h-16 gap-1.5 px-2 pb-2',
    button: 'size-7',
    centerGlyph: 'size-5',
    centerIcon: 'size-10',
    glyph: 'size-3.5',
    seekbarHeight: 6,
    seekbarIdleHeight: 4,
    showTime: false,
    thumb: 'size-2',
    thumbHitArea: 'p-1.5',
    thumbRadius: 4,
  },
  default: {
    body: 'min-h-[140px] gap-3 px-3 pb-3',
    button: 'size-[38px]',
    centerGlyph: 'size-8',
    centerIcon: 'size-[60px]',
    glyph: 'size-5',
    seekbarHeight: 10,
    seekbarIdleHeight: 6,
    showTime: true,
    thumb: 'size-3',
    thumbHitArea: 'p-2',
    thumbRadius: 6,
  },
} as const

type SizeSpec = (typeof SIZES)[VideoOverlaySize]

const ControlsRow: React.FC<{
  displayTime: number
  duration: number
  isMuted: boolean
  isPlaying: boolean
  onMuteToggle?: () => void
  onToggle: () => void
  size: SizeSpec
  visible: boolean
}> = ({ displayTime, duration, isMuted, isPlaying, onMuteToggle, onToggle, size, visible }) => {
  const buttonClass = cn(
    'flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20',
    size.button,
  )
  const glyphClass = cn(size.glyph, 'text-white')
  return (
    <div
      className="relative z-10 flex items-center gap-4 transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <button
        aria-label={isPlaying ? 'Pause video' : 'Play video'}
        className={buttonClass}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {isPlaying ? (
          <Pause className={glyphClass} />
        ) : (
          <Play className={cn('ml-0.5', glyphClass)} />
        )}
      </button>
      {size.showTime && (
        <p aria-label="Playback time" className="flex-1 text-base font-medium leading-5">
          <span className="text-white">{formatSecondsToTime(displayTime)}</span>
          <span className="text-white/50"> / {formatSecondsToTime(duration)}</span>
        </p>
      )}
      {onMuteToggle && (
        <button
          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
          // With no timestamp filling the middle, `ml-auto` is what pins mute to the right edge.
          className={cn(buttonClass, 'ml-auto')}
          onClick={(e) => {
            e.stopPropagation()
            onMuteToggle()
          }}
        >
          {isMuted ? <Muted className={glyphClass} /> : <Sounds className={glyphClass} />}
        </button>
      )}
    </div>
  )
}

const SeekBar: React.FC<{
  currentTime: number
  duration: number
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, currentTime: number) => void
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  progress: number
  seekbarRef: React.RefObject<HTMLDivElement | null>
  size: SizeSpec
  visible: boolean
}> = ({
  currentTime,
  duration,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  progress,
  seekbarRef,
  size,
  visible,
}) => (
  <div
    aria-label="Seek"
    aria-valuemax={Math.round(duration)}
    aria-valuemin={0}
    aria-valuenow={Math.round(currentTime)}
    className="pointer-events-auto relative z-10 w-full cursor-pointer touch-none rounded-full transition-[background-color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    onKeyDown={(e) => onKeyDown(e, currentTime)}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    ref={seekbarRef}
    role="slider"
    style={{
      backgroundColor: visible ? 'rgba(255,255,255,0.25)' : 'transparent',
      height: `${size.seekbarHeight}px`,
    }}
    tabIndex={0}
  >
    <div
      className="absolute left-0 rounded-full bg-accent-orange transition-[height] duration-200"
      style={{
        height: visible ? '100%' : `${size.seekbarIdleHeight}px`,
        top: '50%',
        transform: 'translateY(-50%)',
        width: `${progress * 100}%`,
      }}
    />
    {visible && (
      <div
        className={cn('absolute top-1/2 cursor-pointer', size.thumbHitArea)}
        style={{
          left: `clamp(${size.thumbRadius}px, ${progress * 100}%, calc(100% - ${size.thumbRadius}px))`,
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div className={cn(size.thumb, 'rounded-full bg-white shadow-sm')} />
      </div>
    )}
  </div>
)

/**
 * The shared on-video player controls overlay: bottom gradient, centered
 * play/pause "pop" icon, orange seekbar, current/total timestamp, and an
 * optional mute toggle. Presentational only - it is driven entirely by props
 * (`currentTime`/`duration`/`isPlaying` + `onPlay`/`onPause`/`onSeek`), so any
 * surface (a `<video>`, the editor canvas player) can mount it over
 * its own media element. Clicking the video area toggles play/pause by default; callers can turn
 * that off and provide a distinct surface action while keeping the bottom controls unchanged.
 */
const VideoOverlayControls: React.FC<VideoOverlayControlsProps> = ({
  className,
  currentTime,
  duration,
  forceControlsVisible = false,
  isMuted = false,
  isPlaying,
  onMuteToggle,
  onPause,
  onPlay,
  onSeek,
  onSurfaceClick,
  size = 'default',
  togglePlaybackOnSurfaceClick = true,
}) => {
  const sizeSpec = SIZES[size]
  const [isHovered, setIsHovered] = useState(false)
  const [centerIconKey, setCenterIconKey] = useState(0)
  const [showCenterIcon, setShowCenterIcon] = useState(false)
  const centerIconTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  const {
    dragTime,
    handleSeekKeyDown,
    handleSeekPointerDown,
    handleSeekPointerMove,
    handleSeekPointerUp,
    isDragging,
    seekbarRef,
  } = useOverlaySeekBar(duration, onSeek)

  useEffect(
    () => () => {
      if (centerIconTimerRef.current) {
        clearTimeout(centerIconTimerRef.current)
      }
    },
    [],
  )

  const flashCenterIcon = useCallback(() => {
    setShowCenterIcon(true)
    setCenterIconKey((k) => k + 1)
    if (centerIconTimerRef.current) {
      clearTimeout(centerIconTimerRef.current)
    }
    centerIconTimerRef.current = setTimeout(() => setShowCenterIcon(false), 700)
  }, [])

  const handleToggle = useCallback(() => {
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
    flashCenterIcon()
  }, [flashCenterIcon, isPlaying, onPause, onPlay])

  const displayTime = isDragging && dragTime !== null ? dragTime : currentTime
  const progress = duration > 0 ? Math.min(displayTime / duration, 1) : 0
  // Paused -> always show controls (so the timestamp/duration is readable on
  // pause,); playing -> hover-reveal. forceControlsVisible pins them
  // on (e.g. mobile).
  const controlsVisible = forceControlsVisible || !isPlaying || isHovered || isDragging
  const handleSurfaceClick =
    onSurfaceClick ?? (togglePlaybackOnSurfaceClick ? handleToggle : undefined)

  return (
    <div
      className={cn(
        'absolute inset-0 z-20',
        handleSurfaceClick ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
      data-controls-visible={controlsVisible}
      data-testid="video-overlay"
      onClick={handleSurfaceClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
        {showCenterIcon && (
          <div
            className={cn(
              'flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm',
              sizeSpec.centerIcon,
            )}
            key={centerIconKey}
            style={{ animation: 'centerIconPop 0.7s ease-out forwards' }}
          >
            {isPlaying ? (
              <Play className={cn('ml-1', sizeSpec.centerGlyph, 'text-white')} />
            ) : (
              <Pause className={cn(sizeSpec.centerGlyph, 'text-white')} />
            )}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div
          className={cn('pointer-events-auto relative flex flex-col justify-end', sizeSpec.body)}
          // No-op outside an embla carousel; in the demo dialog it stops a
          // seekbar drag from also swiping the carousel to the next slide.
          data-no-carousel-drag
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-300"
            style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)',
              opacity: controlsVisible ? 1 : 0,
            }}
          />
          <ControlsRow
            displayTime={displayTime}
            duration={duration}
            isMuted={isMuted}
            isPlaying={isPlaying}
            onMuteToggle={onMuteToggle}
            onToggle={handleToggle}
            size={sizeSpec}
            visible={controlsVisible}
          />
          <SeekBar
            currentTime={displayTime}
            duration={duration}
            onKeyDown={handleSeekKeyDown}
            onPointerDown={handleSeekPointerDown}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={handleSeekPointerUp}
            progress={progress}
            seekbarRef={seekbarRef}
            size={sizeSpec}
            visible={controlsVisible}
          />
        </div>
      </div>
    </div>
  )
}

export default VideoOverlayControls
