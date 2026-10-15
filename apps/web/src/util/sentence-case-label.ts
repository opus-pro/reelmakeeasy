/**
 * Sentence-case a label cased by someone else. Demo `inputType` values are
 * hand-entered and inconsistent: the same kind ships as both "Script to Video"
 * and "Script to video", and some arrive lowercase ("audio", "transcript").
 *
 * Only plain Title-Case words after the first are lowered; anything with a
 * second capital survives, which is what keeps "LinkedIn to video" intact.
 */
const PLAIN_TITLE_CASE_WORD = /^[A-Z][a-z]+$/

export function sentenceCaseLabel(label: string): string {
  const words = label.split(' ')
  return words
    .map((word, index) => {
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      return PLAIN_TITLE_CASE_WORD.test(word) ? word.toLowerCase() : word
    })
    .join(' ')
}
