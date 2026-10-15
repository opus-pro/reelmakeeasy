import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'

import { resolveCaptionRenderPref } from '../adapters/caption/caption-style'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'
import { CaptionColorType } from '../enums/refine-v2.enum'
import { filePath } from '../storage/file-store'

// The stored files on disk: store://<key> is <data dir>/files/<key>.
const toLocal = (uri: string): string => filePath(uri)
const copy = async (from: string, to: string) => {
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  await fs.promises.copyFile(from, to)
}
jest.mock('../storage/stored-files', () => ({
  ...jest.requireActual('../storage/stored-files'),
  storedFileExists: async (uri: string) => fs.existsSync(toLocal(uri)),
  downloadStoredFile: async (uri: string, localPath: string) => copy(toLocal(uri), localPath),
  uploadToStore: async (localPath: string, uri: string) => copy(localPath, toLocal(uri)),
}))
const pushed: Array<{ chunks: Array<{ content: { data: Record<string, unknown> } }> }> = []
jest.mock('../agent-v2/util/push-chunks', () => ({
  pushChunks: async (input: (typeof pushed)[number]) => {
    pushed.push(input)
    return { success: true }
  },
}))

import { BEAT_LOOP_CONCAT_PATH, BEAT_LOOP_STORYBOARD_PATH } from './beat-loop-delivery'
import { BEAT_LOOP_SOUND_SOURCES, masterBeatLoopSound } from './beat-loop-music'
import {
  beatLoopGrid,
  type BeatLoopRenderInput,
  buildBeatLoopConcatFilter,
  concatBeatLoopClips,
  renderBeatLoopFinal,
} from './beat-loop-render'
import { remuxBgmVariant } from './bgm-remux'
import type { RenderFinalStorage, RenderFinalTransitionVideo } from './render-final.types'

jest.setTimeout(180_000)

const ROOT = 'store://projects/p1'
const VOICE_PATH = 'story_loader/audio/voice_over.mp3'
const TRANSCRIPT_PATH = 'story_loader/transcript/transformed_transcript.json'
/** The default caption style's highlight: the spoken word and the stamp strips are drawn in it. */
const GREEN: [number, number, number] = [0x04, 0xf8, 0x27]
const WHITE: [number, number, number] = [0xff, 0xff, 0xff]
const PINK: [number, number, number] = [0xff, 0x3e, 0xa5]
/** Rows of the default (bottom) caption slot: its centre is 80.9% down a 9:16 frame. */
const CAPTION_ROWS: [number, number] = [1420, 1690]

const storage: RenderFinalStorage = {
  ensureDir: async (dir) => {
    await fs.promises.mkdir(toLocal(`${ROOT}/${dir}`), { recursive: true })
    return dir
  },
  getFullPath: (relativePath) => `${ROOT}/${relativePath}`,
  readJsonFile: async <T>(relativePath: string): Promise<T> =>
    JSON.parse(await fs.promises.readFile(toLocal(`${ROOT}/${relativePath}`), 'utf8')) as T,
  uploadFile: async (localPath, storagePath) => copy(localPath, toLocal(`${ROOT}/${storagePath}`)),
  writeJsonFile: async (relativePath, data) => {
    const file = toLocal(`${ROOT}/${relativePath}`)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, JSON.stringify(data))
  },
}
const stored = (relativePath: string) => toLocal(`${ROOT}/${relativePath}`)
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

interface Stream {
  codec_name?: string
  codec_type?: string
  duration?: string
  height?: number
  nb_read_frames?: string
  width?: number
}

function ffmpeg(...args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
}

function probe(file: string) {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,nb_read_frames,duration:format=duration',
    '-of',
    'json',
    file,
  ]).toString()
  const { format, streams } = JSON.parse(out) as {
    format: { duration: string }
    streams: Stream[]
  }
  return {
    audio: streams.find((s) => s.codec_type === 'audio'),
    durationS: Number(format.duration),
    video: streams.find((s) => s.codec_type === 'video'),
  }
}

