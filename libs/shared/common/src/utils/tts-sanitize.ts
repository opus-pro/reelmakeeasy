/**
 * Deterministic Unicode sanitization for TTS input.
 *
 * Strips characters that confuse TTS models (notably ElevenLabs v3) into
 * looping or hallucinating phrases: emoji, smart quotes, em-dashes,
 * zero-width chars, CRLF line endings, repeated punctuation.
 *
 * Idempotent: sanitizeForTts(sanitizeForTts(x)) === sanitizeForTts(x).
 */
export function sanitizeForTts(input: string): string {
  if (!input) {
    return input
  }

  let s = input.normalize('NFKC')

  // CRLF / CR -> LF
  s = s.replace(/\r\n?/g, '\n')

  // Zero-width chars: ZWSP (200B), ZWNJ (200C), ZWJ (200D), BOM (FEFF), word-joiner (2060)
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')

  // Smart single quotes (U+2018-201B) -> ASCII apostrophe
  s = s.replace(/[‘-‛]/g, "'")
  // Smart double quotes (U+201C-201F) + guillemets (U+00AB, U+00BB) -> ASCII quote
  s = s.replace(/[“-‟«»]/g, '"')

  // Em-dash (U+2014) -> ", " (TTS treats as natural pause).
  // Absorb surrounding spaces/tabs so " -- " doesn't become " , ".
  s = s.replace(/[ \t]*—[ \t]*/g, ', ')
  // En-dash (U+2013) -> hyphen
  s = s.replace(/–/g, '-')
  // Horizontal ellipsis (U+2026) -> period
  s = s.replace(/…/g, '.')

  // Emoji and pictographs (covers BMP + supplementary plane)
  s = s.replace(/\p{Extended_Pictographic}/gu, '')
  // Variation selectors VS1-VS16 (orphans after emoji removal)
  s = s.replace(/[︀-️]/g, '')

  // Collapse repeated punctuation that TTS can misread as separate utterances
  s = s.replace(/\.{3,}/g, '.')
  s = s.replace(/!{2,}/g, '!')
  s = s.replace(/\?{2,}/g, '?')
  s = s.replace(/-{2,}/g, '-')

  // Whitespace cleanup
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/ *\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')

  return s.trim()
}

// Terminal punctuation (ASCII + full-width CJK), tolerating trailing closing quotes or brackets.
// e.g. `talked."` and `talked.)` end a sentence.
const SENTENCE_FINAL_REGEX = /[.!?:;。！？：；…]['"’”)\]」』】]*$/
// Scripts written without inter-word spaces, where a joiner space would be an artifact.
const CJK_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}＀-￯]/u
// Editor-wrapped prose lines all sit near the wrap width; shorter authored lines are
// list fragments that collapseFragmentListsForTts merges downstream, so leave them split.
const MIN_WRAPPED_LINE_CHARS = 40

/**
 * Joins lines that a hard-wrapping editor split mid-sentence.
 *
 * TTS providers read a newline as an utterance boundary, so a pasted script
 * wrapped at a fixed column narrates with pauses in the middle of sentences.
 * Only single newlines are touched: a blank line is a real paragraph break, and
 * a line ending in terminal punctuation keeps its newline. Idempotent.
 */
export function unwrapMidSentenceLineBreaks(text: string): string {
  // A stray CR left mid-line survives the join and sanitizeForTts later turns it back
  // into the newline this function just removed, so fold CRLF and CR down first.
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let out = lines[0] ?? ''
  // The gate reads the line being accumulated, not the original one, so a run of
  // wrapped lines unwraps in a single pass and re-running finds nothing to join.
  let accumulated = out.trimEnd()
  for (let i = 1; i < lines.length; i++) {
    const curr = lines[i]
    if (
      accumulated.length < MIN_WRAPPED_LINE_CHARS ||
      curr.trim() === '' ||
      SENTENCE_FINAL_REGEX.test(accumulated)
    ) {
      out += `\n${curr}`
      accumulated = curr.trimEnd()
      continue
    }
    const joinsCjk =
      CJK_CHAR_REGEX.test(accumulated.slice(-1)) &&
      CJK_CHAR_REGEX.test(curr.trimStart().slice(0, 1))
    const joiner = joinsCjk ? '' : ' '
    out += `${joiner}${curr}`
    accumulated = `${accumulated}${joiner}${curr}`.trimEnd()
  }
  return out
}
