import { CaptionColorType } from '../../enums/refine-v2.enum'
import { isMissing, isNotVerbal, isSilence } from '../../helpers/special-semantic-helper'
import { accentWordIndex, chunkCaptionWords } from '../../long-take/beat-loop-captions'
import { TextElement } from '../../types/refine-v2-definition'
import { AnimatedWordStyle, CaptionSeg } from '../../types/render-plan-struct'
import { CaptionTrack } from '../../types/video-script'
import { getStartAndEnd, getWordText } from '../utils'

import type { CaptionStrip } from './caption-style'

/**
 * Short captions: Punch and Explainer (`CaptionRenderPref.chunking === 'short'`) on any video.
 *
 * - A caption longer than a chunk is split the way loops chunk theirs (`chunkCaptionWords`: 1-3
 *   words, broken after punctuation). Each chunk stays on screen until the next one starts, but
 *   never past the end of its sentence or of its transcript segment, and never through a pause
 *   longer than SHORT_CAPTION_MAX_HOLD_GAP_MS. A caption that is already one chunk, as every loop
 *   chunk is, is left as it is.
 * - When the track marks no accent word, each chunk's accent is the one a loop picks
 *   (`accentWordIndex`), coloured Primary.
 * - Both renderers light only the active word. To keep the accent lit for the whole chunk, the
 *   render plan's word times are rewritten (`holdAccentForWholeCaption`); the stored track keeps
 *   the spoken times.
 * - Explainer's paper strip is a second caption layer under the caption: the same words, place,
 *   size and tilt (`captionStripSeg`).
 */

/** The longest silence a short caption stays on screen through, waiting for the next one. */
export const SHORT_CAPTION_MAX_HOLD_GAP_MS = 1000

/**
 * The shortest time a short caption is given on screen. Squashed word times (several words
 * sharing one start, or a last word with no length) would leave a chunk less than this, or
 * nothing: under a frame neither renderer draws it, and two or three frames is a flash nobody
 * reads. Such a chunk joins the next one (the one before, at the end of its segment).
 */
export const SHORT_CAPTION_MIN_MS = 100

/** The engine preset that draws one box behind every visible line: Explainer's strip. */
const STRIP_PRESET_URI = 'caption-preset://deep-diver'

/** Between rewritten word starts: well clear of the engine's ~200 ms short-word grouping. */
const WORD_STEP_MS = 500
/** How long each rewritten word lasts, also above the ~200 ms grouping. */
const WORD_MS = 400

