import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'

import { resolveCaptionRenderPref } from '../adapters/caption/caption-style'
import { transcriptToEditingScriptTextTrack } from '../adapters/caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'

import type { applyBeatLoopFinish as ApplyBeatLoopFinish } from './beat-loop-finish'
import type { writeBeatLoopSfxBed as WriteBeatLoopSfxBed } from './beat-loop-sfx-bed'

const applyBeatLoopFinish = jest.fn<
  ReturnType<typeof ApplyBeatLoopFinish>,
  Parameters<typeof ApplyBeatLoopFinish>
>()
jest.mock('./beat-loop-finish', () => ({
  applyBeatLoopFinish: (...args: Parameters<typeof ApplyBeatLoopFinish>) =>
    applyBeatLoopFinish(...args),
}))

// The project's files, by store:// uri: real files in a scratch data dir, which the
// delivery reads in place.
process.env['DATA_DIR'] = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-delivery-'))
class StoredObjects extends Map<string, string> {
  override clear(): void {
    for (const uri of this.keys()) fs.rmSync(filePath(uri), { force: true })
    super.clear()
  }

  override delete(uri: string): boolean {
    fs.rmSync(filePath(uri), { force: true })
    return super.delete(uri)
  }

  override set(uri: string, body: string): this {
    fs.mkdirSync(path.dirname(filePath(uri)), { recursive: true })
    fs.writeFileSync(filePath(uri), body)
    return super.set(uri, body)
  }
}
const objects = new StoredObjects()

const writeBeatLoopSfxBed = jest.fn<
  ReturnType<typeof WriteBeatLoopSfxBed>,
  Parameters<typeof WriteBeatLoopSfxBed>
>(async () => ({
  durationS: 8,
  gainDb: 2,
  sfxGainDb: -12.1,
  version: 1,
  voiceGainDb: -5,
  volume: 35.1,
}))
jest.mock('./beat-loop-sfx-bed', () => ({
  writeBeatLoopSfxBed: (...args: Parameters<typeof WriteBeatLoopSfxBed>) =>
    writeBeatLoopSfxBed(...args),
}))

import { captionStampColor } from '../adapters/caption/caption-look'
import { filePath } from '../storage/file-store'
import { TextAdapter } from '../adapters/text-adapter'

import {
  BEAT_LOOP_CONCAT_PATH,
  BEAT_LOOP_STORYBOARD_PATH,
  beatLoopCaptionSegments,
  beatLoopFactsTrack,
  beatLoopStampCues,
  beatLoopStampSegments,
  finishBeatLoopDelivery,
  parseBeatLoopRenderSpec,
  readBeatLoopRenderSpec,
} from './beat-loop-delivery'
import { resolveBgmDuckDbForVolume } from './bgm-volume'
import type { RenderFinalStorage } from './render-final.types'

const ROOT = 'store://projects/p1'
const VOICE_PATH = 'story_loader/audio/voice_over.mp3'
const TRANSCRIPT_PATH = 'story_loader/transcript/transformed_transcript.json'

const readJsonFile = jest.fn(async (relativePath: string): Promise<unknown> => {
  const body = objects.get(`${ROOT}/${relativePath}`)
  if (body === undefined) throw new Error(`No such object: ${relativePath}`)
  return JSON.parse(body)
})
const storage: RenderFinalStorage = {
  ensureDir: async (dir) => dir,
  getFullPath: (relativePath) => `${ROOT}/${relativePath}`,
  readJsonFile: readJsonFile as RenderFinalStorage['readJsonFile'],
  uploadFile: async () => undefined,
  writeJsonFile: async () => undefined,
}

const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const clip = (over: Record<string, unknown> = {}) => ({
  caption: null,
  cut: 'The camera dives into the next block.',
  cut_camera: 'Push in',
  freeze: 'Dust hangs in the air.',
  hit: 'A stone block slams down.',
  hit_camera: 'Shake',
  id: 'c1',
  narration: 'The Great Pyramid rose one block at a time.',
  stamp: null,
  ...over,
})

