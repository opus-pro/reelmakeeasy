import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The transition step in loop mode (`beatLoop: true`), on tiny FFmpeg clips. Only the paid
// model call, storage and the record keeping are faked.
let root = ''
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    ensureDir: async () => undefined,
    getFullPath: (relative: string) => path.join(root, relative),
  }),
}))
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  ...jest.requireActual('@reelmakeeasy/common/storage/stored-files'),
  uploadToStore: async (local: string, target: string) => {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(local, target)
  },
}))
jest.mock('../long-take/common', () => ({
  ...jest.requireActual('../long-take/common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
jest.mock('../long-take/transition-artifacts', () => ({
  ensureLongTakeTransitionArtifactsDir: async () => undefined,
  persistTransitionArtifacts: async () => undefined,
}))
jest.mock('../long-take/seedance25-identity-references', () => ({
  prepareSeedance25IdentityReferenceContext: async () => ({
    bindPrompt: (prompt: string) => prompt,
    referenceImageUrls: undefined,
  }),
}))
const classicClip = jest.fn()
jest.mock('../long-take-generation-record', () => ({
  ...jest.requireActual('../long-take-generation-record'),
  generateTransitionVideoClipWithRecord: (input: unknown) => classicClip(input),
}))
const retime = jest.fn()
jest.mock('@reelmakeeasy/common/utils/media', () => ({
  ...jest.requireActual('@reelmakeeasy/common/utils/media'),
  retimeTransitionVideoIfNeeded: (input: unknown) => retime(input),
}))
let clipSeconds = 107 / 24
const loopClip = jest.fn()
jest.mock('./clip-video', () => ({
  ...jest.requireActual('./clip-video'),
  generateBeatLoopClipVideo: async (input: {
    model: string
    prompt: string
    tempDir: string
    transitionId: string
  }) => {
    loopClip(input)
    const file = path.join(input.tempDir, `${input.transitionId}.mp4`)
    makeClip(file, clipSeconds)
    return { actualModel: input.model, path: file, prompt: input.prompt, providerTaskId: 'req-9' }
  },
}))

import { generateLongTakeTransitionVideo } from '../long-take/transitions'

import { BEAT_LOOP_REROLL } from './clip-video'

/** A testsrc clip with a tone: what H3 sends back for a 4 s request (107 frames). */
function makeClip(file: string, seconds: number): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=144x256:rate=24:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    file,
  ])
}

function streams(file: string): { frames: number; types: string[] } {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-show_entries',
    'stream=codec_type,nb_read_frames',
    '-of',
    'json',
    file,
  ])
  const parsed = JSON.parse(out.toString()) as {
    streams: { codec_type: string; nb_read_frames?: string }[]
  }
  const video = parsed.streams.find((s) => s.codec_type === 'video')
  return { frames: Number(video?.nb_read_frames), types: parsed.streams.map((s) => s.codec_type) }
}

const PROMPT =
  'A 4-second vertical short-form clip.\n\nAudio: diegetic sound effects only.\n\nnon_diegetic_music: N/A'

let framesDir: string
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-transition-'))
  framesDir = path.join(root, 'frames')
  fs.mkdirSync(framesDir)
  for (const name of ['f0.png', 'f1.png']) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=144x256',
      '-frames:v',
      '1',
      path.join(framesDir, name),
    ])
  }
})
afterAll(() => fs.rmSync(root, { force: true, recursive: true }))
beforeEach(() => {
  clipSeconds = 107 / 24
  loopClip.mockClear()
  classicClip.mockReset()
  retime.mockReset()
})

const params = () => ({
  beatLoop: true,
  captureLastFrame: true,
  // Loop clips keep their first frame even when a caller asks to drop it.
  dropFirstFrame: true,
  durationSeconds: 4,
  endMs: 4000,
  firstFrameUri: path.join(framesDir, 'f0.png'),
  fromShotId: 'f0',
  lastFrameUri: path.join(framesDir, 'f1.png'),
  outputName: 's1_take2',
  preparedPrompt: PROMPT,
  projectId: 'p1',
  prompt: PROMPT,
  startMs: 0,
  toShotId: 'f1',
  transitionId: 's1',
  transitionVideoModel: 'minimax-h3-max-turbo',
  userId: 'u1',
})

describe('generateLongTakeTransitionVideo with beatLoop', () => {
  it('beat-locks the clip to 96 frames, keeps its sound and sends the prompt as written', async () => {
    const item = await generateLongTakeTransitionVideo(params())

    expect(loopClip).toHaveBeenCalledTimes(1)
    expect(loopClip.mock.calls[0][0]).toMatchObject({
      model: 'minimax-h3-max-turbo',
      prompt: PROMPT,
    })
    expect(classicClip).not.toHaveBeenCalled()
    expect(retime).not.toHaveBeenCalled()

    expect(item.videoUri).toBe(path.join(root, 'long_take/transitions/s1_take2.mp4'))
    expect(streams(item.videoUri)).toEqual({ frames: 96, types: ['video', 'audio'] })
    expect(item.prompt).toBe(PROMPT)
    expect(item.beatLoop).toMatchObject({
      audio: { status: 'levelled' },
      beatLock: { frames: 96, retimed: true },
      providerTaskId: 'req-9',
    })
    expect(item.beatLoop?.beatLock.multiplier).toBeCloseTo(1.458, 2)
  })

  it("takes the next clip's first frame from the locked clip, named after the take", async () => {
    const item = await generateLongTakeTransitionVideo(params())
    expect(item.lastFrameUri).toBe(path.join(root, 'long_take/transitions/s1_take2_last.png'))
    const expected = path.join(root, 'expected_last.png')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-sseof',
      '-0.5',
      '-i',
      item.videoUri,
      '-update',
      '1',
      expected,
    ])
    expect(fs.readFileSync(item.lastFrameUri as string)).toEqual(fs.readFileSync(expected))
  })

  it('fails with a re-roll, uploading nothing, when the clip is too far off 4 s', async () => {
    clipSeconds = 6
    const run = generateLongTakeTransitionVideo({ ...params(), outputName: 's1_take3' })
    await expect(run).rejects.toMatchObject({ nonRetryable: true, type: BEAT_LOOP_REROLL })
    expect(fs.existsSync(path.join(root, 'long_take/transitions/s1_take3.mp4'))).toBe(false)
  })

  it("hands the clip call the take's name, a clip already paid for and the paid callback", async () => {
    const onBeatLoopClipPaid = jest.fn(async () => undefined)
    const paid = { model: 'minimax-h3-max-turbo', uri: path.join(root, 'paid.mp4') }
    await generateLongTakeTransitionVideo({
      ...params(),
      beatLoopPaidClip: paid,
      onBeatLoopClipPaid,
    })
    expect(loopClip.mock.calls[0][0]).toMatchObject({
      onPaid: onBeatLoopClipPaid,
      outputName: 's1_take2',
      paidClip: paid,
    })
  })

  it('refuses a loop clip without its prepared prompt', async () => {
    const { preparedPrompt: _omitted, ...rest } = params()
    await expect(generateLongTakeTransitionVideo(rest)).rejects.toMatchObject({
      message: expect.stringMatching(/prompt/),
      nonRetryable: true,
    })
    expect(loopClip).not.toHaveBeenCalled()
  })
})
