import type { TranscriptData } from '@shared/types/agent/transcript'

import { CaptionColorType } from '../../enums/refine-v2.enum'
import { genNanoId } from '../../utils/gen-nano-id'

import { transcriptToEditingScriptTextTrack } from './caption-to-editing-script-text-track'

jest.mock('../../utils/gen-nano-id', () => ({ genNanoId: jest.fn() }))

beforeEach(() => {
  let n = 0
  jest.mocked(genNanoId).mockImplementation(() => String(++n))
})

/** A normal video's transcript: no accent marks, no caption windows. */
const OLD: TranscriptData = {
  language: 'en',
  segments: [
    {
      end: 1.3,
      start: 0.1,
      text: 'Honey never spoils.',
      words: [
        { end: 0.4, start: 0.12, word: 'Honey' },
        { end: 0.7, speaker: 'A', start: 0.45, word: 'never' },
        { end: 1.1, start: 0.75, word: 'spoils.' },
      ],
    },
    { end: 3, start: 1.5, text: 'Ever.', words: [{ end: 2.01, start: 1.6, word: 'Ever.' }] },
  ],
}

/** A loop's transcript: one segment per chunk, held until the next chunk or the clip end. */
const LOOP: TranscriptData = {
  captionWindows: 'segment',
  language: 'en',
  segments: [
    {
      end: 1.2,
      start: 0.15,
      text: 'It lasts forever',
      words: [
        { end: 0.3, start: 0.15, word: 'It' },
        { end: 0.6, start: 0.3, word: 'lasts' },
        { accent: true, end: 1, start: 0.6, word: 'forever' },
      ],
    },
    {
      end: 4,
      start: 1.2,
      text: 'in sealed jars',
      words: [
        { end: 1.4, start: 1.2, word: 'in' },
        { accent: true, end: 1.8, start: 1.4, word: 'sealed' },
        { end: 2.3, start: 1.8, word: 'jars' },
      ],
    },
  ],
}

const colors = (track: ReturnType<typeof transcriptToEditingScriptTextTrack>) =>
  track.segments.map((s) => s.content.textElements.map((t) => t.color))
const windows = (track: ReturnType<typeof transcriptToEditingScriptTextTrack>) =>
  track.segments.map((s) => [s.duration?.sO, s.duration?.eO, s.timeline.in, s.timeline.out])

