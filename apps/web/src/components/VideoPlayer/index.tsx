'use client'

import { Button, cn } from '@shared/ui'
import React, { forwardRef, useCallback } from 'react'

import { Muted, Pause, Play, Sounds } from '@/components/icons/core'

import { useVideoPlayer, type VideoPlayerRef, type VideoSpacebarHandling } from './useVideoPlayer'
import VideoOverlayControls from './VideoOverlayControls'

export interface VideoPlayerProps {
  /**
   * Accessible name for the focusable player region (`role="group"`), used only
   * in the default `focus` spacebar mode where the container is focusable.
   */
  ariaLabel?: string
  autoPlay?: boolean
  className?: string
  containerClassName?: string
  fetchPriority?: 'auto' | 'high' | 'low'
  iconClassName?: string
  loop?: boolean
  muted?: boolean
  onClick?: () => void
  onEnded?: () => void
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void
  onLoadedMetadata?: (duration: number) => void
  onMutedChange?: (muted: boolean) => void
  onPause?: () => void
  onPlay?: () => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  playWithHoverAction?: boolean
  poster?: string
  preload?: 'auto' | 'metadata' | 'none'
  primitiveVideoPlayerProps?: React.VideoHTMLAttributes<HTMLVideoElement>
  showHoverPlayButton?: boolean
  showPlayButtonWithPause?: boolean
  /**
   * Render the full transport overlay (scrubbable seekbar + timestamp + play/pause,
   * plus a mute toggle when `onMutedChange` is supplied) instead of the hover
   * center play button, driven by this player's own state - no external `<video>` needed.
   */
  showTransportControls?: boolean
  /**
   * How the spacebar toggles playback. Defaults to `focus` (focus-scoped local
   * handler); pass `global` for a page-global listener on a dedicated media
   * surface, or `off` to disable. See {@link VideoSpacebarHandling}.
   */
  spacebarHandling?: VideoSpacebarHandling
  src: string
}

