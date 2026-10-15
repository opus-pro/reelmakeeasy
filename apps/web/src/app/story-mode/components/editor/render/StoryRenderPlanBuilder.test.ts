/**
 * @jest-environment node
 */
// The builder is pure; under jsdom, nanoid (the caption ids) resolves to its ESM browser build.
import { captionFontPt, captionScalePx } from '@reelmakeeasy/common/adapters/caption/caption-layout'
import { resolveCaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { transcriptToEditingScriptTextTrack } from '@reelmakeeasy/common/adapters/caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/default-caption-render-pref'
import {
  factStampLabelOnStrip,
  type FactStampStripImage,
  factStampStripImage,
  factStampStripSeg,
} from '@reelmakeeasy/common/adapters/caption/fact-stamps'
import { TextAdapter } from '@reelmakeeasy/common/adapters/text-adapter'
import { getByPos } from '@reelmakeeasy/common/adapters/utils'
import { getDeliveryCanvasSize } from '@reelmakeeasy/common/long-take/render-frame-area'
import type { CaptionSeg, RenderPlan, VideoSeg } from '@reelmakeeasy/common/types/render-plan-struct'
import { TrackType } from '@reelmakeeasy/common/types/render-plan-struct'
import type { FactsTrack, VideoScript } from '@reelmakeeasy/common/types/video-script'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

import type { StorySegment, StoryTransitionSegment } from '@/app/story-mode/long-take.types'

import { StoryRenderPlanBuilder } from './StoryRenderPlanBuilder'

// Two loop chunks: each is held on screen until the next one starts.
const transcript: TranscriptData = {
  language: 'en',
  segments: [
    {
      end: 2,
      start: 0,
      text: 'honey never',
      words: [
        { end: 0.4, start: 0, word: 'honey' },
        { end: 0.9, start: 0.5, word: 'never' },
      ],
    },
    {
      end: 4,
      start: 2,
      text: 'spoils',
      words: [{ end: 2.6, start: 2, word: 'spoils' }],
    },
  ],
}

// Caption and word ids are random: everything else must match.
const withoutIds = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, v) => (key === 'id' ? undefined : v)))

async function captionSegs(input: {
  aspectRatio?: string
  captionKind?: 'loop' | 'video'
  captionStyle?: CaptionStyleSettings | null
  videoScript?: VideoScript
}): Promise<CaptionSeg[]> {
  const plan: RenderPlan = await StoryRenderPlanBuilder.build({
    aspectRatio: input.aspectRatio ?? '9 / 16',
    captionEnabled: true,
    captionKind: input.captionKind,
    captionStyle: input.captionStyle,
    segments: [],
    totalMs: 4000,
    transcript,
    videoScript: input.videoScript,
  })
  const track = plan.tracks.find((t) => t.id === 'CaptionTrack' || t.segs[0]?.type === 't')
  return (track?.segs ?? []) as CaptionSeg[]
}

