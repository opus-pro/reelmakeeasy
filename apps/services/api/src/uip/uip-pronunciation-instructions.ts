const PRONOUNCE_DIRECTIVE_PATTERN =
  /\bpronounce\s+((?:[^\n.!?]|\.(?=[A-Za-z0-9]|\s+as\b)){1,320})(?=[\n.!?]|$)/gi
const PRONUNCIATION_PAIR_PATTERN =
  /(?:^|\s*(?:[,;]\s*(?:and\s+)?|\band\s+))(["'“‘]?[^,;]{1,80}?["'”’]?)\s+as\s+(["'“‘]?[^,;]{1,160}?["'”’]?)(?=\s*(?:,|;|\band\b|$))/gi

/**
 * Extract explicit pronunciation commands from the user's prompt without changing the
 * narration text. The structured dictionary is understood by preview and final TTS.
 *
 * Supported examples:
 * - "Pronounce SUGAR as SHU-gur"
 * - "Pronounce SUGAR as SHU-gur, and Jacoby as JACK-oh-bee"
 */
export function extractPromptPronunciationDict(prompt?: null | string): string[] {
  if (!prompt) {
    return []
  }

  const entries: string[] = []
  for (const directive of prompt.matchAll(PRONOUNCE_DIRECTIVE_PATTERN)) {
    const body = directive[1] ?? ''
    for (const pair of body.matchAll(PRONUNCIATION_PAIR_PATTERN)) {
      const word = stripWrappingQuotes(pair[1] ?? '')
      const pronunciation = stripWrappingQuotes(pair[2] ?? '')
      if (word && pronunciation && !word.includes('/') && !pronunciation.includes('/')) {
        entries.push(`${word}/${pronunciation}`)
      }
    }
  }

  return mergePronunciationDicts(entries)
}

/** Later dictionaries win so a pronunciation edited in the preview UI overrides the prompt. */
export function mergePronunciationDicts(...dictionaries: Array<string[] | undefined>): string[] {
  const entriesByWord = new Map<string, string>()

  for (const dictionary of dictionaries) {
    for (const entry of dictionary ?? []) {
      const slashIndex = entry.indexOf('/')
      if (slashIndex === -1 || entry.includes('/', slashIndex + 1)) {
        continue
      }
      const word = entry.slice(0, slashIndex).trim()
      const pronunciation = entry.slice(slashIndex + 1).trim()
      if (!word || !pronunciation) {
        continue
      }
      entriesByWord.set(word.toLowerCase(), `${word}/${pronunciation}`)
    }
  }

  return [...entriesByWord.values()]
}

export function pronunciationDictOption(pronunciationDict: string[]): {
  pronunciationDict?: string[]
} {
  return pronunciationDict.length ? { pronunciationDict } : {}
}

function stripWrappingQuotes(value: string): string {
  return value
    .trim()
    .replace(/^["'“‘]+/, '')
    .replace(/["'”’]+$/, '')
    .trim()
}
