export function getPinnedUserInputFromTimeline(timeline: unknown): string | undefined {
  if (!timeline || typeof timeline !== 'object') {
    return undefined
  }

  const events = (timeline as { events?: unknown }).events
  if (!Array.isArray(events)) {
    return undefined
  }

  const messages = events
    .map((raw) => {
      if (!raw || typeof raw !== 'object') {
        return ''
      }

      const event = raw as { message?: unknown; type?: unknown }
      return event.type === 'user_message' && typeof event.message === 'string'
        ? event.message.trim()
        : ''
    })
    .filter((message) => message.length > 0)

  if (messages.length === 0) {
    return undefined
  }

  const first = messages[0]
  const longest = messages.reduce(
    (currentLongest, message) =>
      message.length > currentLongest.length ? message : currentLongest,
    first,
  )

  return longest === first
    ? first
    : ['Initial user prompt:', first, '', 'Most detailed user prompt so far:', longest].join('\n')
}