describe('StoryRenderPlanBuilder captions', () => {
  it('draws the look the user is choosing, not the one frozen in the video script', async () => {
    const videoScript: VideoScript = {
      captionRenderPref: getDefaultCaptionRenderPref(),
      tracks: [transcriptToEditingScriptTextTrack(transcript)],
    } as VideoScript
    const [seg] = await captionSegs({
      captionStyle: { accent: '#FF3EA5', preset: 'punch' },
      videoScript,
    })
    expect(seg.uri).toBe('caption-preset://word-level_highlight_color')
    expect(seg.style.fontSize).toBe(45)
    // The engine reads the highlight from the style (not in WordStyle's type).
    expect((seg.style as { animationColor?: string }).animationColor).toBe('#ff3ea5')
  })

  it('starts a loop in Punch when nothing was chosen', async () => {
    const [seg] = await captionSegs({ captionKind: 'loop', captionStyle: null })
    expect(seg.uri).toBe('caption-preset://word-level_highlight_color')
  })

  it('keeps every other video in Classic when nothing was chosen', async () => {
    const [seg] = await captionSegs({ captionStyle: null })
    expect(seg.uri).toBe('caption-preset://word-level_karaoke_fill-pop')
    expect(seg.style.fontSize).toBe(35)
  })

  it("holds each chunk of a loop's transcript until the next one, even without the flag", async () => {
    const segs = await captionSegs({ captionKind: 'loop' })
    expect(segs.map((s) => [s.in, s.out])).toEqual([
      [0, 2000],
      [2000, 4000],
    ])
  })

  it("ends a plain video's caption at its last word", async () => {
    const segs = await captionSegs({ captionKind: 'video' })
    expect(segs.map((s) => [s.in, s.out])).toEqual([
      [0, 900],
      [2000, 2600],
    ])
  })

  it('places the captions at the chosen height and for the frame', async () => {
    const [custom] = await captionSegs({ captionStyle: { position: 30 } })
    expect(custom.position).toEqual([0, 0.4])
    const [landscape] = await captionSegs({ aspectRatio: '16 / 9', captionStyle: null })
    expect(landscape.position).toEqual(getByPos('bottom', 'landscape').position)
  })

  it("lays a loop's captions out for 9:16 whatever ratio its row names, as its render does", async () => {
    const [loop] = await captionSegs({
      aspectRatio: '16 / 9',
      captionKind: 'loop',
      captionStyle: { preset: 'classic' },
    })
    expect(loop.position).toEqual(getByPos('bottom', 'portrait').position)
  })

  it("draws Explainer's paper strip under its words, the layers the export draws", async () => {
    const plan = await StoryRenderPlanBuilder.build({
      aspectRatio: '9 / 16',
      captionEnabled: true,
      captionKind: 'loop',
      captionStyle: { accent: '#FFE500', preset: 'explainer' },
      segments: [],
      totalMs: 4000,
      transcript,
    })
    const layers = await TextAdapter.genCaptionTextTracks({
      renderPref: resolveCaptionRenderPref(
        { accent: '#FFE500', preset: 'explainer' },
        { aspectRatio: '9:16', kind: 'loop' },
      ),
      track: transcriptToEditingScriptTextTrack({ ...transcript, captionWindows: 'segment' }),
    })
    const textTracks = plan.tracks.filter((t) => t.segs.some((s) => s.type === 't'))
    expect(layers).toHaveLength(2)
    // Bottom first: the strip, then the words on it.
    expect(withoutIds(textTracks)).toEqual(withoutIds(layers))
  })

  it('draws a style without a strip as one caption layer', async () => {
    const plan = await StoryRenderPlanBuilder.build({
      aspectRatio: '9 / 16',
      captionEnabled: true,
      captionKind: 'loop',
      captionStyle: null,
      segments: [],
      totalMs: 4000,
      transcript,
    })
    expect(plan.tracks.filter((t) => t.segs.some((s) => s.type === 't'))).toHaveLength(1)
  })

  it('draws no captions when they are off', async () => {
    const plan = await StoryRenderPlanBuilder.build({
      aspectRatio: '9 / 16',
      captionEnabled: false,
      captionKind: 'loop',
      segments: [],
      totalMs: 4000,
      transcript,
    })
    expect(plan.tracks.some((t) => t.segs.some((s) => s.type === 't'))).toBe(false)
  })
})

