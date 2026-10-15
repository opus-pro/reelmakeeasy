/**
 * Captions end to end, with no font pack, no FFmpeg and no paid call: a saved caption look,
 * resolved as the render activity resolves it (`resolveCaptionLook`), through the adapter both
 * renderers read, to the caption segments the export keeps, then the export painter: its frames
 * (caption-layout, the editor engine's rules) and its images (buildCaptionOverlay).
 *
 * - A video's export: the video script prepareRenderScripts saves (storyboard/video_script.json),
 *   read back as JSON and turned into a render plan by VideoScriptAdapter as the render service
 *   does (video-render.activities.ts), whose caption segments render-plan-ffmpeg keeps in track
 *   order (collectClips).
 * - A loop's finish: beatLoopCaptionSegments, what finishBeatLoopDelivery hands the painter.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import { createCanvas, loadImage } from 'canvas'

import { beatLoopCaptionSegments } from '../../long-take/beat-loop-delivery'
import { prepareRenderScripts } from '../../long-take/render-final'
import type { RenderedVideoScript, RenderFinalStorage } from '../../long-take/render-final.types'
import { type RenderPlan, SegType } from '../../types/render-plan-struct'
import { VideoScriptAdapter } from '../video-script-adapter'

import {
  type CaptionFrame,
  captionFrameAt,
  type CaptionSegmentLayout,
  layoutCaptionSegment,
} from './caption-layout'
import { type CaptionKind, type CaptionLook, resolveCaptionLook } from './caption-look'
import { buildCaptionOverlay, type CaptionSegment, createCaptionPainter } from './caption-painter'
import { transcriptToEditingScriptTextTrack } from './caption-to-editing-script-text-track'

const FRAME = { height: 1920, width: 1080 }
const FPS = 25
const PAPER = '#f6f2e7'
const INK = '#111111'
const URI = {
  classic: 'caption-preset://word-level_karaoke_fill-pop',
  explainerBox: 'caption-preset://word-level_simple_bg-highlight',
  explainerStrip: 'caption-preset://deep-diver',
  punch: 'caption-preset://word-level_highlight_color',
}

/** Words timed back to back from `start`, each 0.3 s long. */
const words = (text: string, start: number) =>
  text.split(' ').map((word, i) => ({
    end: Number((start + (i + 1) * 0.3).toFixed(3)),
    start: Number((start + i * 0.3).toFixed(3)),
    word,
  }))