/** Decoded audio as a hash: equal hashes sound exactly the same. */
const pcm = (file: string) =>
  execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'], {
    encoding: 'utf8',
  })

/** Integrated loudness of a file's audio (ffmpeg's loudnorm meter). */
function loudness(file: string): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      'loudnorm=print_format=json',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  )
  return Number.parseFloat(/"input_i"\s*:\s*"([^"]+)"/.exec(stderr)?.[1] ?? 'NaN')
}

/** Pixels near `colour` in rows [fromY, toY) of the frame at `atS`. */
function pixels(
  file: string,
  atS: number,
  [fromY, toY]: [number, number],
  colour: [number, number, number],
): number {
  const { video } = probe(file)
  const width = Number(video?.width)
  const rgb = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', String(atS), '-i', file].concat([
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]),
    { maxBuffer: 64 * 1024 * 1024 },
  )
  let count = 0
  for (let y = fromY; y < toY; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      if (colour.every((c, k) => Math.abs(rgb[i + k] - c) <= 40)) count++
    }
  }
  return count
}

/** A clip: a flat colour, with a hard-hitting tone for a sound when `tone` is set. */
function makeClip(
  file: string,
  opts: { color: string; seconds: number; size: string; tone?: number },
) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const picture = ['-f', 'lavfi', '-i', `color=c=${opts.color}:size=${opts.size}:rate=24`]
  const sound = opts.tone
    ? ['-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*${opts.tone}*t)*(0.2+0.8*lt(t,0.3))':s=48000`]
    : []
  ffmpeg(
    ...picture,
    ...sound,
    '-t',
    String(opts.seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    ...(opts.tone ? ['-c:a', 'aac'] : []),
    file,
  )
}

const transition = (over: Partial<RenderFinalTransitionVideo>): RenderFinalTransitionVideo => ({
  endMs: 4000,
  fromShotId: 'f0',
  prompt: '',
  startMs: 0,
  toShotId: 'f1',
  transitionId: 't1',
  videoUri: `${ROOT}/long_take/transitions/t1.mp4`,
  ...over,
})

const spec = { clipCount: 2, stamps: ['c. 2560 BC', '1969 AD'] }
/** The settings the default style comes from, as a render records them. */
const CLASSIC_STYLE = { accent: '#04F827', position: null, preset: 'classic', size: 100 } as const

describe('beatLoopGrid', () => {
  it('puts the clips in order on the 4 s grid', () => {
    const grid = beatLoopGrid(
      [
        transition({ endMs: 8130, startMs: 4010, transitionId: 't2' }),
        transition({ endMs: 3950, startMs: 0, transitionId: 't1' }),
      ],
      2,
    )
    expect(grid.map((t) => [t.transitionId, t.startMs, t.endMs])).toEqual([
      ['t1', 0, 4000],
      ['t2', 4000, 8000],
    ])
  })

  it('refuses clips that do not make up the loop', () => {
    expect(() => beatLoopGrid([transition({})], 2)).toThrow(/2 clips, but 1 came to the render/)
  })
})

describe('buildBeatLoopConcatFilter', () => {
  it('pins every clip to 96 frames at 24 fps on the delivery frame, then joins them', () => {
    expect(buildBeatLoopConcatFilter({ clipCount: 2 }).split(';')).toEqual([
      '[0:v]setpts=PTS-STARTPTS,fps=24,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,tpad=stop_mode=clone:stop_duration=4,trim=end_frame=96,setpts=PTS-STARTPTS[v0]',
      '[1:v]setpts=PTS-STARTPTS,fps=24,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,tpad=stop_mode=clone:stop_duration=4,trim=end_frame=96,setpts=PTS-STARTPTS[v1]',
      '[v0][v1]concat=n=2:v=1:a=0,format=yuv420p[v]',
    ])
  })
})

describe('with FFmpeg', () => {
  let dir: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-render-'))
    process.env['DATA_DIR'] = dir
    // Two beat-locked clips at the model's size, each with its own sound.
    makeClip(stored('long_take/transitions/t1.mp4'), {
      color: '0x8a1c1c',
      seconds: 4,
      size: '768x1344',
      tone: 220,
    })
    makeClip(stored('long_take/transitions/t2.mp4'), {
      color: '0x1c3a8a',
      seconds: 4,
      size: '768x1344',
      tone: 330,
    })
    // Odd clips: another provider's size and no sound, a little short; and a little long.
    makeClip(path.join(dir, 'short.mp4'), { color: '0x1c8a3a', seconds: 3.9, size: '720x1280' })
    makeClip(path.join(dir, 'long.mp4'), {
      color: '0x8a7a1c',
      seconds: 4.2,
      size: '768x1344',
      tone: 440,
    })
    // The voice-over on the beat grid: a buzzy line from 0.15 s to 3.2 s of each clip.
    const line = 'between(mod(t,4),0.15,3.2)*(0.55+0.45*sin(2*PI*5*t))'
    fs.mkdirSync(path.dirname(stored(VOICE_PATH)), { recursive: true })
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='0.25*(sin(2*PI*190*t)+0.5*sin(2*PI*380*t))*${line}':s=48000:d=8`,
      '-c:a',
      'libmp3lame',
      stored(VOICE_PATH),
    )
    // As an older voice-over step wrote it: one segment per chunk, held until the next one
    // (here the end of its clip), but without saying so or marking the accent words.
    const transcript: TranscriptData = {
      language: 'en',
      segments: [
        { end: 4, start: 0.15, text: 'The Great Pyramid', words: [] },
        { end: 8, start: 4.15, text: 'Moon landing', words: [] },
      ].map((s) => ({
        ...s,
        words: s.text.split(' ').map((word, i) => ({
          end: s.start + (i + 1) * 0.3,
          start: s.start + i * 0.3,
          word,
        })),
      })),
    }
    fs.mkdirSync(path.dirname(stored(TRANSCRIPT_PATH)), { recursive: true })
    fs.writeFileSync(stored(TRANSCRIPT_PATH), JSON.stringify(transcript))
    fs.writeFileSync(
      stored(BEAT_LOOP_STORYBOARD_PATH),
      // An older storyboard: its caption style and accent no longer pick the look.
      JSON.stringify({
        accent: '#FFE500',
        caption_style: 'punch',
        clips: spec.stamps.map((stamp, k) => ({ id: `c${k + 1}`, stamp })),
        duration_s: 8,
      }),
    )
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))
  beforeEach(() => {
    pushed.length = 0
  })

  it('joins clips of any size and length into exact 4 s bars with their own sound', async () => {
    const outputPath = path.join(dir, 'joined.mp4')
    await concatBeatLoopClips({
      clipPaths: [path.join(dir, 'short.mp4'), path.join(dir, 'long.mp4')],
      outputPath,
      workDir: dir,
    })
    const { audio, durationS, video } = probe(outputPath)
    expect(video).toMatchObject({ height: 1920, nb_read_frames: '192', width: 1080 })
    expect(audio).toMatchObject({ codec_name: 'aac' })
    expect(Number(audio?.duration)).toBeCloseTo(8, 1)
    expect(durationS).toBeCloseTo(8, 1)
  })

  const readScript = () =>
    JSON.parse(fs.readFileSync(stored('storyboard/video_script.json'), 'utf8')) as {
      captionRenderPref?: unknown
      captionStyle?: unknown
      tracks: Array<{
        segments: Array<{
          content?: { text?: string; textElements?: Array<{ color: CaptionColorType }> }
          timeline: { in: number; out: number }
        }>
        type: string
      }>
    }

  /** What the render leaves once the file is uploaded: the look final_video.mp4 has. */
  const readRecord = () =>
    JSON.parse(fs.readFileSync(stored('final_video_caption_style.json'), 'utf8')) as unknown

  const render = (enableCaption: boolean, over: Partial<BeatLoopRenderInput> = {}) =>
    renderBeatLoopFinal({
      aspectRatio: '9:16',
      audioSourceUri: storage.getFullPath(VOICE_PATH),
      beatLoop: spec,
      captionRenderPref: getDefaultCaptionRenderPref(),
      captionStyle: CLASSIC_STYLE,
      enableCaption,
      getThumbnailFallback: async () => undefined,
      logger,
      projectId: 'p1',
      storage,
      transitionVideos: [
        transition({
          endMs: 8130,
          startMs: 4010,
          transitionId: 't2',
          videoUri: `${ROOT}/long_take/transitions/t2.mp4`,
        }),
        transition({ endMs: 3950 }),
      ],
      userContext: { userEmail: '', userId: 'u1' },
      ...over,
    })

  it('delivers the loop with its voice, captions and stamps, mastered, at 1080x1920', async () => {
    const result = await render(true)

    // The run reports the delivered loop, not the clips it was made from.
    expect(result).toMatchObject({
      bgmBaked: false,
      enableCaption: true,
      videoUri: storage.getFullPath('final_video.mp4'),
    })
    // What the render hands finalizeRender: the clips' own sound only, on the grid.
    const clips = probe(stored(BEAT_LOOP_CONCAT_PATH))
    expect(clips.video).toMatchObject({ nb_read_frames: '192' })
    expect(clips.durationS).toBeCloseTo(8, 1)

    const delivered = stored('final_video.mp4')
    const { audio, durationS, video } = probe(delivered)
    expect(video).toMatchObject({ codec_name: 'h264', height: 1920, width: 1080 })
    expect(audio).toMatchObject({ codec_name: 'aac' })
    expect(durationS).toBeCloseTo(8, 1)
    // The finish pass mastered it: the voice and the clips' sound at -14 LUFS.
    expect(Math.abs(loudness(delivered) + 14)).toBeLessThanOrEqual(0.5)
    // The stamp (top right, 0.3-3.0 s) in the caption green.
    expect(pixels(delivered, 1, [0, 400], GREEN)).toBeGreaterThan(5000)
    expect(pixels(delivered, 3.5, [0, 400], GREEN)).toBe(0)
    // The caption in the app's default style, in the bottom slot: white, the spoken word green,
    // and held after the line is said, until its clip ends.
    expect(pixels(delivered, 0.3, CAPTION_ROWS, GREEN)).toBeGreaterThan(300)
    expect(pixels(delivered, 3.5, CAPTION_ROWS, WHITE)).toBeGreaterThan(1000)
    expect(pixels(delivered, 3.5, [0, CAPTION_ROWS[0]], WHITE)).toBe(0)

    const [patch] = pushed.flatMap((p) => p.chunks.map((c) => c.content.data))
    expect(patch).toMatchObject({ duration: 8, enableCaption: true, stage: 'FINISHED' })
    const committed = JSON.parse(
      fs.readFileSync(stored('long_take/transition_videos.json'), 'utf8'),
    ) as RenderFinalTransitionVideo[]
    expect(committed.map((t) => [t.transitionId, t.startMs, t.endMs])).toEqual([
      ['t1', 0, 4000],
      ['t2', 4000, 8000],
    ])
    // The video script holds what was drawn, for the editor to preview: the clips on the grid,
    // the voice-over, the captions with their style, and the fact stamps on top.
    const script = readScript()
    expect(script.tracks.map((t) => t.type)).toEqual(['media', 'audio', 'caption', 'facts'])
    expect(script.tracks[3].segments.map((s) => [s.content?.text, s.timeline])).toEqual([
      ['c. 2560 BC', { in: 300, out: 3000 }],
      ['1969 AD', { in: 4300, out: 7000 }],
    ])
    expect(script.tracks[0].segments.map((s) => s.timeline)).toEqual([
      { in: 0, out: 4000 },
      { in: 4000, out: 8000 },
    ])
    // Each chunk held for its window, its accent word picked as the loop picks it.
    expect(script.tracks[2].segments.map((s) => s.timeline)).toEqual([
      { in: 150, out: 4000 },
      { in: 4150, out: 8000 },
    ])
    const { Default, Primary } = CaptionColorType
    expect(
      script.tracks[2].segments.map((s) => s.content?.textElements?.map((t) => t.color)),
    ).toEqual([
      [Default, Default, Primary],
      [Default, Primary],
    ])
    expect(script.captionRenderPref).toEqual(getDefaultCaptionRenderPref())
    // And the settings that style came from.
    expect(script.captionStyle).toEqual(CLASSIC_STYLE)
    // The delivered file's look, recorded for the status to say what the file shows.
    expect(readRecord()).toEqual({ captionStyle: CLASSIC_STYLE })
  })

  /** The music the user added: a chord pad, longer than the loop. */
  const bedUri = `${ROOT}/bgm/bed.wav`
  const makeBed = () => {
    fs.mkdirSync(path.dirname(toLocal(bedUri)), { recursive: true })
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='0.4*(sin(2*PI*220*t)+sin(2*PI*330*t))/2':s=44100:d=10",
      toLocal(bedUri),
    )
  }

  it("keeps the music the user added on a re-render: under the loop's own sound, still -14 LUFS and 8 s", async () => {
    makeBed()
    await render(false)
    const without = pcm(stored('final_video.mp4'))

    await render(false, { music: { bedUri: bedUri, volume: 60 } })

    const delivered = stored('final_video.mp4')
    expect(pcm(delivered)).not.toBe(without)
    expect(Math.abs(loudness(delivered) + 14)).toBeLessThanOrEqual(0.5)
    expect(probe(delivered).durationS).toBeCloseTo(8, 1)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/Beat-loop finish done.*"music":true/),
    )
  })

  it('turning music on and then off on the delivered loop puts back the exact sound it was delivered with', async () => {
    makeBed()
    await render(false)
    const delivered = stored('final_video.mp4')
    const asDelivered = pcm(delivered)
    /** A music change, as the remux activity makes it from the project's stored files. */
    const changeMusic = async (videoPath: string, name: string, volume?: number) => {
      const sound = await masterBeatLoopSound({
        ...(volume ? { bedPath: toLocal(bedUri) } : {}),
        bgmVolume: volume ?? 60,
        clipsPath: stored(BEAT_LOOP_SOUND_SOURCES.clips),
        durationS: 8,
        outputPath: path.join(dir, `${name}.m4a`),
        voicePath: stored(BEAT_LOOP_SOUND_SOURCES.voice),
      })
      const { outputPath } = await remuxBgmVariant({
        copyAudio: true,
        outputBaseName: name,
        videoPath,
        voiceoverPath: sound.audioPath,
        withBed: false,
        workDir: dir,
      })
      return outputPath
    }

    const on = await changeMusic(delivered, 'render-music-on', 60)
    expect(pcm(on)).not.toBe(asDelivered)
    const off = await changeMusic(on, 'render-music-off')
    expect(pcm(off)).toBe(asDelivered)
  })

  it('records a new look only once its file is delivered', async () => {
    await render(true)
    expect(readRecord()).toEqual({ captionStyle: CLASSIC_STYLE })

    // The user picks Punch and exports, and the render fails after writing its script (a clip
    // is gone): final_video.mp4 is still the Classic one, and the record still says so.
    const punch = { ...CLASSIC_STYLE, preset: 'punch' } as const
    await expect(
      render(true, {
        captionRenderPref: resolveCaptionRenderPref(punch, { aspectRatio: '9:16', kind: 'loop' }),
        captionStyle: punch,
        transitionVideos: [
          transition({ endMs: 3950 }),
          transition({
            endMs: 8130,
            startMs: 4010,
            transitionId: 't2',
            videoUri: `${ROOT}/long_take/transitions/gone.mp4`,
          }),
        ],
      }),
    ).rejects.toThrow()
    expect(readScript().captionStyle).toEqual(punch)
    expect(readRecord()).toEqual({ captionStyle: CLASSIC_STYLE })
  })

  it('fails before any work, with the fix, when captions are on and the transcript is corrupt', async () => {
    const good = fs.readFileSync(stored(TRANSCRIPT_PATH))
    fs.writeFileSync(stored(TRANSCRIPT_PATH), 'not json')
    fs.rmSync(stored('storyboard/video_script.json'), { force: true })
    try {
      await expect(render(true)).rejects.toThrow(/captions can't be drawn.*turn the captions off/)
      expect(pushed).toHaveLength(0)
      expect(fs.existsSync(stored('storyboard/video_script.json'))).toBe(false)
    } finally {
      fs.writeFileSync(stored(TRANSCRIPT_PATH), good)
    }
  })

  it('keeps the stamps but draws no captions when captions are off', async () => {
    const result = await render(false)

    expect(result.enableCaption).toBe(false)
    const delivered = stored('final_video.mp4')
    expect(pixels(delivered, 1, [0, 400], GREEN)).toBeGreaterThan(5000)
    expect(pixels(delivered, 1, CAPTION_ROWS, WHITE)).toBe(0)
    expect(pixels(delivered, 1, CAPTION_ROWS, GREEN)).toBe(0)
    const [patch] = pushed.flatMap((p) => p.chunks.map((c) => c.content.data))
    expect(patch).toMatchObject({ enableCaption: false })
    // The stamps stay in the video script too: the editor draws them with its captions off.
    const script = readScript()
    expect(script.tracks.map((t) => t.type)).toEqual(['media', 'audio', 'facts'])
    expect(script.captionRenderPref).toEqual(getDefaultCaptionRenderPref())
    expect(script.captionStyle).toEqual(CLASSIC_STYLE)
    expect(readRecord()).toEqual({ captionStyle: CLASSIC_STYLE })
  })

  it('saves an empty facts track for a loop without stamps, and draws none', async () => {
    const board = fs.readFileSync(stored(BEAT_LOOP_STORYBOARD_PATH))
    // The skill lets every clip go without a stamp.
    fs.writeFileSync(
      stored(BEAT_LOOP_STORYBOARD_PATH),
      JSON.stringify({ clips: [{ stamp: null }, { stamp: null }], duration_s: 8 }),
    )
    try {
      await render(false, { beatLoop: { clipCount: 2, stamps: [null, null] } })

      expect(pixels(stored('final_video.mp4'), 1, [0, 400], GREEN)).toBe(0)
      // Saved all the same: a loop's video script without one is one not rendered since stamps
      // became a track, which the editor says has its stamps in the file only.
      const script = readScript()
      expect(script.tracks.map((t) => t.type)).toEqual(['media', 'audio', 'facts'])
      expect(script.tracks[2].segments).toEqual([])
    } finally {
      fs.writeFileSync(stored(BEAT_LOOP_STORYBOARD_PATH), board)
    }
  })

  it("draws the stamps in the video's highlight in Explainer too, not its box ink", async () => {
    const explainer = { ...CLASSIC_STYLE, accent: '#FF3EA5', preset: 'explainer' } as const
    await render(false, {
      captionRenderPref: resolveCaptionRenderPref(explainer, { aspectRatio: '9:16', kind: 'loop' }),
      captionStyle: explainer,
    })

    const delivered = stored('final_video.mp4')
    expect(pixels(delivered, 1, [0, 400], PINK)).toBeGreaterThan(5000)
    expect(readRecord()).toEqual({ captionStyle: explainer })
  })
})
