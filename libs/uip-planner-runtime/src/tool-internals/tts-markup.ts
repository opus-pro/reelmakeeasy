export const SUPPORTED_TTS_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
] as const

export interface RequestedPronunciationMapping {
  pronunciation: string
  word: string
}

export interface RequestedTtsMarkup {
  emotion: (typeof SUPPORTED_TTS_EMOTIONS)[number] | null
  pronunciations: RequestedPronunciationMapping[]
}

export function applyRequestedTtsMarkupToText(
  text: string,
  markup: null | RequestedTtsMarkup,
  options: { addEmotion: boolean },
): string {
  if (!markup) {
    return text
  }
  let nextText = text.trim()
  for (const mapping of markup.pronunciations) {
    nextText = applyPronunciationMapping(nextText, mapping)
  }
  if (options.addEmotion && markup.emotion && !containsSupportedEmotionTag(nextText)) {
    nextText = `[${markup.emotion}] ${nextText}`
  }
  return nextText
}

export function extractRequestedTtsMarkup(intentText: string): null | RequestedTtsMarkup {
  const pronunciations = extractPronunciationMappings(intentText)
  const emotion = inferRequestedEmotion(intentText)
  if (pronunciations.length === 0 && !emotion) {
    return null
  }
  return { emotion, pronunciations }
}

function applyPronunciationMapping(text: string, mapping: RequestedPronunciationMapping): string {
  const textWithExistingMappingsRemoved = removeExistingPronunciationMappingsForWord(
    text,
    mapping.word,
  )
  const displayPattern = boundaryPattern(mapping.word, 'gi')
  let replacedDisplayWord = false
  const withDisplayMappings = textWithExistingMappingsRemoved.replace(
    displayPattern,
    (_match, prefix, word) => {
      replacedDisplayWord = true
      return `${prefix}{${word}|${mapping.pronunciation}}`
    },
  )
  if (replacedDisplayWord) {
    return removeSpokenPronunciationExplanation(withDisplayMappings, mapping)
  }

  const pronunciationPattern = boundaryPattern(mapping.pronunciation, 'gi')
  let replacedPronunciation = false
  const withPronunciationMappings = text.replace(pronunciationPattern, (_match, prefix) => {
    replacedPronunciation = true
    return `${prefix}{${mapping.word}|${mapping.pronunciation}}`
  })
  if (replacedPronunciation) {
    return removeSpokenPronunciationExplanation(withPronunciationMappings, mapping)
  }
  return text
}

