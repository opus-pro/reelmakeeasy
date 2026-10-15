import type { TranscriptData } from '@shared/types/agent/transcript'

import { CaptionSeg, VerticalAlign, XyPair } from '../types/render-plan-struct'
import { FactsTrack, Timeline } from '../types/video-script'

import { captionFrameAt, layoutCaptionSegment } from './caption/caption-layout'
import { captionStampColor } from './caption/caption-look'
import {
  CaptionRenderPref,
  captionSlotPositions,
  resolveCaptionRenderPref,
} from './caption/caption-style'
import { transcriptToEditingScriptTextTrack } from './caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from './caption/default-caption-render-pref'
import {
  SHORT_CAPTION_MAX_HOLD_GAP_MS,
  SHORT_CAPTION_MIN_MS,
  shortCaptionSegments,
} from './caption/short-captions'
import { TextAdapter } from './text-adapter'
import { getByPos } from './utils'

/** The render plan caption segments the editor and the export draw for `transcript`. */
async function captionSegs(
  transcript: TranscriptData,
  renderPref: CaptionRenderPref = getDefaultCaptionRenderPref(),
) {
  const track = await TextAdapter.genTextTrackFromTranscriptTrack({
    renderPref,
    track: transcriptToEditingScriptTextTrack(transcript),
  })
  return track?.segs ?? []
}

const words = (...times: Array<[string, number, number]>) =>
  times.map(([word, start, end]) => ({ end, start, word }))

const punch = (
  settings: Parameters<typeof resolveCaptionRenderPref>[0] = {},
  aspectRatio = '9:16',
) => resolveCaptionRenderPref({ preset: 'punch', ...settings }, { aspectRatio, kind: 'video' })

/** A normal video's sentence: no accent marks, no caption windows. */
const SENTENCE: TranscriptData = {
  language: 'en',
  segments: [
    {
      end: 2.4,
      start: 0.1,
      text: 'Honey never spoils, even after three thousand years.',
      words: words(
        ['Honey', 0.12, 0.4],
        ['never', 0.45, 0.7],
        ['spoils,', 0.75, 1.1],
        ['even', 1.15, 1.3],
        ['after', 1.32, 1.6],
        ['three', 1.62, 1.9],
        ['thousand', 1.92, 2.1],
        ['years.', 2.12, 2.4],
      ),
    },
    { end: 3.5, start: 2.9, text: 'Ever.', words: words(['Ever.', 3, 3.41]) },
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
    {
      end: 7.9,
      start: 4.15,
      text: 'in jars',
      words: [
        { end: 4.4, start: 4.15, word: 'in' },
        { accent: true, end: 4.9, start: 4.4, word: 'jars' },
      ],
    },
  ],
}

const FRAME = { height: 1920, width: 1080 }
// Monospaced stand-in metrics: the active-word rules don't depend on glyph shapes.
const measure = (text: string, font: { px: number }) => ({
  ascent: font.px * 0.8,
  height: font.px * 1.2,
  width: text.length * font.px * 0.6,
})

const layoutOf = (seg: CaptionSeg) =>
  layoutCaptionSegment(seg as unknown as Parameters<typeof layoutCaptionSegment>[0], FRAME, measure)

/** The words both renderers light at `now` ms into the caption (the engine's rules, as ported). */
const litWords = (layout: ReturnType<typeof layoutOf>, now: number): string[] | undefined =>
  captionFrameAt(layout, layout.segment.in + now, measure)
    ?.words.filter((w) => w.active)
    .map((w) => w.text)

/** Segments without their generated ids, to compare two builds. */
const withoutIds = (segs: CaptionSeg[]) => segs.map(({ id: _, ...seg }) => seg)

const shown = (segs: CaptionSeg[]) => segs.map((s) => [s.in, s.out, s.texts.map((t) => t.t)])

// TextAdapter writes vAlign on every caption segment; the render plan type doesn't name it.
const vAlignOf = (seg: CaptionSeg) => (seg as CaptionSeg & { vAlign?: VerticalAlign }).vAlign

