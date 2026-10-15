import type { MatchedField } from './project-search.service'

export interface ProjectSearchSnippet {
  field: 'script'
  text: string
}

export interface SnippetInput {
  initPromptText: string
  matchedField: MatchedField | undefined
  nameText: string
  query: string
  scriptText: string
}

const SNIPPET_HALF = 40

export function extractSearchSnippet(input: SnippetInput): ProjectSearchSnippet | undefined {
  if (input.matchedField !== 'script') {
    return undefined
  }
  const text = input.scriptText
  if (!text) {
    return undefined
  }

  const tokens = input.query.toLowerCase().split(/\s+/).filter(Boolean)
  const lowerText = text.toLowerCase()
  let firstHit = -1
  for (const token of tokens) {
    const idx = lowerText.indexOf(token)
    if (idx !== -1 && (firstHit === -1 || idx < firstHit)) {
      firstHit = idx
    }
  }
  if (firstHit < 0) {
    return undefined
  }

  const start = Math.max(0, firstHit - SNIPPET_HALF)
  const end = Math.min(text.length, firstHit + SNIPPET_HALF)
  let snippet = text.slice(start, end)
  if (start > 0) {
    snippet = `...${snippet}`
  }
  if (end < text.length) {
    snippet = `${snippet}...`
  }

  return { field: 'script', text: snippet }
}
