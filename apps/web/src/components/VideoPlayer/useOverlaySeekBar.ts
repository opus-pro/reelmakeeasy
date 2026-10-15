import { useCallback, useEffect, useRef, useState } from 'react'

/** Seconds the seekbar jumps per ArrowLeft/ArrowRight press. */
export const OVERLAY_SEEK_STEP_SEC = 5

/**
 * Pointer-capture drag + keyboard seeking for the on-video overlay seekbar.
 *
 * Drives playback through the `onSeek` callback rather than a video ref, so the
 * same scrubber works for any surface (a `<video>`, the editor canvas player,
 * etc.). `seekbarRef` must be attached to the slider element. While dragging,
 * `dragTime` holds the in-flight time for instant visual feedback.
 */
export function useOverlaySeekBar(duration: number, onSeek: (time: number) => void) {
  const [dragTime, setDragTime] = useState<null | number>(null)
  const [isDragging, setIsDragging] = useState(false)
  const seekbarRef = useRef<HTMLDivElement>(null)

  const getSeekTime = useCallback(
    (clientX: number) => {
      if (!seekbarRef.current || !duration) {
        return null
      }
      const rect = seekbarRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return pct * duration
    },
    [duration],
  )

  const handleSeekPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setIsDragging(true)
      const t = getSeekTime(e.clientX)
      if (t !== null) {
        setDragTime(t)
        onSeek(t)
      }
    },
    [getSeekTime, onSeek],
  )

  const handleSeekPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return
      }
      const t = getSeekTime(e.clientX)
      if (t !== null) {
        setDragTime(t)
        onSeek(t)
      }
    },
    [getSeekTime, isDragging, onSeek],
  )

  const handleSeekPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return
      }
      e.currentTarget.releasePointerCapture(e.pointerId)
      setIsDragging(false)
      setDragTime(null)
    },
    [isDragging],
  )

  const handleSeekKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, currentTime: number) => {
      let next: null | number = null
      switch (e.key) {
        case 'ArrowLeft': {
          next = currentTime - OVERLAY_SEEK_STEP_SEC
          break
        }
        case 'ArrowRight': {
          next = currentTime + OVERLAY_SEEK_STEP_SEC
          break
        }
        case 'End': {
          next = duration
          break
        }
        case 'Home': {
          next = 0
          break
        }
        default: {
          return
        }
      }
      e.preventDefault()
      onSeek(Math.max(0, Math.min(duration, next)))
    },
    [duration, onSeek],
  )

  // A drag that ends off the seekbar still needs to stop (pointerup fires on window).
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      setIsDragging(false)
      setDragTime(null)
    }
    window.addEventListener('pointerup', handleGlobalPointerUp)
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp)
  }, [])

  return {
    dragTime,
    handleSeekKeyDown,
    handleSeekPointerDown,
    handleSeekPointerMove,
    handleSeekPointerUp,
    isDragging,
    seekbarRef,
  }
}