describe('TextAdapter.genTextTrackFromTranscriptTrack', () => {
  it('keeps word times that already start one after another', async () => {
    const [seg] = await captionSegs({
      language: 'en',
      segments: [
        {
          end: 1.5,
          start: 0.5,
          text: 'honey never spoils',
          words: words(['honey', 0.5, 0.8], ['never', 0.8, 1.1], ['spoils', 1.2, 1.5]),
        },
      ],
    })
    expect([seg.in, seg.out]).toEqual([500, 1500])
    expect(seg.texts.map((t) => [t.t, t.in, t.out])).toEqual([
      ['HONEY', 0, 300],
      ['NEVER', 300, 600],
      ['SPOILS', 700, 1000],
    ])
  })

  it('starts every word at least 1 ms after the one before, so the engine drops none', async () => {
    const [seg] = await captionSegs({
      language: 'en',
      segments: [
        {
          end: 1.5,
          start: 0.5,
          text: 'a b c d e',
          words: words(
            ['a', 0.5, 0.5],
            ['b', 0.5, 0.5],
            ['c', 0.5, 0.9],
            ['d', 0.8, 1.2],
            ['e', 1.2, 1.5],
          ),
        },
      ],
    })
    expect(seg.texts.map((t) => [t.t, t.in, t.out])).toEqual([
      ['A', 0, 0],
      ['B', 1, 1],
      ['C', 2, 400],
      ['D', 300, 700],
      ['E', 700, 1000],
    ])
  })

  it('shows a loop chunk for its window and lights its accent word', async () => {
    const segs = await captionSegs({ ...LOOP, segments: LOOP.segments.slice(0, 2) })
    const { highlightColor } = getDefaultCaptionRenderPref()
    expect(segs.map((s) => [s.in, s.out])).toEqual([
      [150, 1200],
      [1200, 4000],
    ])
    expect(segs[0].texts.map((t) => [t.t, t.in, t.out, t.highlightColor])).toEqual([
      ['IT', 0, 150, undefined],
      ['LASTS', 150, 450, undefined],
      ['FOREVER', 450, 850, highlightColor.primary],
    ])
  })
})

