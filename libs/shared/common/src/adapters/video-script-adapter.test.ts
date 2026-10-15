import * as fs from 'node:fs'
import * as path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'

import { CaptionSeg, SegType, Track } from '../types/render-plan-struct'
import { FactsTrack, VideoScript } from '../types/video-script'
import { genNanoId } from '../utils/gen-nano-id'

import { CaptionRenderPref, readableInk, resolveCaptionRenderPref } from './caption/caption-style'
import { transcriptToEditingScriptTextTrack } from './caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from './caption/default-caption-render-pref'
import { TextAdapter } from './text-adapter'
import { VideoScriptAdapter } from './video-script-adapter'

jest.mock('../utils/gen-nano-id', () => ({ genNanoId: jest.fn() }))

let nanoIds = 0
beforeEach(() => {
  nanoIds = 0
  jest.mocked(genNanoId).mockImplementation(() => String(++nanoIds))
})

/** A normal video's transcript, as transcripts were before accents and caption windows. */
const OLD: TranscriptData = {
  language: 'en',
  segments: [
    {
      end: 2.4,
      start: 0.1,
      text: 'Honey never spoils, even after three thousand years.',
      words: [
        { end: 0.4, start: 0.12, word: 'Honey' },
        { end: 0.7, start: 0.45, word: 'never' },
        { end: 1.1, start: 0.75, word: 'spoils,' },
        { end: 1.3, start: 1.15, word: 'even' },
        { end: 1.6, start: 1.32, word: 'after' },
        { end: 1.9, start: 1.62, word: 'three' },
        { end: 2.1, start: 1.92, word: 'thousand' },
        { end: 2.4, start: 2.12, word: 'years.' },
      ],
    },
    { end: 3.5, start: 2.9, text: 'Ever.', words: [{ end: 3.41, start: 3, word: 'Ever.' }] },
  ],
}

const explainer = (forcedHideCaptionBg = true) =>
  renderPlanTracks(
    resolveCaptionRenderPref({ preset: 'explainer' }, { aspectRatio: '9:16', kind: 'video' }),
    transcriptToEditingScriptTextTrack(OLD),
    forcedHideCaptionBg,
  )

async function planTracks(
  captionRenderPref: CaptionRenderPref,
  tracks: VideoScript['tracks'],
  forcedHideCaptionBg = true,
) {
  const plan = await VideoScriptAdapter.genRenderPlan({
    captionRenderPref,
    forcedHideCaptionBg,
    getAllTemplatesSpec: async () => [],
    getFallbackFontPath: async () => 'font.ttf',
    getFilePath: async (url: string) => `media/${url.split('/').at(-1)}`,
    getMediaMetadata: async () => ({ height: 1920, width: 1080 }),
    getTemplateAssetPath: async () => '',
    getVideoFps: () => '30',
    outputSize: { height: 1920, width: 1080 },
    rootDir: '/tmp/root',
    videoScript: { tracks },
  })
  return plan?.tracks ?? []
}

async function renderPlanTracks(
  captionRenderPref: CaptionRenderPref,
  track: ReturnType<typeof transcriptToEditingScriptTextTrack>,
  forcedHideCaptionBg: boolean,
) {
  return planTracks(captionRenderPref, [track], forcedHideCaptionBg)
}

/** The text segments render-plan-ffmpeg's collectClips keeps: anything else fails the export. */
const exportKeeps = (seg: { type: SegType; uri?: string }) =>
  seg.type === SegType.Text && Boolean(seg.uri?.startsWith('caption-preset://'))

const styleOf = (seg: CaptionSeg) => seg.style as Record<string, unknown>