function boundaryPattern(value: string, flags = 'i'): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_{}|])(${escapeRegExp(value)})(?=$|[^A-Za-z0-9_{}|])`, flags)
}

function cleanPronunciationCandidate(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!?。！？;,，；:：]+$/g, '')
    .trim()
}

function cleanWordCandidate(value: string): string {
  return cleanPronunciationCandidate(value).replace(/^(?:the\s+)?pronunciation\s+of\s+/i, '')
}

function containsSupportedEmotionTag(text: string): boolean {
  return SUPPORTED_TTS_EMOTIONS.some((emotion) =>
    new RegExp(`\\[${escapeRegExp(emotion)}\\]`, 'i').test(text),
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function extractPronunciationMappings(intentText: string): RequestedPronunciationMapping[] {
  const patterns = [
    /\b(?:pronounce)\s+["'“”‘’]?([^"'“”‘’\n]{1,80}?)["'“”‘’]?\s+(?:as|like|to)\s+["'“”‘’]?([^"'“”‘’\n.,;!?。！？，；]{1,160})/gi,
    /\b(?:pronunciation|proununciation|prounication|prounaciation|prounciation)\s+(?:of|for)\s+["'“”‘’]?([^"'“”‘’\n]{1,80}?)["'“”‘’]?\s+(?:should\s+be|is|as|to|=)\s+["'“”‘’]?([^"'“”‘’\n.,;!?。！？，；]{1,160})/gi,
    /["'“”‘’]?([^"'“”‘’\n]{1,80}?)["'“”‘’]?\s+should\s+be\s+pronounced\s+["'“”‘’]?([^"'“”‘’\n.,;!?。！？，；]{1,160})/gi,
    /["'“”‘’]?([^"'“”‘’\n]{1,80}?)["'“”‘’]?\s*(?:的)?(?:发音|讀音|读音)\s*(?:应该是|應該是|是|为|為|=)\s*["'“”‘’]?([^"'“”‘’\n.,;!?。！？，；]{1,160})/gi,
    /(?:把)?\s*["'“”‘’]?([^"'“”‘’\n]{1,80}?)["'“”‘’]?\s*(?:读作|讀作|念作)\s*["'“”‘’]?([^"'“”‘’\n.,;!?。！？，；]{1,160})/gi,
  ]
  const mappings: RequestedPronunciationMapping[] = []
  const seenWords = new Set<string>()
  for (const pattern of patterns) {
    for (const match of intentText.matchAll(pattern)) {
      const word = cleanWordCandidate(match[1] ?? '')
      const pronunciation = cleanPronunciationCandidate(match[2] ?? '')
      const key = word.toLowerCase()
      if (!word || !pronunciation || seenWords.has(key) || word.length > 80) {
        continue
      }
      seenWords.add(key)
      mappings.push({ word, pronunciation })
    }
  }
  return mappings
}

function inferRequestedEmotion(intentText: string): (typeof SUPPORTED_TTS_EMOTIONS)[number] | null {
  const explicitTag = intentText.match(/\[(happy|sad|angry|fearful|disgusted|surprised|calm)\]/i)
  if (explicitTag) {
    return explicitTag[1].toLowerCase() as (typeof SUPPORTED_TTS_EMOTIONS)[number]
  }
  const lower = intentText.toLowerCase()
  const keywordGroups: Array<{
    emotion: (typeof SUPPORTED_TTS_EMOTIONS)[number]
    keywords: string[]
  }> = [
    { emotion: 'angry', keywords: ['angry', 'furious', 'rage'] },
    { emotion: 'sad', keywords: ['sad', 'sorrowful', 'melancholy'] },
    { emotion: 'fearful', keywords: ['fearful', 'scary', 'horror', 'suspenseful', 'dramatic'] },
    { emotion: 'disgusted', keywords: ['disgusted', 'gross', 'repulsed'] },
    { emotion: 'surprised', keywords: ['surprised', 'amazed', 'shocked', 'excited'] },
    { emotion: 'calm', keywords: ['calm', 'premium', 'soft', 'gentle', 'soothing', 'steady'] },
    {
      emotion: 'happy',
      keywords: [
        'happy',
        'joyful',
        'playful',
        'upbeat',
        'cheerful',
        'friendly',
        'warm',
        'charming',
      ],
    },
  ]
  for (const group of keywordGroups) {
    if (
      group.keywords.some((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(lower))
    ) {
      return group.emotion
    }
  }
  return null
}

function removeExistingPronunciationMappingsForWord(text: string, word: string): string {
  const normalizedWord = word.trim().toLowerCase()
  return text.replace(/\{([^{}|/\n]{1,80})\|([^{}\n]{1,160})\}/g, (match, rawWord) => {
    const displayWord = String(rawWord).trim()
    return displayWord.toLowerCase() === normalizedWord ? displayWord : match
  })
}

function removeSpokenPronunciationExplanation(
  text: string,
  mapping: RequestedPronunciationMapping,
): string {
  return text
    .replace(
      new RegExp(
        `\\s*,?\\s*pronounced\\s+(?:as\\s+)?${escapeRegExp(mapping.pronunciation)}\\b`,
        'gi',
      ),
      '',
    )
    .replace(/\s+([,.!?;:])/g, '$1')
}