describe('StoryRenderPlanBuilder fact stamps', () => {
  const fact = (k: number, text: string): FactsTrack['segments'][number] => ({
    content: { id: `content-fact-${k}`, text },
    id: `segment-fact-${k}`,
    timeline: { in: k * 4000 + 300, out: k * 4000 + 3000 },
  })
  const facts: FactsTrack = {
    id: 'track-facts',
    segments: [fact(0, 'c. 2560 BC'), fact(1, '1969 AD')],
    type: 'facts',
  }
  // What a loop's render saves: its captions, then its stamps.
  const loopScript = {
    tracks: [
      transcriptToEditingScriptTextTrack({ ...transcript, captionWindows: 'segment' }),
      facts,
    ],
  } as VideoScript

  const build = (over: Partial<Parameters<typeof StoryRenderPlanBuilder.build>[0]> = {}) =>
    StoryRenderPlanBuilder.build({
      aspectRatio: '9 / 16',
      captionEnabled: true,
      captionKind: 'loop',
      captionStyle: null,
      segments: [],
      totalMs: 8000,
      transcript,
      videoScript: loopScript,
      ...over,
    })
  const textTracks = (plan: RenderPlan) =>
    plan.tracks.filter((t) => t.segs.some((s) => s.type === 't'))
  const stampsOf = (plan: RenderPlan) =>
    plan.tracks.find((t) => t.id === '#FactStampTrack')?.segs as CaptionSeg[] | undefined
  const stripOf = (seg: CaptionSeg) => (seg.style as { animationBgColor?: string }).animationBgColor

  it("draws a loop's fact stamps over its captions, as its export draws them", async () => {
    const plan = await build()
    expect(textTracks(plan).map((t) => t.id)).toEqual(['#CaptionTrack', '#FactStampTrack'])
    const stamps = stampsOf(plan) ?? []
    const renderPref = resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' })
    const exported = TextAdapter.genFactStampTrack({ renderPref, track: facts }).segs
    // The same segments, place and look, with the face for the editor to load.
    expect(
      stamps.map(({ style: { fontGzipPath: _, ...style }, ...seg }) => ({ ...seg, style })),
    ).toEqual(exported)
    expect(stamps.map((s) => [s.in, s.out, s.texts[0]?.t, s.rotate])).toEqual([
      [300, 3000, 'c. 2560 BC', -3],
      [4300, 7000, '1969 AD', 3],
    ])
  })

  it('recolours the stamps with the highlight being chosen, before the video renders again', async () => {
    const plan = await build({ captionStyle: { accent: '#FF3EA5', preset: 'explainer' } })
    expect((stampsOf(plan) ?? []).map(stripOf)).toEqual(['#ff3ea5', '#ff3ea5'])
  })

  it('keeps the stamps when the captions are off', async () => {
    const plan = await build({ captionEnabled: false })
    expect(textTracks(plan).map((t) => t.id)).toEqual(['#FactStampTrack'])
    expect((stampsOf(plan) ?? []).map(stripOf)).toEqual(['#04f827', '#04f827'])
  })

  it("loads their face, PT Serif Bold, from the render font pack: the editor's own has none", async () => {
    const [seg] = stampsOf(await build()) ?? []
    expect(seg.style.fontGzipPath).toBe(
      `${process.env.NEXT_PUBLIC_PRESET_PACK_URL}/render/fonts.tar.gz`,
    )
    expect(seg.style.fontFamily).toBe('PT Serif')
  })

  it('draws none for a video script without stamps: any other video, or a loop not rendered since', async () => {
    const plain = await build({ captionKind: 'video', videoScript: { tracks: [] } as VideoScript })
    expect(stampsOf(plain)).toBeUndefined()
    const older = await build({ videoScript: { tracks: [loopScript.tracks[0]] } as VideoScript })
    expect(stampsOf(older)).toBeUndefined()
    expect(stampsOf(await build({ videoScript: undefined }))).toBeUndefined()
  })

  it('adds no track for a loop rendered without stamps (its empty facts track)', async () => {
    const empty = { ...facts, segments: [] }
    const plan = await build({
      videoScript: { tracks: [loopScript.tracks[0], empty] } as VideoScript,
    })
    expect(stampsOf(plan)).toBeUndefined()
    expect(textTracks(plan).map((t) => t.id)).toEqual(['#CaptionTrack'])
  })

  it('holds the stamps back until the look they are coloured in is read', async () => {
    // Before the saved look is read the builder sees the default highlight: no green flash.
    const waiting = await build({ captionEnabled: false, factsReady: false })
    expect(stampsOf(waiting)).toBeUndefined()
    const read = await build({ captionEnabled: false, factsReady: true })
    expect(stampsOf(read)).toHaveLength(2)
  })

  describe('square strips', () => {
    const stripsOf = (plan: RenderPlan) =>
      plan.tracks.find((t) => t.id === '#FactStripTrack')?.segs as undefined | VideoSeg[]
    const urlFor = (image: FactStampStripImage) =>
      `blob:http://localhost:3000/${image.width}x${image.height}${image.color}`

    it('draws each strip as an image layer under its label, which goes without its rounded box', async () => {
      const made: FactStampStripImage[] = []
      const plan = await build({
        factStripUrl: async (image) => {
          made.push(image)
          return urlFor(image)
        },
      })
      const ids = plan.tracks.map((t) => t.id)
      // Over the captions, under the labels.
      expect(ids.slice(-3)).toEqual(['#CaptionTrack', '#FactStripTrack', '#FactStampTrack'])
      const renderPref = resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' })
      const labels = TextAdapter.genFactStampTrack({
        fontGzipPath: `${process.env.NEXT_PUBLIC_PRESET_PACK_URL}/render/fonts.tar.gz`,
        frame: getDeliveryCanvasSize('9:16'),
        renderPref,
        track: facts,
      }).segs
      expect(made).toEqual(labels.map(factStampStripImage))
      expect(stripsOf(plan)).toEqual(
        labels.map((seg) =>
          factStampStripSeg(seg, urlFor(factStampStripImage(seg)), getDeliveryCanvasSize('9:16')),
        ),
      )
      expect(stampsOf(plan)).toEqual(labels.map(factStampLabelOnStrip))
      expect((stampsOf(plan) ?? []).map(stripOf)).toEqual([undefined, undefined])
    })

    it("keeps the engine's own box on a stamp whose strip image could not be made", async () => {
      const plan = await build({
        factStripUrl: async (image) => (image.width > 275 ? urlFor(image) : undefined),
      })
      // 'c. 2560 BC' is the wider label (298 px strip, 252 for '1969 AD'): only it gets a layer.
      expect((stripsOf(plan) ?? []).map((s) => s.id)).toEqual(['segment-fact-0-strip'])
      expect((stampsOf(plan) ?? []).map(stripOf)).toEqual([undefined, '#04f827'])
    })

    it('adds no strip layer without a way to make the images: the labels keep their box', async () => {
      const plan = await build()
      expect(stripsOf(plan)).toBeUndefined()
      expect((stampsOf(plan) ?? []).map(stripOf)).toEqual(['#04f827', '#04f827'])
    })

    it('keeps the labels on their box when making the images fails', async () => {
      const plan = await build({
        factStripUrl: async () => {
          throw new Error('no canvas')
        },
      })
      expect(stripsOf(plan)).toBeUndefined()
      expect((stampsOf(plan) ?? []).map(stripOf)).toEqual(['#04f827', '#04f827'])
    })
  })
})