const storyboard = {
  accent: '#FF3B30',
  caption_style: 'explainer',
  clips: [clip({ stamp: 'c. 2560 BC' }), clip({ id: 'c2' })],
  duration_s: 8,
  keyframes: [{ id: 'f0', prompt: 'A pyramid' }],
  sources: 'Encyclopaedia',
  title: 'Pyramid',
}

/** Words timed back to back from `start`, each `seconds` long. */
function segment(text: string, start: number, seconds = 0.3) {
  const timed = words(text, start, seconds)
  return { end: timed.at(-1)?.end ?? start, start, text, words: timed }
}

function words(text: string, start: number, seconds = 0.3) {
  return text.split(' ').map((word, i) => ({
    end: Number((start + (i + 1) * seconds).toFixed(3)),
    start: Number((start + i * seconds).toFixed(3)),
    word,
  }))
}

describe('parseBeatLoopRenderSpec', () => {
  it('reads the clips and their stamps; the caption style and accent of older storyboards are not read', () => {
    expect(parseBeatLoopRenderSpec(storyboard)).toEqual({
      clipCount: 2,
      stamps: ['c. 2560 BC', null],
    })
  })

  it('also reads a storyboard kept under `storyboard`', () => {
    expect(parseBeatLoopRenderSpec({ format: 'beat_loop', storyboard })).toMatchObject({
      clipCount: 2,
      stamps: ['c. 2560 BC', null],
    })
  })

  it('reads a stamp that is not text as none', () => {
    const { accent: _accent, caption_style: _style, ...rest } = storyboard
    expect(
      parseBeatLoopRenderSpec({ ...rest, clips: [clip({ stamp: 42 })], duration_s: 4 }),
    ).toEqual({ clipCount: 1, stamps: [null] })
  })

  it('fails loudly on a storyboard it cannot render', () => {
    expect(() => parseBeatLoopRenderSpec({ title: 'x' })).toThrow(/beat_loop\.json has no clips/)
    expect(() => parseBeatLoopRenderSpec(null)).toThrow(/has no clips/)
    expect(() => parseBeatLoopRenderSpec({ ...storyboard, duration_s: 12 })).toThrow(
      /lasts 12 s but has 2 clips/,
    )
  })
})

/** A loop transcript: one segment per chunk, held for its window, its accent word marked. */
function loopTranscript(): TranscriptData {
  const chunk = (text: string, start: number, end: number, accent: number) => ({
    ...segment(text, start),
    end,
    words: words(text, start).map((w, i) => (i === accent ? { ...w, accent: true } : w)),
  })
  return {
    captionWindows: 'segment',
    language: 'en',
    segments: [chunk('The Great Pyramid', 0.15, 4, 2), chunk('Twenty years', 4.15, 8, 0)],
  }
}

describe('beatLoopCaptionSegments', () => {
  it("draws the loop's chunks as the export draws any video's captions: the app's caption style, held for each chunk's window", async () => {
    const pref = getDefaultCaptionRenderPref()
    const segments = await beatLoopCaptionSegments(
      transcriptToEditingScriptTextTrack(loopTranscript()),
      pref,
    )
    expect(segments.map((s) => [s.in, s.out])).toEqual([
      [150, 4000],
      [4150, 8000],
    ])
    expect(segments[0]).toMatchObject({
      lineCount: pref.lineCount,
      style: { fontFamily: 'Montserrat', fontSize: 35, fontWeight: 900 },
      uri: 'caption-preset://word-level_karaoke_fill-pop',
    })
    // Classic: upper case, the accent word in the highlight colour.
    expect(segments[0].texts.map((t) => [t.t, t.highlightColor])).toEqual([
      ['THE', undefined],
      ['GREAT', undefined],
      ['PYRAMID', pref.highlightColor.primary],
    ])
  })

  it("gives Explainer's paper strip under its words: every strip before the caption it backs", async () => {
    const pref = resolveCaptionRenderPref(
      { accent: '#FFE500', preset: 'explainer' },
      { aspectRatio: '9:16', kind: 'loop' },
    )
    const segments = await beatLoopCaptionSegments(
      transcriptToEditingScriptTextTrack(loopTranscript()),
      pref,
    )
    // Bottom layer first: the painter draws segments that start together in the order given.
    expect(segments.map((s) => [s.uri, s.in, s.out, s.rotate])).toEqual([
      ['caption-preset://deep-diver', 150, 4000, 1.2],
      ['caption-preset://deep-diver', 4150, 8000, -1.2],
      ['caption-preset://word-level_simple_bg-highlight', 150, 4000, 1.2],
      ['caption-preset://word-level_simple_bg-highlight', 4150, 8000, -1.2],
    ])
    expect(segments[0].style).toMatchObject({ animationBgColor: pref.strip?.color })
    expect(segments[2].style).toMatchObject({ animationBgColor: '#ffe500' })
  })

  it('draws nothing when the caption style turns the captions off', async () => {
    const pref = { ...getDefaultCaptionRenderPref(), enableCaption: false }
    const track = transcriptToEditingScriptTextTrack(loopTranscript())
    expect(await beatLoopCaptionSegments(track, pref)).toEqual([])
  })
})

