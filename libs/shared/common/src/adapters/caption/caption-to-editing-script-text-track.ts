import { TranscriptData, TranscriptSegment } from '@shared/types/agent/transcript'

import { CaptionColorType } from '../../enums/refine-v2.enum'
import { accentWordIndex } from '../../long-take/beat-loop-captions'
import { TextElement } from '../../types/refine-v2-definition'
import { CaptionTrack } from '../../types/video-script'
import { genNanoId } from '../../utils/gen-nano-id'

type internalPrefix = 'content' | 'section' | 'segment' | 'text' | 'textElement' | 'track'
type internalSeg = CaptionTrack['segments'][number]

/**
 * One caption per transcript segment. An accent word is coloured Primary (the highlight colour).
 * With `captionWindows: 'segment'` (a loop's chunks) a caption shows for its segment's own window,
 * held until the next chunk; otherwise from its first word's start to its last word's end.
 */
export function transcriptToEditingScriptTextTrack(transcript: TranscriptData): CaptionTrack {
  const segmentWindows = transcript.captionWindows === 'segment'
  // A loop transcript without accent marks: accent each chunk's word as the loop picks it.
  const pickAccents =
    segmentWindows &&
    !transcript.segments.some((s) => s.words.some((w) => typeof w.accent === 'boolean'))
  const segments: internalSeg[] = transcript.segments.map((section) => {
    const picked = pickAccents ? accentWordIndex(section.words.map((w) => w.word)) : -1
    const textElements = section.words.map((word, i) => Text(word, word.accent ?? i === picked))
    return Segment(textElements, segmentWindows ? windowOf(section) : undefined)
  })
  const result: CaptionTrack = {
    id: genId('track'),
    segments,
    type: 'caption',
  }
  return result
}

function DurationTS({ start, end }: { end: number; start: number }) {
  return {
    sO: start,
    eO: end,
  } as const
}
function genId<T extends internalPrefix>(prefix: T): `${T}-${string}` {
  const id = genNanoId(6)
  return `${prefix}-${id}` as const
}
function Segment(texts: TextElement[], window?: { end: number; start: number }): internalSeg {
  const start = window?.start ?? texts[0].duration.sO
  const end = window?.end ?? (texts.at(-1)?.duration.eO as number)
  const duration = DurationTS({ start, end })
  const timeline = TimelineTS({ start, end })

  const seg: internalSeg = {
    content: {
      id: genId('content'),
      textElements: texts,
      duration,
      timeline,
    },
    id: genId('segment'),
    duration,
    timeline,
  }
  return seg
}
function Text(
  {
    word: text,
    start: startS,
    end: endS,
  }: {
    end: number
    start: number
    word: string
  },
  accent: boolean,
): TextElement {
  const start = timeMs(startS)
  const end = timeMs(endS)

  const item: TextElement = {
    color: accent ? CaptionColorType.Primary : CaptionColorType.Default,
    text,
    id: genId('text'),
    duration: DurationTS({ start, end }),
    timeline: TimelineTS({ start, end }),
  }
  return item
}
function TimelineTS({ start, end }: { end: number; start: number }) {
  return { in: start, out: end } as const
}
function timeMs(v: number): number {
  return Number.parseInt(`${v * 1000}`)
}
/** A segment's own window in ms, when it has a usable one. */
function windowOf(segment: TranscriptSegment): undefined | { end: number; start: number } {
  const start = timeMs(segment.start)
  const end = timeMs(segment.end)
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { end, start } : undefined
}
