export interface ParsedConversationContext {
  latestUserMessage: string
  pinnedRawUserPrompt: string
  recentConversationContext: string
}

export function parseConversationContext(conversationContext: string): ParsedConversationContext {
  const pinnedStart = 'Pinned user prompt (preserve intent):'
  const recentStart = 'Recent conversation:'
  const latestStart = 'Latest user message (incremental update):'
  const text = conversationContext || ''

  const pinnedRawUserPrompt = extractSection(text, pinnedStart, recentStart)
  const recentConversationContext = extractSection(text, recentStart, latestStart)
  const latestUserMessage = extractSection(text, latestStart, null)

  return {
    pinnedRawUserPrompt,
    recentConversationContext,
    latestUserMessage,
  }
}

function extractSection(source: string, startMarker: string, endMarker: null | string): string {
  const startIndex = source.indexOf(startMarker)
  if (startIndex === -1) {
    return '(not available)'
  }
  const contentStart = startIndex + startMarker.length
  const endIndex = endMarker ? source.indexOf(endMarker, contentStart) : -1
  const rawSection =
    endIndex >= 0 ? source.slice(contentStart, endIndex) : source.slice(contentStart)
  const normalized = rawSection.trim()
  return normalized || '(not available)'
}
