/** Context: screenplay has multi-types right now: visual, sound, verbal */
export function isNotVerbal(sentence: string | undefined): boolean {
  const trimmed = sentence?.trim()
  return (
    !!trimmed &&
    (trimmed.startsWith('__visual') ||
      trimmed.startsWith('__sound') ||
      trimmed.startsWith('__media'))
  )
}

/** Which means no one is speaking */
export function isSilence(word: string | undefined): boolean {
  return !!word && word.trim() === '__silence'
}

export const isMissing = (content: string): boolean => content === '__missing'

/** Which means no one is speaking or words/sentences are missed in original transcript */
export function isSilenceOrMissing(word: string | undefined): boolean {
  if (!word) {
    return false
  }
  const trimmedWord = word.trim()
  return trimmedWord === '__silence' || trimmedWord === '__missing'
}