/** A normal video's transcript: two sentences, no accent marks, no caption windows. */
const VIDEO: TranscriptData = {
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

/** A loop's transcript: one segment per chunk, held for its window, its accent word marked. */
const LOOP: TranscriptData = {
  captionWindows: 'segment',
  language: 'en',
  segments: [
    ['The Great Pyramid', 0.15, 4, 2],
    ['Twenty years', 4.15, 8, 0],
  ].map(([text, start, end, accent]) => ({
    end: end as number,
    start: start as number,
    text: text as string,
    words: words(text as string, start as number).map((w, i) =>
      i === accent ? { ...w, accent: true } : w,
    ),
  })),
}

/** What the export of a normal video draws: its look, and the caption segments it keeps. */
async function videoExport(
  settings: CaptionStyleSettings | null,
  aspectRatio = '9:16',
): Promise<{ look: CaptionLook; segments: CaptionSegment[] }> {
  const look = resolveCaptionLook(settings, { aspectRatio, kind: 'video' })
  const written = new Map<string, unknown>()
  const storage: RenderFinalStorage = {
    ensureDir: async (dir) => dir,
    getFullPath: (relativePath) => `store://projects/p1/${relativePath}`,
    readJsonFile: async () => {
      throw new Error('not read here')
    },
    uploadFile: async () => undefined,
    writeJsonFile: async (pathName, data) => {
      written.set(pathName, data)
    },
  }
  await prepareRenderScripts({
    audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
    captionRenderPref: look.captionRenderPref,
    captionStyle: look.captionStyle,
    captionTrack: transcriptToEditingScriptTextTrack(VIDEO),
    logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    storage,
    transitionVideos: [
      {
        endMs: 4000,
        fromShotId: 'f0',
        prompt: '',
        startMs: 0,
        toShotId: 'f1',
        transitionId: 't1',
        videoUri: 'store://projects/p1/long_take/transitions/t1.mp4',
      },
    ],
  })
  // As the render service reads it: plain JSON, the pref kept whole.
  const videoScript = JSON.parse(
    JSON.stringify(written.get('storyboard/video_script.json')),
  ) as RenderedVideoScript
  expect(videoScript.captionStyle).toEqual(look.captionStyle)
  const plan = await VideoScriptAdapter.genRenderPlan({
    captionRenderPref: videoScript.captionRenderPref,
    // As video-render.activities.ts: the local renderer draws no caption cover.
    forcedHideCaptionBg: true,
    getAllTemplatesSpec: async () => [],
    getFallbackFontPath: async () => 'font.ttf',
    getFilePath: async (url: string) => `media/${url.split('/').at(-1)}`,
    getMediaMetadata: async () => FRAME,
    getTemplateAssetPath: async () => '',
    getVideoFps: () => String(FPS),
    outputSize: FRAME,
    rootDir: '/tmp/root',
    videoScript,
  })
  return { look, segments: exportedCaptions(plan) }
}

/** What a loop's finish draws: its look, and the caption segments it hands the painter. */
async function loopFinish(
  settings: CaptionStyleSettings | null,
): Promise<{ look: CaptionLook; segments: CaptionSegment[] }> {
  const look = resolveCaptionLook(settings, { aspectRatio: '9:16', kind: 'loop' })
  const segments = await beatLoopCaptionSegments(
    transcriptToEditingScriptTextTrack(LOOP),
    look.captionRenderPref,
  )
  return { look, segments }
}

/** render-plan-ffmpeg's collectClips: the text segments of preset captions, in track order. */
function exportedCaptions(plan: RenderPlan | undefined): CaptionSegment[] {
  return (plan?.tracks ?? []).flatMap((track) =>
    (track.segs as Array<{ type: SegType; uri?: string }>).filter(
      (seg) => seg.type === SegType.Text && Boolean(seg.uri?.startsWith('caption-preset://')),
    ),
  ) as unknown as CaptionSegment[]
}

let workDir: string
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-e2e-'))
})
afterEach(() => fs.rmSync(workDir, { force: true, recursive: true }))

const painter = () => createCaptionPainter(path.join(workDir, 'no-fonts'))

/** The painter's frame of `segment` at `timeMs` on the timeline. */
function frameOf(segment: CaptionSegment, timeMs: number) {
  const { measure } = painter()
  const layout = layoutCaptionSegment(segment, FRAME, measure)
  const frame = captionFrameAt(layout, timeMs, measure)
  if (!frame) throw new Error(`no caption at ${timeMs} ms`)
  return { frame, layout }
}

/** The words lit at `timeMs` (drawn in a colour other than the caption's own). */
const litWords = (frame: CaptionFrame, layout: CaptionSegmentLayout) =>
  frame.words.filter((w) => w.color !== layout.paint.fontColor).map((w) => [w.text, w.color])

/** Pixel counts of the overlay image shown at `timeMs`, per colour (within 6 levels a channel). */
async function overlayColours(segments: CaptionSegment[], timeMs: number, colours: string[]) {
  const overlay = await buildCaptionOverlay({
    fontsDir: path.join(workDir, 'no-fonts'),
    fps: FPS,
    frame: FRAME,
    segments,
    totalSec: Math.max(...segments.map((s) => s.out)) / 1000,
    workDir: path.join(workDir, 'overlay'),
  })
  const list = fs.readFileSync(overlay?.inputArgs.at(-1) ?? '', 'utf8').split('\n')
  // The image on screen at `timeMs`: entries are `file`, `option framerate`, `duration`.
  let end = 0
  let file = ''
  for (let i = 1; i < list.length; i++) {
    if (!list[i].startsWith('file ')) continue
    file = list[i].replace(/^file '|'$/g, '')
    end += Number(list[i + 2]?.replace('duration ', '') ?? 0) * 1000
    if (timeMs < end) break
  }
  const image = await loadImage(file)
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  const { data } = canvas.getContext('2d').getImageData(0, 0, image.width, image.height)
  const rgb = colours.map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)))
  const counts = colours.map(() => 0)
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 250) continue
    rgb.forEach(([r, g, b], c) => {
      if (Math.abs(data[p] - r) + Math.abs(data[p + 1] - g) + Math.abs(data[p + 2] - b) <= 18) {
        counts[c]++
      }
    })
  }
  return Object.fromEntries(colours.map((hex, c) => [hex, counts[c]]))
}

