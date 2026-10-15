export function extractAudioScriptFromAsr(asrResult: {
  text?: string
  words?: Array<{ text?: string; type?: string }>
}): string {
  const scriptFromWords =
    asrResult.words
      ?.filter(
        (word) =>
          word?.type === 'word' && typeof word.text === 'string' && word.text.trim().length > 0,
      )
      .map((word) => word.text?.trim())
      .filter((word): word is string => Boolean(word))
      .join(' ')
      .trim() || ''

  if (scriptFromWords) {
    return scriptFromWords
  }

  const audioEventLabels =
    asrResult.words
      ?.filter(
        (word) =>
          word?.type === 'audio_event' &&
          typeof word.text === 'string' &&
          word.text.trim().length > 0,
      )
      .map((word) => word.text as string) || []

  if (audioEventLabels.length > 0) {
    return audioEventLabels
      .reduce((text, label) => text.split(label).join(''), asrResult.text || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return asrResult.text?.trim() || ''
}
