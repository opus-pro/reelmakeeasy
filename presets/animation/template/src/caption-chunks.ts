/**
 * How captions page through a line: a phrase at a time, the way ReelMakeEasy's caption engine
 * does it (libs/shared/common/src/long-take/beat-loop-captions.ts). A line is cut into chunks of
 * 1 to `maxWords` words, a chunk ending after punctuation, a longer phrase split evenly (4 words
 * show as 2 + 2, never 3 + 1). A chunk stays whole on screen until the next one starts, so the
 * viewer reads phrases, never a window sliding one word at a time.
 */

export type ChunkWord = { end: number; start: number; text: string }

export type CaptionChunk = {
  /** Shown from here… */
  from: number
  /** …until here (seconds). */
  to: number
  words: ChunkWord[]
}

/** Punctuation that ends a phrase (closing quotes allowed after it). */
const BREAK_AFTER = /[!,.:;?–—…-]["')\]’”]*$/
/** Abbreviations that end in a full stop without ending a phrase ("c. 2560 BC"). */
const ABBREVIATION = /^(?:[a-z]\.|(?:approx|ca|dr|mr|mrs|ms|st|vs)\.)$/i
/** The longest silence a chunk stays up through, waiting for the next one. */
const MAX_HOLD_GAP = 1
/** A chunk comes up this early, and the last one stays this long after its word. */
const LEAD = 0.05
const TAIL = 0.25

/** Word counts of the phrases, split after punctuation. */
function phraseLengths(words: string[]): number[] {
  const lengths: number[] = []
  let length = 0
  words.forEach((word, i) => {
    length++
    if ((BREAK_AFTER.test(word) && !ABBREVIATION.test(word)) || i === words.length - 1) {
      lengths.push(length)
      length = 0
    }
  })
  return lengths
}

/** Chunk sizes: each phrase in pieces of at most `maxWords`, as even as they come. */
export function chunkSizes(words: string[], maxWords = 3): number[] {
  return phraseLengths(words).flatMap((length) => {
    const count = Math.ceil(length / maxWords)
    const base = Math.floor(length / count)
    return Array.from({ length: count }, (_, i) => base + (i < length % count ? 1 : 0))
  })
}

/** A line's chunks with when each is on screen. */
export function captionChunks(words: ChunkWord[], maxWords = 3): CaptionChunk[] {
  let at = 0
  const chunks = chunkSizes(
    words.map((w) => w.text),
    maxWords,
  ).map((size) => words.slice(at, (at += size)))
  return chunks.map((chunk, i) => {
    const first = chunk[0] as ChunkWord
    const last = chunk.at(-1) as ChunkWord
    const next = chunks[i + 1]?.[0]
    // Up until the next chunk, unless the speaker pauses longer than MAX_HOLD_GAP.
    const to = next && next.start - last.end <= MAX_HOLD_GAP ? next.start - LEAD : last.end + TAIL
    return { from: first.start - LEAD, to, words: chunk }
  })
}

/** The chunk on screen at t, if any. */
export function chunkAt(chunks: CaptionChunk[], t: number): CaptionChunk | null {
  return chunks.find((c) => t >= c.from && t < c.to) ?? null
}