describe('the default look by kind', () => {
  it('renders a loop nobody styled in Punch', async () => {
    const { look, segments } = await loopFinish(null)
    expect(look.captionStyle).toEqual({
      accent: '#04F827',
      position: null,
      preset: 'punch',
      size: 100,
    })
    expect(segments.map((s) => s.uri)).toEqual([URI.punch, URI.punch])
    const { frame, layout } = frameOf(segments[0], 2000)
    expect(layout.preset).toBe('highlight-color')
    // The accent word is lit for the whole chunk, in the default green; nothing pops.
    expect(litWords(frame, layout)).toEqual([['PYRAMID', '#04f827']])
    expect(frame.scaleX).toBe(1)
    expect(new Set(frame.words.map((w) => w.px)).size).toBe(1)
  })

  it('renders a normal video nobody styled in Classic', async () => {
    const { look, segments } = await videoExport(null)
    expect(look.captionStyle).toEqual({
      accent: '#04F827',
      position: null,
      preset: 'classic',
      size: 100,
    })
    expect(new Set(segments.map((s) => s.uri))).toEqual(new Set([URI.classic]))
    // Classic follows the voice: 40 ms into "never", it is lit, enlarged, and the line stretches.
    const { frame, layout } = frameOf(segments[0], 490)
    expect(layout.preset).toBe('fill-pop')
    expect(litWords(frame, layout)).toEqual([['NEVER', '#04f827']])
    expect(frame.scaleX).toBeGreaterThan(1)
    expect(frame.boxes).toEqual([])
    const lit = frame.words.find((w) => w.text === 'NEVER')
    const other = frame.words.find((w) => w.text === 'HONEY')
    expect(lit?.px).toBeGreaterThan(other?.px ?? Infinity)
  })
})

