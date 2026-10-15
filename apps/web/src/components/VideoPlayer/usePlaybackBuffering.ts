import type { VideoHTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'

/**
 * Media-event handlers that drive buffering state. Spread onto a raw `<video>`
 * or onto `VideoPlayer`'s `primitiveVideoPlayerProps` (which forwards unknown
 * media-event props straight to the underlying element).
 */
export type BufferingEventHandlers = Pick<
  VideoHTMLAttributes<HTMLVideoElement>,
  'onCanPlay' | 'onError' | 'onPlaying' | 'onWaiting'
>

export interface PlaybackBuffering {
  /**
   * Handlers to spread onto the player's `primitiveVideoPlayerProps`. Includes
   * `onError`; a caller with its own error handling must compose the two rather
   * than let one overwrite the other.
   */
  bufferingHandlers: BufferingEventHandlers
  /** True while playback has stalled mid-play to re-buffer. */
  isBuffering: boolean
  /** Force-clear buffering (e.g. from an `onPause` / `onEnded` handler). */
  resetBuffering: () => void
}

/**
 * How long a stall must outlast before the spinner paints. A `waiting` that
 * resolves inside this window is invisible to the user, so showing a spinner for
 * it reads as a flicker rather than as feedback.
 */
const STALL_GRACE_MS = 200

/**
 * Tracks whether a `<video>` is stalled mid-playback, so a surface can show a
 * loading spinner.
 *
 * Progressive `<video src>` playback (no adaptive streaming) can drain its
 * buffer faster than the network refills it: the frame freezes for a few
 * seconds, then resumes. The browser fires `waiting` on the stall and
 * `playing` / `canplay` on resume. Without wiring those, the freeze has no UI at
 * all.
 *
 * Two guards keep the spinner off screen when there is nothing to report:
 *
 * - `waiting` is ignored unless `isPlaying`, so a paused scrub never flashes it.
 * - a terminal `error` clears it. Nothing follows a fatal media error -- no
 *   `playing`, no `canplay`, and `pause` is not guaranteed -- so without this the
 *   spinner would sit over a dead video forever, which reads as a permanent fake
 *   "loading" (found in review).
 * - a stall must outlast {@link STALL_GRACE_MS} to paint. `play` fires before the
 *   element has data, so with `preload="none"` the first click always produces
 *   `play` -> `waiting` -> `playing` and the `isPlaying` guard is already open by
 *   the time that `waiting` lands. The grace window is what keeps that
 *   sub-frame start-up gap, and any other stall too short to see, invisible.
 *
 * @param isPlaying whether playback is currently active
 * @param resetKey  when this changes, buffering clears (typically the video src)
 */
export function usePlaybackBuffering(
  isPlaying: boolean,
  resetKey?: number | string,
): PlaybackBuffering {
  const [isBuffering, setIsBuffering] = useState(false)
  const stallTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  const clearStallTimer = useRefCallback(() => {
    if (stallTimerRef.current !== null) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  })

  // Re-checked when the timer fires, not just when it was armed: playback can stop
  // inside the grace window, and this owns the guard rather than trusting every
  // caller to have wired `resetBuffering` into its own `onPause`.
  const paintStall = useRefCallback(() => {
    stallTimerRef.current = null
    if (isPlaying) {
      setIsBuffering(true)
    }
  })

  // Keep the first pending timer: re-arming on a repeat `waiting` would push the
  // deadline out for as long as the stalls keep coming, so a long stall that
  // re-fires `waiting` would never paint.
  const handleWaiting = useRefCallback(() => {
    if (!isPlaying || stallTimerRef.current !== null) {
      return
    }
    stallTimerRef.current = setTimeout(paintStall, STALL_GRACE_MS)
  })

  const resetBuffering = useRefCallback(() => {
    clearStallTimer()
    setIsBuffering(false)
  })

  // Clear stale buffering when the source changes (sibling switch, remix).
  useEffect(() => resetBuffering(), [resetKey])

  // A pending timer outliving the component would setState after unmount.
  useEffect(() => clearStallTimer, [])

  return {
    bufferingHandlers: {
      onCanPlay: resetBuffering,
      onError: resetBuffering,
      onPlaying: resetBuffering,
      onWaiting: handleWaiting,
    },
    isBuffering,
    resetBuffering,
  }
}
