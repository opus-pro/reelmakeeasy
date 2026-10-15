import { isActiveElementEditing } from '@shared/ui/lib/is-active-element-editing'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * How the spacebar drives play/pause.
 * - `focus` (default): a focus-scoped local handler on the player region. Space
 *   toggles only while focus is within the player, so it never steals Space from
 *   a focused `<button>` and never dogpiles across sibling players. Correct
 *   default for a shared primitive.
 * - `global`: a page-global `window` listener (the legacy behavior). Toggles on
 *   any Space press outside an editable field. Reserve for a single dedicated
 *   media surface - multiple global players on one page fight over the key.
 * - `off`: no spacebar handling at all.
 */
export type VideoSpacebarHandling = 'focus' | 'global' | 'off'

/**
 * Explicitly clears a video element's source and forces the browser to
 * discard the decoded buffer. Called on unmount to prevent cumulative memory
 * growth in gallery views where many <video> elements cycle in and out.
 *
 * Exported so it can be unit-tested in isolation without needing a rendered
 * component or a real DOM element.
 */
export interface VideoPlayerRef {
  getCurrentTime: () => number
  getDuration: () => number
  getMuted: () => boolean
  getVideoSize: () => { height: number; width: number }
  getVolume: () => number
  isPlaying: () => boolean
  pause: () => void
  play: () => Promise<void> | void
  seek: (time: number) => void
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
}

interface UseVideoPlayerOptions {
  onEnded?: () => void
  onLoadedMetadata?: (duration: number) => void
  onPause?: () => void
  onPlay?: () => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  spacebarHandling?: VideoSpacebarHandling
  src?: string
}

interface VideoPlayerState {
  currentTime: number
  duration: number
  isPlaying: boolean
  isVideoReady: boolean
}
export function releaseVideoBuffer(video: HTMLVideoElement | null): void {
  if (!video) {
    return
  }
  video.pause()
  video.removeAttribute('src')
  video.load()
}

export const useVideoPlayer = (options: UseVideoPlayerOptions = {}) => {
  const {
    src,
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onLoadedMetadata,
    spacebarHandling = 'focus',
  } = options

  const videoRef = useRef<HTMLVideoElement>(null)

  const [state, setState] = useState<VideoPlayerState>({
    isPlaying: false,
    isVideoReady: false,
    currentTime: 0,
    duration: 0,
  })

  // Force Chrome to release its video buffer on unmount. Without this,
  // detached <video> elements linger in memory until GC runs, causing
  // cumulative growth every scroll pass in gallery views.
  //
  // Capture the element at setup time: React clears object refs before passive-effect
  // cleanups run during unmount, so videoRef.current would be null in the cleanup.
  //
  // Always assign video.src imperatively on mount and src change. Safari requires
  // the property assignment (not just the React-set attribute) to properly run its
  // media resource selection algorithm before play() will succeed. With preload='none'
  // (all gallery cards) there is no network cost; no fetch begins until play() is
  // called. The previous getAttribute() guard that skipped this on initial mount
  // caused Safari to silently reject play(), freezing the card state machine before
  // hoverPreviewReady could ever fire.
  useEffect(() => {
    const video = videoRef.current
    if (video && src) {
      video.src = src
    }
    setState((prev) =>
      prev.isPlaying || prev.isVideoReady || prev.currentTime !== 0 || prev.duration !== 0
        ? { isPlaying: false, isVideoReady: false, currentTime: 0, duration: 0 }
        : prev,
    )
    return () => releaseVideoBuffer(video)
  }, [src])

  // Event handlers
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const target = e.currentTarget
    if (!target) {
      return
    }

    const time = target.currentTime || 0
    const duration = target.duration || state.duration
    setState((prev) => ({ ...prev, currentTime: time }))
    onTimeUpdate?.(time, duration)
  }

  const handleEnded = () => {
    setState((prev) => ({ ...prev, isPlaying: false }))
    onEnded?.()
  }

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const target = e.currentTarget
    if (!target) {
      return
    }
    const d = target.duration || 0
    const time = target.currentTime || 0
    setState((prev) => ({ ...prev, duration: d, currentTime: time }))
    onLoadedMetadata?.(d)
  }

  const handleLoadedData = () => {
    setState((prev) => ({ ...prev, isVideoReady: true }))
  }

  const handlePlay = () => {
    setState((prev) => ({ ...prev, isPlaying: true }))
    onPlay?.()
  }

  const handlePause = () => {
    setState((prev) => ({ ...prev, isPlaying: false }))
    onPause?.()
  }

  const handleError = () => {
    // no-op: callers manage error state via the onError prop
  }

  const togglePlay = useCallback(() => {
    if (!videoRef.current) {
      return
    }
    if (state.isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
  }, [state.isPlaying])

  const play = useCallback(() => {
    return videoRef.current?.play() || Promise.resolve()
  }, [])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const seek = useCallback(
    (time: number) => {
      if (videoRef.current && state.duration > 0) {
        const seekTime = Math.min(state.duration, Math.max(0, time))
        try {
          videoRef.current.currentTime = seekTime
          setState((prev) => ({ ...prev, currentTime: seekTime }))
        } catch {
          // Setting currentTime can rarely throw when the media is not seekable
          // yet (e.g. a seek fired mid-load). Leave state unchanged: a benign
          // race with no user-facing impact.
        }
      }
    },
    [state.duration],
  )

  const setVolume = useCallback((volume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = Math.max(0, Math.min(1, volume))
    }
  }, [])

  const getVolume = useCallback(() => {
    return videoRef.current?.volume ?? 1
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    if (videoRef.current) {
      videoRef.current.muted = muted
    }
  }, [])

  const getMuted = useCallback(() => {
    return videoRef.current?.muted ?? false
  }, [])

  // Global (opt-in): page-global Space listener. See VideoSpacebarHandling.
  // The default `focus` mode handles Space locally (index.tsx), no window listener.
  useEffect(() => {
    if (spacebarHandling !== 'global') {
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isActiveElementEditing()) {
          return
        }
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [spacebarHandling, togglePlay])

  return {
    videoRef,
    state,
    handlers: {
      handleTimeUpdate,
      handleEnded,
      handleError,
      handleLoadedData,
      handleLoadedMetadata,
      handlePause,
      handlePlay,
    },
    controls: {
      play,
      pause,
      seek,
      togglePlay,
      setVolume,
      getVolume,
      setMuted,
      getMuted,
    },
  }
}