describe('transcriptToEditingScriptTextTrack', () => {
  it('gives a transcript without the new fields the same track as before', () => {
    // As the adapter built it before accents and caption windows (ms truncated, 2.01 s -> 2009).
    const text = (id: number, word: string, sO: number, eO: number) => ({
      color: 0,
      text: word,
      id: `text-${id}`,
      duration: { sO, eO },
      timeline: { in: sO, out: eO },
    })
    const expected = {
      id: 'track-9',
      segments: [
        {
          content: {
            id: 'content-4',
            textElements: [
              text(1, 'Honey', 120, 400),
              text(2, 'never', 450, 700),
              text(3, 'spoils.', 750, 1100),
            ],
            duration: { sO: 120, eO: 1100 },
            timeline: { in: 120, out: 1100 },
          },
          id: 'segment-5',
          duration: { sO: 120, eO: 1100 },
          timeline: { in: 120, out: 1100 },
        },
        {
          content: {
            id: 'content-7',
            textElements: [text(6, 'Ever.', 1600, 2009)],
            duration: { sO: 1600, eO: 2009 },
            timeline: { in: 1600, out: 2009 },
          },
          id: 'segment-8',
          duration: { sO: 1600, eO: 2009 },
          timeline: { in: 1600, out: 2009 },
        },
      ],
      type: 'caption',
    }
    const track = transcriptToEditingScriptTextTrack(OLD)
    expect(track).toStrictEqual(expected)
    // Byte for byte, as it lands in video_script.json.
    expect(JSON.stringify(track)).toBe(JSON.stringify(expected))
  })

  it('colours an accent word Primary', () => {
    expect(colors(transcriptToEditingScriptTextTrack(LOOP))).toEqual([
      [CaptionColorType.Default, CaptionColorType.Default, CaptionColorType.Primary],
      [CaptionColorType.Default, CaptionColorType.Primary, CaptionColorType.Default],
    ])
    // Without caption windows too.
    const { captionWindows: _, ...marked } = LOOP
    expect(colors(transcriptToEditingScriptTextTrack(marked))[0]).toEqual([0, 0, 1])
  })

  it('shows each caption for its segment with segment windows', () => {
    const track = transcriptToEditingScriptTextTrack(LOOP)
    // From the chunk's start until the next chunk, or the clip end: not just while it is spoken.
    expect(windows(track)).toEqual([
      [150, 1200, 150, 1200],
      [1200, 4000, 1200, 4000],
    ])
    expect(track.segments.map((s) => [s.content.duration, s.content.timeline])).toEqual([
      [
        { sO: 150, eO: 1200 },
        { in: 150, out: 1200 },
      ],
      [
        { sO: 1200, eO: 4000 },
        { in: 1200, out: 4000 },
      ],
    ])
    // The words keep their own times.
    expect(track.segments[1].content.textElements.map((t) => t.duration)).toEqual([
      { sO: 1200, eO: 1400 },
      { sO: 1400, eO: 1800 },
      { sO: 1800, eO: 2300 },
    ])
  })

  it('never holds a caption past its segment end', () => {
    const late: TranscriptData = {
      ...LOOP,
      segments: [{ ...LOOP.segments[0], end: 0.8 }],
    }
    expect(windows(transcriptToEditingScriptTextTrack(late))).toEqual([[150, 800, 150, 800]])
  })

  it('times captions by their words without segment windows', () => {
    const { captionWindows: _, ...words } = LOOP
    expect(windows(transcriptToEditingScriptTextTrack(words))).toEqual([
      [150, 1000, 150, 1000],
      [1200, 2300, 1200, 2300],
    ])
  })

  it('times a caption by its words when its segment has no usable window', () => {
    const broken: TranscriptData = {
      ...LOOP,
      segments: [
        { ...LOOP.segments[0], end: 0.15 },
        { ...LOOP.segments[1], end: Number.NaN },
      ],
    }
    expect(windows(transcriptToEditingScriptTextTrack(broken))).toEqual([
      [150, 1000, 150, 1000],
      [1200, 2300, 1200, 2300],
    ])
  })

  it('accents a loop transcript without accent marks the way the loop picks them', () => {
    const unmarked: TranscriptData = {
      ...LOOP,
      segments: LOOP.segments.map((s) => ({
        ...s,
        words: s.words.map(({ accent: _, ...w }) => w),
      })),
    }
    // The chunk's longest word that isn't filler: "forever", then "sealed".
    expect(colors(transcriptToEditingScriptTextTrack(unmarked))).toEqual([
      [0, 0, 1],
      [0, 1, 0],
    ])
  })

  it('keeps the marks a loop transcript has, and leaves normal transcripts unaccented', () => {
    const oneMark: TranscriptData = {
      ...LOOP,
      segments: [
        LOOP.segments[0],
        { ...LOOP.segments[1], words: LOOP.segments[1].words.map(({ accent: _, ...w }) => w) },
      ],
    }
    expect(colors(transcriptToEditingScriptTextTrack(oneMark))).toEqual([
      [0, 0, 1],
      [0, 0, 0],
    ])
    // Words marked as not accented are marks too.
    const noAccents: TranscriptData = {
      ...LOOP,
      segments: LOOP.segments.map((s) => ({
        ...s,
        words: s.words.map((w) => ({ ...w, accent: false })),
      })),
    }
    expect(colors(transcriptToEditingScriptTextTrack(noAccents))).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
    expect(colors(transcriptToEditingScriptTextTrack(OLD))).toEqual([[0, 0, 0], [0]])
  })
})