describe('StoryRenderPlanBuilder loop media', () => {
  const CLIPS = 'http://localhost:5017/api/files/p1/long_take/beat_loop_clips.mp4?v=7'
  const VOICE = 'http://localhost:5017/api/files/p1/story_loader/audio/voice_over.mp3'
  // The loop's clips one by one, as the editor state holds them: 4 s each on the beat grid.
  const clips: StorySegment[] = [0, 1].map((k) => ({
    endMs: (k + 1) * 4000,
    kind: 'transition',
    startMs: k * 4000,
    transitionId: `clip-${k}`,
    videoHeight: 1280,
    videoUri: `http://localhost:5017/api/files/p1/clip-${k}.mp4`,
    videoWidth: 720,
  })) as StorySegment[]
  const build = (over: Partial<Parameters<typeof StoryRenderPlanBuilder.build>[0]> = {}) =>
    StoryRenderPlanBuilder.build({
      aspectRatio: '9 / 16',
      captionEnabled: true,
      captionKind: 'loop',
      captionStyle: null,
      loopClipsUrl: CLIPS,
      segments: clips,
      totalMs: 8000,
      transcript,
      voiceOverUrl: VOICE,
      ...over,
    })
  const mediaTracks = (plan: RenderPlan) =>
    plan.tracks.filter((t) => t.type === TrackType.Video || t.type === TrackType.Audio)

  it('plays the joined clips the loop was delivered from, muted, over the whole loop, under the voice-over', async () => {
    const plan = await build()
    const [video, voice] = mediaTracks(plan)
    expect(video.segs).toEqual([
      expect.objectContaining({
        in: 0,
        out: 8000,
        trimEnd: 8000,
        trimStart: 0,
        uri: CLIPS,
        // Their sound plays beside the engine: the clip sound bed, at its own level.
        volume: 0,
      }),
    ])
    expect(voice.segs).toEqual([expect.objectContaining({ uri: VOICE, volume: 100 })])
  })

  it('plays the clips one by one without the joined file, as before', async () => {
    const plan = await build({ loopClipsUrl: null })
    expect(mediaTracks(plan)[0].segs.map((s) => (s as VideoSeg).uri)).toEqual(
      clips.map((c) => (c as StoryTransitionSegment).videoUri),
    )
  })

  it('keeps the media as it is when the captions or their look change: only the text is drawn again', async () => {
    const before = await build()
    const after = [
      await build({ captionEnabled: false }),
      await build({ captionStyle: { accent: '#FF3EA5', preset: 'explainer', size: 120 } }),
    ]
    for (const plan of after) {
      expect(mediaTracks(plan)).toEqual(mediaTracks(before))
    }
  })
})