describe('beatLoopStampCues', () => {
  it('shows each clip stamp from 0.3 s to 3.0 s of its own clip and skips empty ones', () => {
    expect(beatLoopStampCues([null, ' c. 2560 BC ', '', '1969 AD'])).toEqual([
      { endS: 7, startS: 4.3, text: 'c. 2560 BC' },
      { endS: 15, startS: 12.3, text: '1969 AD' },
    ])
  })

  it('follows a custom clip length', () => {
    expect(beatLoopStampCues(['A', 'B'], 5)).toEqual([
      { endS: 3, startS: 0.3, text: 'A' },
      { endS: 8, startS: 5.3, text: 'B' },
    ])
  })
})

describe('beatLoopFactsTrack', () => {
  it("holds one stamp per clip that has one, for 0.3-3.0 s of its clip's bar", () => {
    expect(beatLoopFactsTrack([null, ' c. 2560 BC ', '', '1969 AD'])).toEqual({
      id: 'track-facts',
      segments: [
        {
          content: { id: 'content-fact-0', text: 'c. 2560 BC' },
          id: 'segment-fact-0',
          timeline: { in: 4300, out: 7000 },
        },
        {
          content: { id: 'content-fact-1', text: '1969 AD' },
          id: 'segment-fact-1',
          timeline: { in: 12_300, out: 15_000 },
        },
      ],
      type: 'facts',
    })
  })

  it('is an empty track for a loop without stamps, so its video script still says it has none', () => {
    expect(beatLoopFactsTrack([null, ' '])).toEqual({
      id: 'track-facts',
      segments: [],
      type: 'facts',
    })
  })
})

describe('beatLoopStampSegments', () => {
  it("draws the stamps as the editor preview does: the facts track in the look's highlight", () => {
    const pref = resolveCaptionRenderPref(
      { accent: '#FF3EA5', preset: 'explainer' },
      { aspectRatio: '9:16', kind: 'loop' },
    )
    const segments = beatLoopStampSegments(['c. 2560 BC', null, '1969 AD'], pref)
    const track = beatLoopFactsTrack(['c. 2560 BC', null, '1969 AD'])
    expect(segments).toEqual(TextAdapter.genFactStampTrack({ renderPref: pref, track }).segs)
    expect(segments.map((s) => [s.in, s.out, s.texts[0].t, s.rotate])).toEqual([
      [300, 3000, 'c. 2560 BC', -3],
      [8300, 11_000, '1969 AD', 3],
    ])
    expect(segments[0].style).toMatchObject({ animationBgColor: captionStampColor(pref) })
  })

  it('draws none for a loop without stamps', () => {
    expect(beatLoopStampSegments([null], getDefaultCaptionRenderPref())).toEqual([])
  })
})

describe('readBeatLoopRenderSpec', () => {
  beforeEach(() => {
    objects.clear()
    readJsonFile.mockClear()
  })

  it('is undefined for a project that is not a loop short, without reading anything', async () => {
    await expect(readBeatLoopRenderSpec(storage)).resolves.toBeUndefined()
    expect(readJsonFile).not.toHaveBeenCalled()
  })

  it("reads the loop's storyboard", async () => {
    objects.set(`${ROOT}/${BEAT_LOOP_STORYBOARD_PATH}`, JSON.stringify(storyboard))
    await expect(readBeatLoopRenderSpec(storage)).resolves.toEqual({
      clipCount: 2,
      stamps: ['c. 2560 BC', null],
    })
  })
})