const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  (
    {
      src,
      className = '',
      containerClassName = '',
      ariaLabel = 'Video player',
      autoPlay = false,
      fetchPriority = 'auto',
      loop = false,
      muted = false,
      showHoverPlayButton = true,
      playWithHoverAction = false,
      showPlayButtonWithPause = false,
      showTransportControls = false,
      spacebarHandling = 'focus',
      iconClassName,
      poster,
      preload,
      primitiveVideoPlayerProps,
      onClick,
      onError,
      onPlay,
      onPause,
      onTimeUpdate,
      onLoadedMetadata,
      onEnded,
      onMutedChange,
    },
    ref,
  ) => {
    const { videoRef, state, handlers, controls } = useVideoPlayer({
      src,
      onPlay,
      onPause,
      onTimeUpdate,
      onLoadedMetadata,
      onEnded,
      spacebarHandling,
    })

    // `focus` mode makes the container a focusable region and handles Space
    // locally; `global`/`off` leave the container non-focusable (global uses a
    // window listener in the hook), keeping their DOM identical to before.
    const focusScoped = spacebarHandling === 'focus'

    // Destructure event handlers from primitiveVideoPlayerProps so they can be
    // composed with internal handlers below, rather than overriding them via the
    // spread. Most remaining visual/behavioral props stay in
    // restPrimitiveProps and are spread onto <video>, but explicit top-level
    // component props that are handled separately (for example `poster` and
    // `preload`) take precedence over values passed via primitiveVideoPlayerProps.
    // The two concerns (state management vs. appearance/overrides) are
    // intentionally separated here.
    //
    // TODO: longer-term, consider replacing primitiveVideoPlayerProps with
    // explicit typed props for each supported override so this composition
    // is enforced by the type system rather than a manual destructure.
    const {
      onContextMenu: primitiveOnContextMenu,
      onEnded: primitiveOnEnded,
      onError: primitiveOnError,
      onLoadedData: primitiveOnLoadedData,
      onLoadedMetadata: primitiveOnLoadedMetadata,
      onPause: primitiveOnPause,
      onPlay: primitiveOnPlay,
      onTimeUpdate: primitiveOnTimeUpdate,
      // Destructure visual props that are also explicit component props so that
      // restPrimitiveProps never contains them. Without this, the spread at the
      // end of <video> would override the values set by poster={effectivePoster}
      // and preload={preload}, silently reversing the intended precedence.
      poster: primitivePoster,
      preload: primitivePreload,
      ...restPrimitiveProps
    } = primitiveVideoPlayerProps ?? {}

    const effectivePoster = poster ?? primitivePoster
    const effectivePreload = preload ?? primitivePreload

    // Focus-scoped Space: toggle playback only when the player region itself
    // holds focus. Guarding on target === currentTarget lets the browser's focus
    // routing arbitrate - a focused inner control (mute/play button) keeps Space
    // for its own activation, and sibling players never react to each other.
    const handleContainerKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) {
          return
        }
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault()
          controls.togglePlay()
        }
      },
      [controls.togglePlay],
    )

    // The focusable-region attributes are one unit - present together in `focus`
    // mode, absent otherwise - so they compose or disappear as a group.
    const focusRegionProps = focusScoped
      ? {
          'aria-label': ariaLabel,
          onKeyDown: handleContainerKeyDown,
          role: 'group' as const,
          tabIndex: 0,
        }
      : undefined

    // Handle mute toggle
    const handleMuteToggle = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation() // Prevent triggering video play/pause
        onMutedChange?.(!muted)
      },
      [muted, onMutedChange],
    )

    // Expose methods via ref
    React.useImperativeHandle(
      ref,
      () => ({
        play: controls.play,
        pause: controls.pause,
        seek: controls.seek,
        getCurrentTime: () => videoRef.current?.currentTime ?? state.currentTime,
        getDuration: () => videoRef.current?.duration ?? state.duration,
        getVideoSize: () => ({
          height: videoRef.current?.videoHeight ?? 0,
          width: videoRef.current?.videoWidth ?? 0,
        }),
        isPlaying: () => state.isPlaying,
        setVolume: controls.setVolume,
        getVolume: controls.getVolume,
        setMuted: controls.setMuted,
        getMuted: controls.getMuted,
      }),
      [controls, state, videoRef],
    )

    if (!src) {
      return (
        <div
          className={cn(
            'flex items-center justify-center bg-uiBlack rounded-2xl aspect-[9/16]',
            containerClassName,
          )}
        >
          <div className="text-primary font-medium">Processing...</div>
        </div>
      )
    }

    return (
      <div
        className={cn(
          'relative group',
          // Visible focus ring for the keyboard-focusable region (WCAG 2.4.7).
          focusScoped && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          containerClassName,
        )}
        onClick={
          // When the transport overlay is shown it owns click-to-toggle; binding
          // togglePlay here too would fire a second toggle on the bubbled click.
          showTransportControls ? onClick : showHoverPlayButton ? controls.togglePlay : onClick
        }
        onMouseEnter={() => {
          if (playWithHoverAction) {
            controls.play()
          }
        }}
        onMouseLeave={() => {
          if (playWithHoverAction) {
            controls.pause()
            controls.seek(0)
          }
        }}
        {...focusRegionProps}
      >
        {showHoverPlayButton && !showTransportControls && state.isVideoReady && (
          <VideoPlayerButton
            className={cn(
              'group-hover:block',
              showPlayButtonWithPause && !state.isPlaying && 'block',
            )}
            iconClassName={iconClassName}
            isPlaying={state.isPlaying}
          />
        )}

        {/* Mute toggle button - only shown when onMutedChange is provided and the
            transport overlay (which carries its own mute button) is not shown. */}
        {onMutedChange && !showTransportControls && (
          <Button
            aria-label={muted ? 'Unmute video' : 'Mute video'}
            className={cn(
              'text-primary pointer-events-auto size-8 cursor-pointer rounded-full backdrop-blur-xl transition-all hover:scale-110 bg-[rgba(0,0,0,0.18)]',
              'absolute top-2.5 right-2.5 z-30',
            )}
            onClick={handleMuteToggle}
          >
            {muted ? <Muted className="size-4" /> : <Sounds className="size-4" />}
          </Button>
        )}

        {/* Video element */}
        <video
          autoPlay={autoPlay}
          className={className}
          loop={loop}
          muted={muted}
          poster={effectivePoster}
          preload={effectivePreload}
          {...{ fetchPriority }}
          onContextMenu={(e) => {
            e.preventDefault()
            primitiveOnContextMenu?.(e)
          }}
          onEnded={(e) => {
            handlers.handleEnded()
            primitiveOnEnded?.(e)
          }}
          onError={(e) => {
            handlers.handleError()
            onError?.(e)
            primitiveOnError?.(e)
          }}
          onLoadedData={(e) => {
            handlers.handleLoadedData()
            primitiveOnLoadedData?.(e)
          }}
          onLoadedMetadata={(e) => {
            handlers.handleLoadedMetadata(e)
            primitiveOnLoadedMetadata?.(e)
          }}
          onPause={(e) => {
            handlers.handlePause()
            primitiveOnPause?.(e)
          }}
          onPlay={(e) => {
            handlers.handlePlay()
            primitiveOnPlay?.(e)
          }}
          onTimeUpdate={(e) => {
            handlers.handleTimeUpdate(e)
            primitiveOnTimeUpdate?.(e)
          }}
          playsInline
          ref={videoRef}
          src={src}
          {...restPrimitiveProps}
        >
          Your browser does not support the video tag.
        </video>

        {/* Mounted unconditionally (not gated on isVideoReady, unlike the hover
            button): the overlay's own play button is the only start-playback
            affordance in this mode, and with preload!=auto loadedData does not
            fire until playback begins - gating here would strand a poster-only
            video with no way to start. */}
        {showTransportControls && (
          <VideoOverlayControls
            currentTime={state.currentTime}
            duration={state.duration}
            isMuted={muted}
            isPlaying={state.isPlaying}
            onMuteToggle={onMutedChange ? () => onMutedChange(!muted) : undefined}
            onPause={controls.pause}
            onPlay={controls.play}
            onSeek={controls.seek}
          />
        )}
      </div>
    )
  },
)

VideoPlayer.displayName = 'VideoPlayer'

interface VideoPlayerButtonProps {
  className?: string
  iconClassName?: string
  isPlaying: boolean
  onClick?: () => void
}

export const VideoPlayerButton: React.FC<VideoPlayerButtonProps> =
  React.memo<VideoPlayerButtonProps>(({ className, iconClassName, isPlaying, onClick }) => {
    return (
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2',
          className,
        )}
      >
        <Button
          className={cn(
            'text-primary bg-menu/80 pointer-events-auto size-12 cursor-pointer rounded-full backdrop-blur-xl',
            iconClassName,
          )}
          onClick={onClick}
        >
          {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
        </Button>
      </div>
    )
  })

export { VideoPlayer }

export default VideoPlayer

export { BufferingSpinner } from './BufferingSpinner'
export {
  type BufferingEventHandlers,
  type PlaybackBuffering,
  usePlaybackBuffering,
} from './usePlaybackBuffering'
export type { VideoPlayerRef }
