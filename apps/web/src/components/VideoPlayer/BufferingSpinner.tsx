import { ProgressHalfRing } from '@/components/icons/core'

/**
 * Centered spinner overlay for a video that is not painting frames -- stalled
 * mid-playback to re-buffer, or still loading its first frame. Pairs
 * with `usePlaybackBuffering` on players that render their own control bar, where
 * the native `<video controls>` throbber is not available.
 *
 * Positioned absolutely, so the caller's player box must be a positioned
 * ancestor. `pointer-events-none` keeps the control bar underneath clickable.
 *
 * @param label screen-reader text; distinguishes a re-buffer from an initial load
 */
export function BufferingSpinner({ label = 'Buffering' }: Readonly<{ label?: string }>) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-primary"
      role="status"
    >
      <ProgressHalfRing aria-hidden className="size-8 animate-spin" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