describe('short captions (Punch, Explainer)', () => {
  it('splits a normal transcript into captions of 1-3 words, each held until the next', async () => {
    const segs = await captionSegs(SENTENCE, punch())
    // Broken after the comma, and the five words after it split 3 + 2, as loops chunk them.
    expect(shown(segs)).toEqual([
      [120, 1150, ['HONEY', 'NEVER', 'SPOILS,']],
      [1150, 1920, ['EVEN', 'AFTER', 'THREE']],
      [1920, 2400, ['THOUSAND', 'YEARS.']],
      [3000, 3410, ['EVER.']],
    ])
  })

  it('never holds a caption past its sentence, its segment or a long pause', async () => {
    const segs = await captionSegs(
      {
        language: 'en',
        segments: [
          {
            end: 3.9,
            start: 0,
            text: 'It works. Then it waits and stops.',
            words: words(
              ['It', 0, 0.2],
              ['works.', 0.25, 0.6],
              ['Then', 0.9, 1.1],
              ['it', 1.15, 1.3],
              ['waits', 1.35, 1.7],
              ['and', 2.8, 3.4],
              ['stops.', 3.45, 3.9],
            ),
          },
          {
            end: 6.2,
            start: 4,
            text: 'Then call Dr. Smith right away',
            words: words(
              ['Then', 4, 4.2],
              ['call', 4.2, 4.4],
              ['Dr.', 4.45, 4.7],
              ['Smith', 4.9, 5.2],
              ['right', 5.25, 5.5],
              ['away', 5.55, 6.2],
            ),
          },
        ],
      },
      punch(),
    )
    // "waits" ends at 1.7 s, "and" starts at 2.8 s: a pause longer than the hold limit.
    expect(2800 - 1700).toBeGreaterThan(SHORT_CAPTION_MAX_HOLD_GAP_MS)
    expect(shown(segs)).toEqual([
      // A sentence ends: off at its last word, not held over the gap.
      [0, 600, ['IT', 'WORKS.']],
      // A pause longer than the hold limit: off at its last word.
      [900, 1700, ['THEN', 'IT', 'WAITS']],
      // The segment's last caption ends with the segment.
      [2800, 3900, ['AND', 'STOPS.']],
      // "Dr." doesn't end a sentence: held until the next caption.
      [4000, 4900, ['THEN', 'CALL', 'DR.']],
      [4900, 6200, ['SMITH', 'RIGHT', 'AWAY']],
    ])
  })

  it('gives every caption time on screen when the transcript squashes word times', async () => {
    const explainer = resolveCaptionRenderPref(
      { preset: 'explainer' },
      { aspectRatio: '9:16', kind: 'video' },
    )
    const cases: Array<[TranscriptData, Array<[number, number, string[]]>]> = [
      [
        // The last word has no time of its own, at the segment's end: it joins the caption before.
        {
          language: 'en',
          segments: [
            {
              end: 1.2,
              start: 0,
              text: 'Wait for it, boom.',
              words: words(
                ['Wait', 0, 0.3],
                ['for', 0.3, 0.5],
                ['it,', 0.5, 0.9],
                ['boom.', 1.2, 1.2],
              ),
            },
          ],
        },
        [[0, 1200, ['WAIT', 'FOR', 'IT,', 'BOOM.']]],
      ],
      [
        // Two words start with the next caption's first word: they join that caption.
        {
          language: 'en',
          segments: [
            {
              end: 2,
              start: 0,
              text: 'So then everything changed.',
              words: words(
                ['So', 0.5, 0.5],
                ['then', 0.5, 0.5],
                ['everything', 0.5, 1.2],
                ['changed.', 1.2, 2],
              ),
            },
          ],
        },
        [[500, 2000, ['SO', 'THEN', 'EVERYTHING', 'CHANGED.']]],
      ],
      [
        // A squashed caption in the middle joins the next one; the others keep their windows.
        {
          language: 'en',
          segments: [
            {
              end: 1.9,
              start: 0,
              text: 'It works. Then it waits and stops.',
              words: words(
                ['It', 0, 0.2],
                ['works.', 0.25, 0.6],
                ['Then', 0.9, 0.9],
                ['it', 0.9, 0.9],
                ['waits', 0.9, 0.9],
                ['and', 0.9, 1.4],
                ['stops.', 1.45, 1.9],
              ),
            },
          ],
        },
        [
          [0, 600, ['IT', 'WORKS.']],
          [900, 1900, ['THEN', 'IT', 'WAITS', 'AND', 'STOPS.']],
        ],
      ],
      [
        // A caption up for a flash (60 ms, under two frames) joins its neighbour too.
        {
          language: 'en',
          segments: [
            {
              end: 1.06,
              start: 0,
              text: 'Ready? Go!',
              words: words(['Ready?', 0, 0.5], ['Go!', 1, 1.06]),
            },
          ],
        },
        [[0, 1060, ['READY?', 'GO!']]],
      ],
    ]
    for (const [transcript, expected] of cases) {
      for (const pref of [punch(), explainer]) {
        const segs = await captionSegs(transcript, pref)
        // Explainer is in sentence case.
        expect(segs.map((s) => [s.in, s.out, s.texts.map((t) => t.t?.toUpperCase())])).toEqual(
          expected,
        )
        for (const seg of segs) {
          expect(seg.out - seg.in).toBeGreaterThanOrEqual(SHORT_CAPTION_MIN_MS)
        }
      }
    }
  })

  it("accents each caption's longest word that isn't filler when the transcript marks none", async () => {
    const segs = await captionSegs(SENTENCE, punch())
    const accent = punch().highlightColor.primary
    expect(
      segs.map((s) => s.texts.filter((t) => t.highlightColor === accent).map((t) => t.t)),
    ).toEqual([['SPOILS,'], ['THREE'], ['THOUSAND'], ['EVER.']])
  })

  it("leaves a loop transcript's chunks as they are", async () => {
    // Every chunk is already one chunk: the very same segments come back.
    const stored = transcriptToEditingScriptTextTrack(LOOP).segments
    const chunked = shortCaptionSegments(stored)
    expect(chunked).toHaveLength(stored.length)
    expect(chunked.every((segment, i) => segment === stored[i])).toBe(true)

    const segs = await captionSegs(LOOP, punch())
    // Same captions, same windows (held until the next chunk or the clip end), same accents.
    expect(shown(segs)).toEqual([
      [150, 1200, ['IT', 'LASTS', 'FOREVER']],
      [1200, 4000, ['IN', 'SEALED', 'JARS']],
      [4150, 7900, ['IN', 'JARS']],
    ])
    const accent = punch().highlightColor.primary
    expect(segs.map((s) => s.texts.findIndex((t) => t.highlightColor === accent))).toEqual([
      2, 1, 1,
    ])
    // A loop transcript without accent marks takes the same accents.
    const unmarked: TranscriptData = {
      ...LOOP,
      segments: LOOP.segments.map((s) => ({
        ...s,
        words: s.words.map(({ accent: _, ...w }) => w),
      })),
    }
    expect(withoutIds(await captionSegs(unmarked, punch()))).toEqual(withoutIds(segs))
  })

  it('keeps the accent lit for the whole caption and lights no other word', async () => {
    for (const pref of [
      punch(),
      resolveCaptionRenderPref({ preset: 'explainer' }, { aspectRatio: '9:16', kind: 'video' }),
    ]) {
      for (const seg of [
        ...(await captionSegs(LOOP, pref)),
        ...(await captionSegs(SENTENCE, pref)),
      ]) {
        const accent = seg.texts.find((t) => t.highlightColor !== undefined)?.t
        const t = seg.out - seg.in
        const layout = layoutOf(seg)
        for (let now = 0; now < t; now += 10) {
          expect([now, litWords(layout, now)]).toEqual([now, [accent]])
        }
        expect([t - 1, litWords(layout, t - 1)]).toEqual([t - 1, [accent]])
        expect(litWords(layout, t)).toBeUndefined()
      }
    }
  })

  it('starts each rewritten word at least 500 ms after the one before and keeps it 400 ms or more', async () => {
    for (const seg of [
      ...(await captionSegs(LOOP, punch())),
      ...(await captionSegs(SENTENCE, punch())),
    ]) {
      const lengths = seg.texts.map((word) => word.out - word.in)
      const steps = seg.texts.slice(1).map((word, i) => word.in - seg.texts[i].in)
      expect(Math.min(...lengths)).toBeGreaterThanOrEqual(400)
      expect(Math.min(Infinity, ...steps)).toBeGreaterThanOrEqual(500)
    }
    // "in SEALED jars" over 2.8 s: the accent at 0, "in" before the caption, "jars" after it.
    const [, sealed] = await captionSegs(LOOP, punch())
    expect(sealed.texts.map((t) => [t.t, t.in, t.out])).toEqual([
      ['IN', -500, -100],
      ['SEALED', 0, 2800],
      ['JARS', 3300, 3700],
    ])
  })

  it('leaves the stored caption track as it is', async () => {
    for (const transcript of [SENTENCE, LOOP]) {
      const track = transcriptToEditingScriptTextTrack(transcript)
      const stored = structuredClone(track)
      await TextAdapter.genTextTrackFromTranscriptTrack({ renderPref: punch(), track })
      expect(track).toEqual(stored)
    }
  })

  it('keeps the real word times for Classic', async () => {
    const segs = await captionSegs(
      LOOP,
      resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'video' }),
    )
    expect(segs[1].texts.map((t) => [t.t, t.in, t.out])).toEqual([
      ['IN', 0, 200],
      ['SEALED', 200, 600],
      ['JARS', 600, 1100],
    ])
    // And doesn't split a long caption.
    expect(
      await captionSegs(
        SENTENCE,
        resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'video' }),
      ),
    ).toHaveLength(2)
  })

  it('draws Punch in the highlight preset, sized and laid out from the pref', async () => {
    const pref = punch({ accent: '#FF3EA5', size: 120 })
    const [seg] = await captionSegs(SENTENCE, pref)
    expect(seg.uri).toBe('caption-preset://word-level_highlight_color')
    expect(seg.lineCount).toBe(3)
    expect(seg.style.fontSize).toBe(54)
    expect(seg.texts.find((t) => t.t === 'SPOILS,')?.highlightColor).toBe('#ff3ea5')
    expect(seg.rotate).toBeUndefined()
  })

  it("lays a 16:9 video's captions out for a wide frame", async () => {
    const [seg] = await captionSegs(SENTENCE, punch({}, '16:9'))
    const wide = getByPos('bottom', 'landscape')
    expect(wide.position).not.toEqual(getByPos('bottom', 'portrait').position)
    expect([seg.position, vAlignOf(seg)]).toEqual([wide.position, VerticalAlign.middle])
  })

  it('aligns Punch and Explainer on the middle at every height, so a slider tick never moves them', async () => {
    const ticks = captionSlotPositions('9:16')
    for (const preset of ['punch', 'explainer'] as const) {
      const at = (position: null | number) =>
        resolveCaptionRenderPref({ position, preset }, { aspectRatio: '9:16', kind: 'video' })
      // The default slot and the slider's Bottom tick: one place, one alignment.
      const [slot] = await captionSegs(SENTENCE, at(null))
      const [tick] = await captionSegs(SENTENCE, at(ticks.bottom))
      const heightOf = (seg: CaptionSeg) => (seg.position as XyPair)[1]
      expect(heightOf(tick)).toBeCloseTo(heightOf(slot), 2)
      expect([vAlignOf(slot), vAlignOf(tick)]).toEqual([VerticalAlign.middle, VerticalAlign.middle])
      // Any other height, and the named slots an older pref may hold.
      for (const pref of [
        at(ticks.top),
        at(ticks.middle),
        at(30),
        { ...at(null), captionPosition: 'top' as const },
        { ...at(null), captionPosition: 'middle' as const },
      ]) {
        const [seg] = await captionSegs(SENTENCE, pref)
        expect(vAlignOf(seg)).toBe(VerticalAlign.middle)
      }
    }
  })

  it("puts a custom height at the caption's centre in both renderers", async () => {
    const classic = resolveCaptionRenderPref(
      { position: 30 },
      { aspectRatio: '9:16', kind: 'video' },
    )
    for (const [pref, vAlign] of [
      [punch({ position: 30 }), VerticalAlign.middle],
      // Classic keeps the alignment it had before presets, the bottom slot's: the engine centres
      // a caption on its position with either (calibrated to half a pixel), so it doesn't move.
      [classic, getByPos('bottom', 'portrait').vAlign],
    ] as const) {
      const [seg] = await captionSegs(SENTENCE, pref)
      // The engine: a centre-based position.
      expect([seg.position, vAlignOf(seg)]).toEqual([[0, 0.4], vAlign])
      // The export painter: the caption texture is centred 30% down the frame.
      const layout = layoutOf(seg)
      expect(layout.texture.centerY / FRAME.height).toBeCloseTo(0.3, 6)
    }
  })

  it('tilts Explainer captions one way, then the other', async () => {
    const pref = resolveCaptionRenderPref(
      { preset: 'explainer' },
      { aspectRatio: '9:16', kind: 'video' },
    )
    const segs = await captionSegs(SENTENCE, pref)
    expect(segs.map((s) => s.rotate)).toEqual([1.2, -1.2, 1.2, -1.2])
    // Sentence case on Explainer.
    expect(segs[0].texts.map((t) => t.t)).toEqual(['Honey', 'never', 'spoils,'])
  })
})

