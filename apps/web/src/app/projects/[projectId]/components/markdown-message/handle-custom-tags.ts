import { formatSecondsToTime } from '@/util/time-utils'

/**
 * Handle custom tags in text, converting shot references to formatted display
 */
export function handleCustomTags(text: string): string {
  // Meta tags like @video[name](id|previewUrl) are now preserved and handled by renderUserContent
  let newText = text

  // [Current Shot](id|start-end) -> **@Shot start-end** (formatted as time)
  // Format supports both: id|start-end (new format with id) or start-end (legacy format)
  newText = newText.replaceAll(/\[Current Shot\]\((.+?)\)/g, (_match, p1) => {
    // Try to parse as id|start-end format (new format)
    const idTimeRangeMatch = p1.match(/^(.+?)\|(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/)
    if (idTimeRangeMatch) {
      const [, , start, end] = idTimeRangeMatch
      const startFormatted = formatSecondsToTime(Number.parseFloat(start))
      const endFormatted = formatSecondsToTime(Number.parseFloat(end))
      return `**@Shot ${startFormatted} - ${endFormatted}**`
    }
    // Try to parse as time range only (legacy format: start-end)
    const timeRangeMatch = p1.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/)
    if (timeRangeMatch) {
      const start = Number.parseFloat(timeRangeMatch[1])
      const end = Number.parseFloat(timeRangeMatch[2])
      const startFormatted = formatSecondsToTime(start)
      const endFormatted = formatSecondsToTime(end)
      return `**@Shot ${startFormatted} - ${endFormatted}**`
    }
    // Fallback to original ID if not a recognized format
    return `**@Shot ${p1}**`
  })

  return newText
}