/** A sentence's last word: a full stop, question or exclamation mark, closing quotes allowed. */
const SENTENCE_END = /[!.?…]["')\]’”]*$/

type CaptionStyleFields = AnimatedWordStyle & {
  shadowBlur?: number
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
}

type CaptionTrackSegment = CaptionTrack['segments'][number]

/**
 * Explainer's strip layer for one caption: the same words, times, place, size and tilt, drawn as
 * one paper box behind the whole caption with dark ink, no outline and no shadow.
 */
export function captionStripSeg(seg: CaptionSeg, strip: CaptionStrip): CaptionSeg {
  const {
    shadowBlur: _blur,
    shadowColor: _shadow,
    shadowOffsetX: _x,
    shadowOffsetY: _y,
    strokeColor: _stroke,
    ...style
  } = seg.style as CaptionStyleFields
  const stripStyle: CaptionStyleFields = {
    ...style,
    animationBgColor: strip.color,
    animationColor: strip.ink,
    borderRadius: 0,
    fontColor: strip.ink,
    strokeWidth: 0,
  }
  return {
    ...seg,
    id: `${seg.id}-strip`,
    style: stripStyle,
    // The caption above boxes the accent word; the strip's words are all ink.
    texts: seg.texts.map(({ highlightColor: _, ...word }) => word),
    uri: STRIP_PRESET_URI,
  }
}

/**
 * The words' times rewritten so the accent word (the one with a highlight colour) is the active
 * word for the whole caption, as both renderers light only the active word. With t the caption's
 * length: the accent starts at 0, the k-th word before it at -500 * k ms (so before the caption
 * shows) and the k-th word after it at t + 500 * k ms (after it has gone). Each word lasts 400 ms;
 * the accent lasts the whole caption, because the engine holds a last word only 1.5 s past its end.
 * A caption without an accent word lights none.
 */
export function holdAccentForWholeCaption(seg: CaptionSeg): CaptionSeg {
  const t = Math.max(0, seg.out - seg.in)
  const accent = seg.texts.findIndex((word) => word.highlightColor !== undefined)
  const startOf = (i: number): number => {
    if (accent === -1) return t + WORD_STEP_MS * (i + 1)
    if (i < accent) return -WORD_STEP_MS * (accent - i)
    return i === accent ? 0 : t + WORD_STEP_MS * (i - accent)
  }
  return {
    ...seg,
    texts: seg.texts.map((word, i) => {
      const start = startOf(i)
      const end = i === accent ? Math.max(start + WORD_MS, t) : start + WORD_MS
      return { ...word, in: start, out: end }
    }),
  }
}

/**
 * The caption track's segments as short captions (see the top of this file): the stored track's
 * spoken word times, split into chunks with their accent marked. Nothing in `segments` is changed.
 */
export function shortCaptionSegments(segments: CaptionTrackSegment[]): CaptionTrackSegment[] {
  const markAccents = !segments.some((segment) =>
    segment.content.textElements.some((word) => word.color === CaptionColorType.Primary),
  )
  return segments.flatMap((segment) => splitIntoChunks(segment, markAccents))
}

/** Whether `word` ends a sentence, by the loops' phrase rule ("Dr." or "c." doesn't). */
function endsSentence(word: string): boolean {
  return SENTENCE_END.test(word) && chunkCaptionWords([word, word]).length > 1
}

/**
 * When a chunk leaves the screen: when the next one starts, or at its own last word when that
 * ends a sentence or a long pause follows. Never after the next one has started.
 */
function holdUntil(chunk: TextElement[], next: TextElement): number {
  const last = chunk[chunk.length - 1]
  const lastEnd = last.duration.eO
  const nextStart = next.duration.sO
  const hold =
    !endsSentence(getWordText(last)) && nextStart - lastEnd <= SHORT_CAPTION_MAX_HOLD_GAP_MS
  return Math.min(nextStart, hold ? nextStart : lastEnd)
}

/** Words the captions show (TextAdapter drops the rest). */
const isShownWord = (word: TextElement): boolean => {
  const text = getWordText(word)
  return Boolean(text) && !isSilence(text) && !isMissing(text) && !isNotVerbal(text)
}

/**
 * When chunk `k` of a segment spanning `[segmentStart, segmentEnd]` is on screen: from its first
 * word (the segment's start, for the first chunk) until `holdUntil` the next chunk, or the
 * segment's end for the last.
 */
function chunkWindow(
  chunks: TextElement[][],
  k: number,
  [segmentStart, segmentEnd]: [number, number],
): [number, number] {
  const next = chunks[k + 1]
  const start = k === 0 ? segmentStart : chunks[k][0].duration.sO
  return [start, next ? holdUntil(chunks[k], next[0]) : segmentEnd]
}

/**
 * `chunks` with each one that would be on screen for less than SHORT_CAPTION_MIN_MS joined to
 * the next (the one before, for the last), so squashed word times lose no words. A joined chunk
 * starts with the same word as before, so the chunks before it keep their windows.
 */
function withTimeOnScreen(chunks: TextElement[][], bounds: [number, number]): TextElement[][] {
  const joined = [...chunks]
  let k = 0
  while (k < joined.length && joined.length > 1) {
    const [start, end] = chunkWindow(joined, k, bounds)
    if (end - start >= SHORT_CAPTION_MIN_MS) {
      k += 1
    } else if (k + 1 < joined.length) {
      joined.splice(k, 2, [...joined[k], ...joined[k + 1]])
    } else {
      joined.splice(k - 1, 2, [...joined[k - 1], ...joined[k]])
      k -= 1
    }
  }
  return joined
}

/** One stored caption as short captions: unchanged when it is one chunk already. */
function splitIntoChunks(
  segment: CaptionTrackSegment,
  markAccents: boolean,
): CaptionTrackSegment[] {
  const words = segment.content.textElements.filter(isShownWord)
  const [segmentStart, segmentEnd] = getStartAndEnd(segment.duration)
  const bounds: [number, number] = [segmentStart, segmentEnd]
  let at = 0
  const chunks = withTimeOnScreen(
    chunkCaptionWords(words.map(getWordText)).map((tokens) =>
      words.slice(at, (at += tokens.length)),
    ),
    bounds,
  )
  if (chunks.length <= 1) {
    if (!markAccents || !chunks.length) return [segment]
    const textElements = withAccent(segment.content.textElements, chunks[0])
    return [{ ...segment, content: { ...segment.content, textElements } }]
  }
  return chunks.map((chunk, k) => {
    const [start, end] = chunkWindow(chunks, k, bounds)
    const duration = { eO: end, sO: start }
    const timeline = { in: start, out: end }
    return {
      ...segment,
      content: {
        ...segment.content,
        ...(segment.content.id ? { id: `${segment.content.id}-${k + 1}` } : {}),
        duration,
        textElements: markAccents ? withAccent(chunk, chunk) : chunk,
        timeline,
      },
      duration,
      id: `${segment.id}-${k + 1}` as const,
      timeline,
    }
  })
}

/** `words` with the accent word of `chunk` (some of them) coloured Primary. */
function withAccent(words: TextElement[], chunk: TextElement[]): TextElement[] {
  const accent = chunk[accentWordIndex(chunk.map(getWordText))]
  return words.map((word) =>
    word === accent ? { ...word, color: CaptionColorType.Primary } : word,
  )
}