describe('TextAdapter.genCaptionTextTracks', () => {
  const explainer = () =>
    resolveCaptionRenderPref({ preset: 'explainer' }, { aspectRatio: '9:16', kind: 'video' })
  const layersOf = (renderPref: CaptionRenderPref, noCaptionTimeline?: Timeline[]) =>
    TextAdapter.genCaptionTextTracks({
      noCaptionTimeline,
      renderPref,
      track: transcriptToEditingScriptTextTrack(SENTENCE),
    })
  /** What a layer draws, without the ids and the strip's own look. */
  const placed = (s: CaptionSeg) => ({
    font: [s.style.fontFamily, s.style.fontSize, s.style.fontWeight],
    lineCount: s.lineCount,
    position: s.position,
    rotate: s.rotate,
    scale: s.scale,
    texts: s.texts.map((w) => [w.t, w.in, w.out]),
    time: [s.in, s.out],
    vAlign: vAlignOf(s),
  })

  it('gives Classic and Punch one layer: the caption track', async () => {
    for (const pref of [getDefaultCaptionRenderPref(), punch()]) {
      const layers = await layersOf(pref)
      expect(layers.map((t) => t.id)).toEqual(['#CaptionTrack'])
      expect(withoutIds(layers[0].segs)).toEqual(withoutIds(await captionSegs(SENTENCE, pref)))
    }
  })

  it("gives Explainer its strip under the caption, on the caption's own words, place and tilt", async () => {
    const layers = await layersOf(explainer())
    expect(layers.map((t) => t.id)).toEqual(['#CaptionStripTrack', '#CaptionTrack'])
    const [strip, caption] = layers
    expect(withoutIds(caption.segs)).toEqual(withoutIds(await captionSegs(SENTENCE, explainer())))
    expect(strip.segs.map(placed)).toEqual(caption.segs.map(placed))
    expect(strip.segs.every((s) => s.uri === 'caption-preset://deep-diver')).toBe(true)
  })

  it('hides the strip wherever it hides the caption', async () => {
    // A title card over the second caption.
    const [strip, caption] = await layersOf(explainer(), [{ in: 1200, out: 1500 }])
    expect(caption.segs.map((s) => s.in)).toEqual([120, 1920, 3000])
    expect(strip.segs.map(placed)).toEqual(caption.segs.map(placed))
  })

  it('gives no layers when the captions are off', async () => {
    expect(await layersOf({ ...explainer(), enableCaption: false })).toEqual([])
  })
})

