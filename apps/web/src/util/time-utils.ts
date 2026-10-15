export type FormatSecondsOptions = {
  /** 'auto' (default): show hours only when >= 1h, 'always': always show hours */
  showHours?: 'always' | 'auto'
}

export type MinSec = { minutes: number; seconds: number }

export function getMinSec(ms: number): MinSec {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSeconds = Math.floor(safeMs / 1000)
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  }
}

/**
 * Format seconds to time string (MM:SS or HH:MM:SS)
 * @param seconds - Duration in seconds
 * @param options.showHours - 'auto' (default): show hours only when >= 1h
 *                            'always': always show hours (00:05:30)
 * @returns Formatted string like "05:30" or "01:30:45"
 */
export function formatSecondsToTime(seconds: number, options: FormatSecondsOptions = {}): string {
  const { showHours = 'auto' } = options

  if (!Number.isFinite(seconds) || seconds < 0) {
    return showHours === 'always' ? '00:00:00' : '00:00'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (hours > 0 || showHours === 'always') {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
  }

  return `${pad(minutes)}:${pad(secs)}`
}

/**
 * Format milliseconds to "X.XXs" display format (for debug/admin views)
 * @param ms - Duration in milliseconds
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string like "12.34s"
 */
export function formatMsToSecondsDisplay(ms: number, decimals = 2): string {
  if (!Number.isFinite(ms)) {
    return '0s'
  }
  return `${(ms / 1000).toFixed(decimals)}s`
}