describe('finishBeatLoopDelivery', () => {
  let workDir: string
  const transcript = loopTranscript()
  const pref = getDefaultCaptionRenderPref()
  /** What a loop's render hands finalizeRender: its captions resolved once, or none when off. */
  const loopRender = (over: { captionAdded?: boolean } = {}) => {
    const captionAdded = over.captionAdded ?? true
    return {
      beatLoopCaptions: {
        captionRenderPref: pref,
        captionTrack: captionAdded ? transcriptToEditingScriptTextTrack(transcript) : undefined,
      },
      captionAdded,
      cleanVideoUri: `${ROOT}/${BEAT_LOOP_CONCAT_PATH}`,
      logger,
      projectId: 'p1',
      storage,
    }
  }

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'beat-loop-delivery-'))
    objects.clear()
    readJsonFile.mockClear()
    objects.set(`${ROOT}/${BEAT_LOOP_STORYBOARD_PATH}`, JSON.stringify(storyboard))
    objects.set(`${ROOT}/${VOICE_PATH}`, 'voice-bytes')
    objects.set(`${ROOT}/${TRANSCRIPT_PATH}`, JSON.stringify(transcript))
    applyBeatLoopFinish.mockReset()
    applyBeatLoopFinish.mockImplementation(async (input) => ({
      delivered: { lufs: -14, truePeakDb: -1.6 },
      durationS: 8,
      normalizationType: 'linear',
      outputPath: input.outputPath,
      targetLufs: -14,
    }))
  })
  afterEach(() => fs.rmSync(workDir, { force: true, recursive: true }))

  it('leaves every other render alone', async () => {
    const delivered = await finishBeatLoopDelivery(
      { ...loopRender(), cleanVideoUri: 'store://renders/long-take-final.mp4' },
      '/tmp/deliver_aac.mp4',
      workDir,
    )
    expect(delivered).toBe('/tmp/deliver_aac.mp4')
    expect(readJsonFile).not.toHaveBeenCalled()
    expect(applyBeatLoopFinish).not.toHaveBeenCalled()
  })

  it("mixes the voice-over over the clips' sound and draws the render's captions and the stamps", async () => {
    const delivered = await finishBeatLoopDelivery(loopRender(), '/tmp/deliver_aac.mp4', workDir)

    expect(applyBeatLoopFinish).toHaveBeenCalledTimes(1)
    const [input] = applyBeatLoopFinish.mock.calls[0]
    expect(input).toMatchObject({ durationS: 8, videoPath: '/tmp/deliver_aac.mp4' })
    // The stamps go through the caption painter as segments, in the video's highlight colour,
    // not the storyboard's old accent.
    expect(input).not.toHaveProperty('accent')
    expect(input.stamps).toEqual(beatLoopStampSegments(['c. 2560 BC', null], pref))
    expect(input.stamps.map((s) => [s.in, s.out, s.style.animationBgColor])).toEqual([
      [300, 3000, pref.highlightColor.primary],
    ])
    // The adapter names each segment afresh.
    const expected = await beatLoopCaptionSegments(
      transcriptToEditingScriptTextTrack(transcript),
      pref,
    )
    expect(input.captions).toEqual(expected.map((s) => ({ ...s, id: expect.any(String) })))
    expect(input.captions.map((s) => s.texts.map((t) => t.t).join(' '))).toEqual([
      'THE GREAT PYRAMID',
      'TWENTY YEARS',
    ])
    // Read once by the render: the transcript is not read again here.
    expect(readJsonFile).not.toHaveBeenCalledWith(TRANSCRIPT_PATH)
    expect(input.voicePath).toBe(filePath(`${ROOT}/${VOICE_PATH}`))
    expect(fs.readFileSync(input.voicePath ?? '', 'utf8')).toBe('voice-bytes')
    expect(path.dirname(input.outputPath)).toBe(workDir)
    expect(delivered).toBe(input.outputPath)
  })

  describe('music', () => {
    const BED_URI = 'store://projects/p1/bgm/bed-1.mp3'
    beforeEach(() => objects.set(BED_URI, 'bed-bytes'))

    it('puts the music the user added under the loop, its Volume % under the narration', async () => {
      await finishBeatLoopDelivery(
        { ...loopRender(), beatLoopMusic: { bedUri: BED_URI, volume: 40 } },
        '/tmp/deliver_aac.mp4',
        workDir,
      )
      const [input] = applyBeatLoopFinish.mock.calls[0]
      const bedPath = filePath(BED_URI)
      expect(input.music).toEqual({ duckDb: resolveBgmDuckDbForVolume(40), path: bedPath })
      expect(fs.readFileSync(bedPath, 'utf8')).toBe('bed-bytes')
    })

    it('mixes none by default, or at 0%', async () => {
      await finishBeatLoopDelivery(loopRender(), '/tmp/in.mp4', workDir)
      await finishBeatLoopDelivery(
        { ...loopRender(), beatLoopMusic: { bedUri: BED_URI, volume: 0 } },
        '/tmp/in.mp4',
        workDir,
      )
      expect(applyBeatLoopFinish.mock.calls.map(([input]) => input.music)).toEqual([
        undefined,
        undefined,
      ])
    })

    it('still delivers the loop, without music, when the music cannot be read, and says so', async () => {
      objects.delete(BED_URI)
      logger.warn.mockClear()
      const delivered = await finishBeatLoopDelivery(
        { ...loopRender(), beatLoopMusic: { bedUri: BED_URI, volume: 60 } },
        '/tmp/in.mp4',
        workDir,
      )
      const [input] = applyBeatLoopFinish.mock.calls[0]
      expect(input.music).toBeUndefined()
      expect(delivered).toBe(input.outputPath)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/music/i))
    })
  })

  it('keeps the stamps, in the highlight colour, but draws no captions when captions are off', async () => {
    await finishBeatLoopDelivery(loopRender({ captionAdded: false }), '/tmp/in.mp4', workDir)
    const [input] = applyBeatLoopFinish.mock.calls[0]
    expect(input.captions).toEqual([])
    expect(input.stamps).toHaveLength(1)
    expect(input.stamps[0].style.animationBgColor).toBe(pref.highlightColor.primary)
    expect(readJsonFile).not.toHaveBeenCalledWith(TRANSCRIPT_PATH)
  })

  it('reads the captions in the default style when the render did not hand them over', async () => {
    const { beatLoopCaptions: _, ...render } = loopRender()
    // From an older voice-over: chunks held for their windows, without saying so.
    const { captionWindows: _windows, ...older } = transcript
    objects.set(`${ROOT}/${TRANSCRIPT_PATH}`, JSON.stringify(older))
    await finishBeatLoopDelivery(render, '/tmp/in.mp4', workDir)
    const [input] = applyBeatLoopFinish.mock.calls[0]
    expect(readJsonFile).toHaveBeenCalledWith(TRANSCRIPT_PATH)
    expect(input.captions.map((s) => [s.in, s.out])).toEqual([
      [150, 4000],
      [4150, 8000],
    ])
  })

  it("reads no transcript when the render handed over no captions and didn't add them", async () => {
    objects.delete(`${ROOT}/${TRANSCRIPT_PATH}`)
    const { beatLoopCaptions: _, ...render } = loopRender({ captionAdded: false })
    await finishBeatLoopDelivery(render, '/tmp/in.mp4', workDir)
    const [input] = applyBeatLoopFinish.mock.calls[0]
    expect(input.captions).toEqual([])
    expect(input.stamps).toHaveLength(1)
    expect(readJsonFile).not.toHaveBeenCalledWith(TRANSCRIPT_PATH)
  })

  describe("the clips' sound bed", () => {
    /** What the finish measured and mixed at. */
    const levels = {
      sfx: { gainDb: -12.1, lufs: -20, peakDb: -9 },
      voice: { gainDb: -5, lufs: -18, peakDb: -2 },
    }

    beforeEach(() => {
      writeBeatLoopSfxBed.mockClear()
      applyBeatLoopFinish.mockImplementation(async (input) => ({
        delivered: { lufs: -14, truePeakDb: -1.6 },
        durationS: 8,
        levels,
        normalizationType: 'linear',
        outputPath: input.outputPath,
        targetLufs: -14,
      }))
    })

    it('stores the bed for the live preview, levelled as the finish mixed the clips', async () => {
      const delivered = await finishBeatLoopDelivery(loopRender(), '/tmp/deliver_aac.mp4', workDir)

      expect(writeBeatLoopSfxBed).toHaveBeenCalledTimes(1)
      const [into, bed] = writeBeatLoopSfxBed.mock.calls[0]
      expect(into).toBe(storage)
      // The clips' own sound, as the finish took it, at the finish's levels and length.
      const [finished] = applyBeatLoopFinish.mock.calls[0]
      expect(bed).toEqual({
        durationS: 8,
        levels,
        sfxPath: '/tmp/deliver_aac.mp4',
        voicePath: finished.voicePath,
        workDir: expect.stringContaining(workDir),
      })
      expect(delivered).toBe(applyBeatLoopFinish.mock.calls[0][0].outputPath)
    })

    it('stores it with the captions off too, and none for any other render', async () => {
      await finishBeatLoopDelivery(loopRender({ captionAdded: false }), '/tmp/in.mp4', workDir)
      expect(writeBeatLoopSfxBed).toHaveBeenCalledTimes(1)

      writeBeatLoopSfxBed.mockClear()
      await finishBeatLoopDelivery(
        { ...loopRender(), cleanVideoUri: 'store://renders/long-take-final.mp4' },
        '/tmp/in.mp4',
        workDir,
      )
      expect(writeBeatLoopSfxBed).not.toHaveBeenCalled()
    })

    it('still delivers the loop when its bed cannot be stored, and says so', async () => {
      writeBeatLoopSfxBed.mockRejectedValueOnce(new Error('ffmpeg failed: no space left'))
      logger.warn.mockClear()

      const delivered = await finishBeatLoopDelivery(loopRender(), '/tmp/in.mp4', workDir)

      expect(delivered).toBe(applyBeatLoopFinish.mock.calls[0][0].outputPath)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/sound bed.*no space left/))
    })
  })

  it('never ships a loop without its captions: a missing transcript fails, saying how to fix it', async () => {
    objects.delete(`${ROOT}/${TRANSCRIPT_PATH}`)
    const { beatLoopCaptions: _, ...render } = loopRender()
    await expect(finishBeatLoopDelivery(render, '/tmp/in.mp4', workDir)).rejects.toThrow(
      /captions can't be drawn.*transformed_transcript\.json.*turn the captions off/,
    )
    expect(applyBeatLoopFinish).not.toHaveBeenCalled()
  })

  it('fails on a corrupt transcript, or one with no timed words', async () => {
    const { beatLoopCaptions: _, ...render } = loopRender()
    objects.set(`${ROOT}/${TRANSCRIPT_PATH}`, '{"segments": [')
    await expect(finishBeatLoopDelivery(render, '/tmp/in.mp4', workDir)).rejects.toThrow(
      /can't be read/,
    )
    objects.set(
      `${ROOT}/${TRANSCRIPT_PATH}`,
      JSON.stringify({ language: 'en', segments: [{ end: 1, start: 0, text: 'x', words: [] }] }),
    )
    await expect(finishBeatLoopDelivery(render, '/tmp/in.mp4', workDir)).rejects.toThrow(
      /no timed words/,
    )
    expect(applyBeatLoopFinish).not.toHaveBeenCalled()
  })

  it("fails when the loop's storyboard is gone", async () => {
    objects.delete(`${ROOT}/${BEAT_LOOP_STORYBOARD_PATH}`)
    await expect(finishBeatLoopDelivery(loopRender(), '/tmp/in.mp4', workDir)).rejects.toThrow(
      /beat_loop\.json/,
    )
    expect(applyBeatLoopFinish).not.toHaveBeenCalled()
  })
})