describe('TextAdapter.genFactStampTrack', () => {
  const fact = (k: number, text: string): FactsTrack['segments'][number] => ({
    content: { id: `content-fact-${k}`, text },
    id: `segment-fact-${k}`,
    timeline: { in: k * 4000 + 300, out: k * 4000 + 3000 },
  })
  /** A loop's stored fact stamps: clips 1, 3 and 4 have one. */
  const facts: FactsTrack = {
    id: 'track-facts',
    segments: [fact(0, 'c. 2560 BC'), fact(2, '1969 AD'), fact(3, '3,000 years')],
    type: 'facts',
  }
  const loop = (settings: Parameters<typeof resolveCaptionRenderPref>[0]) =>
    resolveCaptionRenderPref(settings, { aspectRatio: '9:16', kind: 'loop' })
  const stripsOf = (renderPref: CaptionRenderPref) =>
    TextAdapter.genFactStampTrack({ renderPref, track: facts }).segs.map(
      (seg) => (seg.style as { animationBgColor?: string }).animationBgColor,
    )

  it('draws each stored stamp as its own stamp segment, over its own window', () => {
    const track = TextAdapter.genFactStampTrack({ renderPref: loop(null), track: facts })
    expect(track.id).toBe('#FactStampTrack')
    expect(track.type).toBe('t')
    expect(track.segs.map((s) => [s.in, s.out, s.texts.map((w) => w.t)])).toEqual([
      [300, 3000, ['c. 2560 BC']],
      [8300, 11_000, ['1969 AD']],
      [12_300, 15_000, ['3,000 years']],
    ])
    expect(track.segs.map((s) => s.uri)).toEqual(new Array(3).fill('caption-preset://deep-diver'))
    // The tilt alternates by place among the stamps, not by clip.
    expect(track.segs.map((s) => s.rotate)).toEqual([-3, 3, -3])
  })

  it("colours the strips in the look's highlight: Explainer's box colour, Punch's after its near-white guard", () => {
    const explainer = loop({ accent: '#FF3EA5', preset: 'explainer' })
    expect(stripsOf(getDefaultCaptionRenderPref())).toEqual(new Array(3).fill('#04f827'))
    expect(stripsOf(explainer)).toEqual(new Array(3).fill(captionStampColor(explainer)))
    expect(stripsOf(explainer)[0]?.toUpperCase()).toBe('#FF3EA5')
    expect(stripsOf(loop({ accent: '#FFFFFF', preset: 'punch' }))[0]?.toUpperCase()).toBe('#04F827')
  })

  it('keeps the stamps when the caption style turns the captions off', () => {
    const renderPref = { ...loop(null), enableCaption: false }
    expect(TextAdapter.genFactStampTrack({ renderPref, track: facts }).segs).toHaveLength(3)
  })

  it('places them on a loop frame unless told another, and points the editor at the face', () => {
    const fontGzipPath = 'http://localhost:5017/api/presets/v007/render/fonts.tar.gz'
    const [seg] = TextAdapter.genFactStampTrack({
      fontGzipPath,
      frame: { height: 1920, width: 1080 },
      renderPref: loop(null),
      track: facts,
    }).segs
    expect(seg.style.fontGzipPath).toBe(fontGzipPath)
    const [byDefault] = TextAdapter.genFactStampTrack({ renderPref: loop(null), track: facts }).segs
    expect(byDefault.position).toEqual(seg.position)
    expect(byDefault.style.fontGzipPath).toBeUndefined()
  })
})

