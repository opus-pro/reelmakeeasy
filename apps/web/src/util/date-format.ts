import { formatInTimeZone } from 'date-fns-tz'

export function formatDate(date?: Date | string, format = 'MMM d, h:mm a zzz'): string {
  try {
    if (!date) {
      return ''
    }

    // Get user's timezone from browser
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    // Convert the date to user's timezone and format it
    return formatInTimeZone(date, userTimeZone, format)
  } catch {
    return `${date}`
  }
}

// Helper function to get relative time (days ago format)
export function getRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()

  const diffTime = Math.abs(now.getTime() - date.getTime())
  const diffStr = getTimeDuration(diffTime)
  if (diffStr === '') {
    return 'Just now'
  }
  return `${diffStr} ago`
}
export function getTimeDuration(timeDiffMs: number, digit = 0): string {
  const MINUTE_MS = 1000 * 60
  const diffDays = Math.floor(timeDiffMs / (MINUTE_MS * 60 * 24))

  const toDigit = (num: number) => +num.toFixed(digit)

  if (diffDays === 0) {
    const diffHours = Math.floor(timeDiffMs / (MINUTE_MS * 60))
    if (diffHours <= 1) {
      const diffMinutes = toDigit(timeDiffMs / MINUTE_MS)
      return +diffMinutes <= 1 ? '' : `${diffMinutes}m`
    }

    return diffHours < 2 ? '1h' : `${diffHours}h`
  }
  if (diffDays < 2) {
    return '1d'
  }
  if (diffDays < 7) {
    return `${diffDays}d`
  }
  if (diffDays < 30) {
    const weeks = toDigit(diffDays / 7)
    return weeks < 2 ? '1w' : `${weeks}w`
  }
  if (diffDays < 365) {
    const months = toDigit(diffDays / 30)
    return months < 2 ? '1mo' : `${months}mo`
  }
  const years = toDigit(diffDays / 365)
  return years < 2 ? '1y' : `${years}y`
}