describe('VideoScriptAdapter.genRenderPlan captions', () => {
  it('gives Classic the same caption track and render plan as before', async () => {
    // Written by the adapter before caption presets (genNanoId numbered from 1, in this order).
    const golden = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'video-script-adapter.golden.json'), 'utf8'),
    ) as Record<'forced' | 'track' | 'unforced', unknown>
    for (const pref of [
      getDefaultCaptionRenderPref(),
      resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'video' }),
    ]) {
      nanoIds = 0
      const track = transcriptToEditingScriptTextTrack(OLD)
      expect(JSON.stringify(track)).toBe(JSON.stringify(golden.track))
      const forced = await renderPlanTracks(pref, track, true)
      expect(JSON.stringify(forced)).toBe(JSON.stringify(golden.forced))
      const unforced = await renderPlanTracks(pref, track, false)
      expect(JSON.stringify(unforced)).toBe(JSON.stringify(golden.unforced))
    }
  })

  it('draws Explainer as a paper strip under the caption, on the same words in the same place', async () => {
    const pref = resolveCaptionRenderPref(
      { preset: 'explainer' },
      { aspectRatio: '9:16', kind: 'video' },
    )
    const tracks = await explainer()
    expect(tracks.map((t) => t.id)).toEqual(['#CaptionStripTrack', '#CaptionTrack'])
    const [strip, caption] = tracks as Array<Track<CaptionSeg>>
    expect(caption.segs).toHaveLength(4)
    expect(strip.segs).toHaveLength(caption.segs.length)

    const placed = (s: CaptionSeg) => ({
      font: [s.style.fontFamily, s.style.fontSize, s.style.fontWeight, s.style.italic],
      lineCount: s.lineCount,
      position: s.position,
      rotate: s.rotate,
      scale: s.scale,
      texts: s.texts.map((w) => [w.t, w.in, w.out]),
      time: [s.in, s.out],
      vAlign: (s as CaptionSeg & { vAlign?: string }).vAlign,
    })
    expect(strip.segs.map(placed)).toEqual(caption.segs.map(placed))
    expect(caption.segs.map((s) => s.rotate)).toEqual([1.2, -1.2, 1.2, -1.2])
    expect(caption.segs[0].style).toMatchObject({ fontFamily: 'Montserrat', fontWeight: 700 })

    // (a) The strip: paper behind the whole caption, dark ink, no outline or shadow.
    for (const seg of strip.segs) {
      expect(seg.uri).toBe('caption-preset://deep-diver')
      expect(styleOf(seg)).toMatchObject({
        animationBgColor: pref.strip?.color,
        animationColor: pref.strip?.ink,
        borderRadius: 0,
        fontColor: pref.strip?.ink,
        strokeWidth: 0,
      })
      expect(Object.keys(seg.style).filter((k) => k.startsWith('shadow'))).toEqual([])
      expect(seg.texts.every((w) => w.highlightColor === undefined)).toBe(true)
    }
    // (b) The caption: the accent word boxed in the highlight, in ink that reads on it.
    const ink = readableInk('#04F827').toLowerCase()
    for (const seg of caption.segs) {
      expect(seg.uri).toBe('caption-preset://word-level_simple_bg-highlight')
      expect(styleOf(seg)).toMatchObject({ animationBgColor: '#04f827', animationColor: ink })
      expect(seg.texts.filter((w) => w.highlightColor === ink)).toHaveLength(1)
    }
  })

  it('keeps the strip when the caption cover is turned off, and adds no cover under it', async () => {
    for (const forcedHideCaptionBg of [true, false]) {
      const tracks = await explainer(forcedHideCaptionBg)
      expect(tracks.map((t) => t.id)).toEqual(['#CaptionStripTrack', '#CaptionTrack'])
    }
  })

  it('draws the caption layers TextAdapter.genCaptionTextTracks gives the editor preview', async () => {
    const withoutIds = (tracks: Array<{ id: string; segs?: unknown }>) =>
      tracks.map((t) => [t.id, (t.segs as CaptionSeg[]).map(({ id: _, ...seg }) => seg)])
    for (const preset of ['classic', 'explainer', 'punch'] as const) {
      const pref = resolveCaptionRenderPref({ preset }, { aspectRatio: '9:16', kind: 'video' })
      const track = transcriptToEditingScriptTextTrack(OLD)
      const tracks = await renderPlanTracks(pref, track, false)
      const layers = await TextAdapter.genCaptionTextTracks({ renderPref: pref, track })
      // The render plan adds Classic's cover under them, and nothing else.
      expect(withoutIds(tracks.filter((t) => !t.id.startsWith('#CaptionBgTrack')))).toEqual(
        withoutIds(layers),
      )
    }
  })

  it("keeps a loop's fact stamps when the captions are off, and draws them over the captions", async () => {
    const facts: FactsTrack = {
      id: 'track-facts',
      segments: [
        {
          content: { id: 'content-fact-0', text: 'c. 2560 BC' },
          id: 'segment-fact-0',
          timeline: { in: 300, out: 3000 },
        },
      ],
      type: 'facts',
    }
    const captions = transcriptToEditingScriptTextTrack(OLD)
    const punch = resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' })
    const stamps = TextAdapter.genFactStampTrack({ renderPref: punch, track: facts })

    const on = await planTracks(punch, [captions, facts])
    expect(on.map((t) => t.id)).toEqual(['#CaptionTrack', '#FactStampTrack'])
    expect(on.at(-1)).toEqual(stamps)

    const off = await planTracks({ ...punch, enableCaption: false }, [captions, facts])
    expect(off.map((t) => t.id)).toEqual(['#FactStampTrack'])
    // Still in the video's highlight colour.
    expect(off[0]).toEqual(stamps)
    expect(styleOf((off[0] as Track<CaptionSeg>).segs[0])).toMatchObject({
      animationBgColor: '#04f827',
    })
  })

  it('adds no track for a loop without stamps (its empty facts track)', async () => {
    const facts: FactsTrack = { id: 'track-facts', segments: [], type: 'facts' }
    const punch = resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' })

    const tracks = await planTracks(punch, [transcriptToEditingScriptTextTrack(OLD), facts])
    expect(tracks.map((t) => t.id)).toEqual(['#CaptionTrack'])
  })

  it('hands the export only caption segments it draws', async () => {
    for (const preset of ['classic', 'explainer', 'punch'] as const) {
      const pref = resolveCaptionRenderPref({ preset }, { aspectRatio: '9:16', kind: 'video' })
      const tracks = await renderPlanTracks(pref, transcriptToEditingScriptTextTrack(OLD), true)
      const segs = tracks.flatMap((t) => ('segs' in t ? (t.segs as CaptionSeg[]) : []))
      expect(segs.length).toBeGreaterThan(0)
      expect(segs.filter((s) => !exportKeeps(s))).toEqual([])
    }
  })
})