describe('a saved look, saved to drawn', () => {
  it('Classic: the chosen highlight follows the voice word by word', async () => {
    const { segments } = await videoExport({ accent: '#FF3EA5', preset: 'classic' })
    const at = (timeMs: number) => {
      const { frame, layout } = frameOf(segments[0], timeMs)
      return litWords(frame, layout)
    }
    expect(at(200)).toEqual([['HONEY', '#ff3ea5']])
    expect(at(900)).toEqual([['SPOILS,', '#ff3ea5']])
    const colours = await overlayColours(segments, 200, ['#ff3ea5', '#ffffff'])
    expect(colours['#ff3ea5']).toBeGreaterThan(100)
    expect(colours['#ffffff']).toBeGreaterThan(100)
  })

  it('Punch: short captions, one word lit for the whole caption, nothing moves', async () => {
    const { segments } = await videoExport({ accent: '#FF3EA5', preset: 'punch' })
    expect(new Set(segments.map((s) => s.uri))).toEqual(new Set([URI.punch]))
    // The sentence is split into captions of 1-3 words.
    expect(segments.length).toBeGreaterThan(2)
    for (const segment of segments) {
      expect(segment.texts.length).toBeLessThanOrEqual(3)
      const samples = [segment.in, (segment.in + segment.out) / 2, segment.out - 1].map((t) =>
        frameOf(segment, t),
      )
      const lit = samples.map(({ frame, layout }) => litWords(frame, layout))
      // The same one word, in the chosen colour, at the start, the middle and the end.
      expect(lit[0]).toHaveLength(1)
      expect(lit[0][0][1]).toBe('#ff3ea5')
      expect(lit).toEqual([lit[0], lit[0], lit[0]])
      for (const { frame, layout } of samples) {
        expect(layout.preset).toBe('highlight-color')
        expect(frame.scaleX).toBe(1)
        expect(frame.rotate).toBe(0)
        expect(frame.boxes).toEqual([])
        expect(frame.words.every((w) => w.text === w.text.toUpperCase())).toBe(true)
      }
    }
    const first = segments[0]
    const colours = await overlayColours(segments, (first.in + first.out) / 2, [
      '#ff3ea5',
      '#ffffff',
    ])
    expect(colours['#ff3ea5']).toBeGreaterThan(100)
    expect(colours['#ffffff']).toBeGreaterThan(100)
  })

  it.each([
    ['a video', () => videoExport({ accent: '#FFE500', preset: 'explainer' })],
    ['a loop', () => loopFinish({ accent: '#FFE500', preset: 'explainer' })],
  ])('Explainer on %s: a tilted paper strip, the accent word boxed on it', async (_kind, draw) => {
    const { look, segments } = await draw()
    const strips = segments.filter((s) => s.uri === URI.explainerStrip)
    const captions = segments.filter((s) => s.uri === URI.explainerBox)
    expect(strips.length).toBe(captions.length)
    expect(strips.length + captions.length).toBe(segments.length)
    // Bottom layer first: every strip before the caption drawn on it.
    expect(segments.indexOf(strips[0])).toBeLessThan(segments.indexOf(captions[0]))

    for (const [k, caption] of captions.entries()) {
      const strip = strips[k]
      const midMs = (caption.in + caption.out) / 2
      const paper = frameOf(strip, midMs)
      const boxed = frameOf(caption, midMs)
      expect(paper.layout.preset).toBe('deep-diver')
      expect(boxed.layout.preset).toBe('simple-bg')
      // Alternate captions lean the other way, strip and words together.
      const tilt = k % 2 === 0 ? 1.2 : -1.2
      expect([paper.frame.rotate, boxed.frame.rotate]).toEqual([tilt, tilt])
      // (a) One paper box behind the lines, the words in ink.
      const lower = (colours: string[]) => colours.map((c) => c.toLowerCase())
      expect(lower(paper.frame.boxes.map((b) => b.color))).toEqual([PAPER])
      expect(new Set(lower(paper.frame.words.map((w) => w.color)))).toEqual(new Set([INK]))
      // (b) One highlight box behind the accent word, lit for the whole caption.
      expect(lower(boxed.frame.boxes.map((b) => b.color))).toEqual(['#ffe500'])
      const lit = boxed.frame.words.filter((w) => w.active)
      expect(lit).toHaveLength(1)
      const [box] = boxed.frame.boxes
      const word = boxed.layout.words[boxed.frame.words.indexOf(lit[0])]
      expect(box.x).toBeLessThanOrEqual(lit[0].x)
      expect(box.x + box.w).toBeGreaterThanOrEqual(lit[0].x + word.width)
      const lastMs = caption.out - 1
      expect(frameOf(caption, lastMs).frame.words.filter((w) => w.active)).toEqual(
        frameOf(caption, caption.in).frame.words.filter((w) => w.active),
      )
      // Sentence case, as written.
      expect(paper.frame.words.map((w) => w.text)).toEqual(caption.texts.map((t) => t.t))
    }
    expect(look.captionRenderPref.strip?.color.toLowerCase()).toBe(PAPER)

    // Drawn: the paper shows, and the highlight box on it (a strip drawn over the caption
    // would hide it).
    const first = captions[0]
    const colours = await overlayColours(segments, (first.in + first.out) / 2, [PAPER, '#ffe500'])
    expect(colours[PAPER]).toBeGreaterThan(2000)
    expect(colours['#ffe500']).toBeGreaterThan(100)
  })
})

describe('a chosen height', () => {
  it.each([
    ['classic', 'video'],
    ['punch', 'video'],
    ['explainer', 'video'],
    ['punch', 'loop'],
  ] as const)('puts the centre of a %s caption (%s) at the height chosen', async (preset, kind) => {
    const draw = kind === 'loop' ? loopFinish : videoExport
    const { segments } = await draw({ position: 30, preset })
    for (const segment of segments) {
      // The engine's centre-based position, and the painter's texture centre (both ignore vAlign).
      expect(segment.position?.[1]).toBeCloseTo(0.4, 6)
      const { layout } = frameOf(segment, segment.in)
      expect(layout.texture.centerY).toBeCloseTo(0.3 * FRAME.height, 6)
    }
  })
})

describe('the frame a look is laid out for', () => {
  it.each([
    ['a loop', 'loop'],
    ['a video', 'video'],
  ] as const)('lays %s out for its own frame', (_name, kind: CaptionKind) => {
    const pref = (aspectRatio: string) =>
      resolveCaptionLook({ preset: 'classic' }, { aspectRatio, kind }).captionRenderPref
    expect(pref('16:9').layoutAspectRatio).toBe(kind === 'loop' ? 'portrait' : 'landscape')
  })
})