describe('StoryRenderPlanBuilder captions nobody styled', () => {
  // Every word of a plain video's transcript, two sentences.
  const sentences: TranscriptData = {
    language: 'en',
    segments: [
      {
        end: 3,
        start: 0,
        text: 'honey never spoils at all',
        words: [
          { end: 0.4, start: 0, word: 'honey' },
          { end: 0.9, start: 0.5, word: 'never' },
          { end: 1.5, start: 1, word: 'spoils' },
          { end: 1.9, start: 1.6, word: 'at' },
          { end: 2.6, start: 2, word: 'all' },
        ],
      },
      {
        end: 6,
        start: 3.2,
        text: 'archaeologists found pots of it',
        words: [
          { end: 4, start: 3.2, word: 'archaeologists' },
          { end: 4.4, start: 4.1, word: 'found' },
          { end: 4.8, start: 4.5, word: 'pots' },
          { end: 5, start: 4.9, word: 'of' },
          { end: 5.6, start: 5.1, word: 'it' },
        ],
      },
    ],
  }
  const stored = transcriptToEditingScriptTextTrack(sentences)
  // What the last render froze into the video script before saved looks.
  const frozen = {
    captionRenderPref: getDefaultCaptionRenderPref(),
    tracks: [stored],
  } as VideoScript

  async function captionTrack(aspectRatio: string, videoScript?: VideoScript) {
    const plan = await StoryRenderPlanBuilder.build({
      aspectRatio,
      captionEnabled: true,
      captionKind: 'video',
      captionStyle: null,
      segments: [],
      totalMs: 6000,
      transcript: sentences,
      videoScript,
    })
    return withoutIds(plan.tracks.find((t) => t.segs[0]?.type === 't'))
  }
  const expected = async (renderPref: ReturnType<typeof getDefaultCaptionRenderPref>) =>
    withoutIds(await TextAdapter.genTextTrackFromTranscriptTrack({ renderPref, track: stored }))

  it.each([
    ['the video script', frozen],
    ['the transcript', undefined],
  ])('draws a 9:16 video exactly as before, from %s', async (_from, videoScript) => {
    expect(await captionTrack('9 / 16', videoScript)).toEqual(
      await expected(getDefaultCaptionRenderPref()),
    )
  })

  it.each([
    ['the video script', frozen],
    ['the transcript', undefined],
  ])(
    'draws a 16:9 video where its next render puts it, from %s (Download renders it again)',
    async (_from, videoScript) => {
      const next = resolveCaptionRenderPref(null, { aspectRatio: '16:9', kind: 'video' })
      const track = await captionTrack('16 / 9', videoScript)
      expect(track).toEqual(await expected(next))
      // Lower than the tall-frame slot the file was rendered at.
      expect(track).not.toEqual(await expected(getDefaultCaptionRenderPref()))
    },
  )
})

describe('StoryRenderPlanBuilder frame', () => {
  it.each([
    ['9 / 16', '9:16'],
    ['16 / 9', '16:9'],
    ['1 / 1', '1:1'],
  ] as const)(
    'previews %s at the size of the file Download delivers, so captions wrap as in it',
    async (ratio, delivered) => {
      const plan = await StoryRenderPlanBuilder.build({
        aspectRatio: ratio,
        captionEnabled: true,
        captionStyle: { preset: 'explainer' },
        segments: [],
        totalMs: 4000,
        transcript,
      })
      const frame = { height: plan.videoInfo.height, width: plan.videoInfo.width }
      const file = getDeliveryCanvasSize(delivered)
      expect(frame).toEqual(file)
      expect(StoryRenderPlanBuilder.parseAspectRatio(ratio)).toEqual(file)
      // The engine rounds the font size and the line width to its canvas: at the file's size
      // they round as the export's do.
      const [seg] = plan.tracks.find((t) => t.segs[0]?.type === 't')?.segs as CaptionSeg[]
      expect(captionFontPt(seg.style.fontSize ?? 0, frame)).toBe(
        captionFontPt(seg.style.fontSize ?? 0, file),
      )
      expect(captionScalePx(540, frame)).toBe(captionScalePx(540, file))
    },
  )
})