describe('TextAdapter.genCaptionTextTracks with a chosen font', () => {
  const PACK = 'http://localhost:5017/api/presets/v007/render/fonts.tar.gz'
  const VIDEO = { aspectRatio: '9:16', kind: 'video' } as const
  const layersOf = (renderPref: CaptionRenderPref, fontGzipPath?: string) =>
    TextAdapter.genCaptionTextTracks({
      fontGzipPath,
      renderPref,
      track: transcriptToEditingScriptTextTrack(SENTENCE),
    })
  const fontOf = (s: CaptionSeg) => {
    const style = s.style as CaptionSeg['style'] & { fontGzipPath?: string; fontPaths?: string[] }
    return {
      fontFamily: style.fontFamily,
      fontGzipPath: style.fontGzipPath,
      fontWeight: style.fontWeight,
      italic: style.italic,
    }
  }

  it('changes nothing with the style default font, even when the preview names the pack', async () => {
    for (const preset of ['classic', 'punch', 'explainer'] as const) {
      const pref = resolveCaptionRenderPref({ font: null, preset }, VIDEO)
      const segsOf = async (fontGzipPath?: string) =>
        (await layersOf(pref, fontGzipPath)).map((layer) => withoutIds(layer.segs))
      expect(await segsOf(PACK)).toEqual(await segsOf())
      for (const layer of await layersOf(pref, PACK)) {
        expect(layer.segs.every((s) => s.style.fontFamily === 'Montserrat')).toBe(true)
        expect(layer.segs.every((s) => !('fontGzipPath' in s.style) || !s.style.fontGzipPath)).toBe(
          true,
        )
      }
    }
  })

  it('loads the render pack in the preview, with Montserrat after the family', async () => {
    const pref = resolveCaptionRenderPref(
      { font: { family: 'Anton', source: 'pack' }, preset: 'punch' },
      VIDEO,
    )
    const [caption] = await layersOf(pref, PACK)
    expect(caption.segs.length).toBeGreaterThan(0)
    for (const seg of caption.segs) {
      expect(fontOf(seg)).toEqual({
        fontFamily: 'Anton, Montserrat',
        fontGzipPath: PACK,
        fontWeight: 400,
        italic: false,
      })
    }
  })

  it("gives both of Explainer's layers the same font fields", async () => {
    const pref = resolveCaptionRenderPref(
      { font: { family: 'Roboto Serif', source: 'pack' }, preset: 'explainer' },
      VIDEO,
    )
    const [strip, caption] = await layersOf(pref, PACK)
    expect(strip.segs.map(fontOf)).toEqual(caption.segs.map(fontOf))
    expect(fontOf(caption.segs[0])).toEqual({
      fontFamily: 'Roboto Serif, Montserrat',
      fontGzipPath: PACK,
      fontWeight: 600,
      italic: false,
    })
  })

  it('names the family alone for the export, which reads no archive', async () => {
    const pref = resolveCaptionRenderPref({ font: { family: 'PT Serif', source: 'pack' } }, VIDEO)
    const [caption] = await layersOf(pref)
    expect(fontOf(caption.segs[0])).toEqual({
      fontFamily: 'PT Serif',
      fontGzipPath: undefined,
      fontWeight: 700,
      italic: false,
    })
  })
})
