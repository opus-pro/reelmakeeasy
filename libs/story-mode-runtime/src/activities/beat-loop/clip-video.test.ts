import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const generateVideo = jest.fn()
jest.mock('@reelmakeeasy/llm', () => {
  const actual = jest.requireActual('@reelmakeeasy/llm')
  return { ...actual, LLM: { ...actual.LLM, generateVideo: (o: unknown) => generateVideo(o) } }
})
const recordGenerationCall = jest.fn(async (_input: unknown) => undefined)
jest.mock('../long-take-generation-record-staging', () => ({
  ...jest.requireActual('../long-take-generation-record-staging'),
  recordGenerationCall: (input: unknown) => recordGenerationCall(input),
}))
// Storage is a temp folder: the delivered clip's stored copy lands there.
let root = ''
let failUploads = false
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    getFullPath: (relative: string) => path.join(root, relative),
    uploadFile: async (local: string, relative: string) => {
      if (failUploads) throw new Error('storage is down')
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.copyFileSync(local, path.join(root, relative))
      return relative
    },
  }),
}))

import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

import {
  BEAT_LOOP_REROLL,
  generateBeatLoopClipVideo,
  isBeatLoopVideoCallFailure,
  lockBeatLoopClip,
} from './clip-video'
import { withBeatLoopProvider } from './providers'

/** A testsrc clip of `seconds` at 24 fps with a 440 Hz tone, the shape providers return. */
function frameCount(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    file,
  ])
  return Number(out.toString().trim())
}

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
    `sine=frequency=440:sample_rate=48000:duration=${seconds + 0.022}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    file,
  ])
}

let dir: string
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-clip-video-'))
  root = path.join(dir, 'storage')
})
afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))
beforeEach(() => {
  generateVideo.mockReset()
  recordGenerationCall.mockClear()
  failUploads = false
})

/** What a provider delivers: a file at the requested path. */
function delivered(fields: Record<string, unknown> = {}) {
  return async (o: { outputPath: string }) => {
    fs.writeFileSync(o.outputPath, 'clip bytes')
    return { model: 'minimax-h3-max-turbo', path: o.outputPath, usage: {}, ...fields }
  }
}

describe('generateBeatLoopClipVideo', () => {
  const base = {
    firstFramePath: '/tmp/first.png',
    firstFrameUri: 'store://f0.png',
    lastFramePath: '/tmp/last.png',
    lastFrameUri: 'store://f1.png',
    projectId: 'p1',
    prompt: 'A 4-second clip.\n\nnon_diegetic_music: N/A',
    taskId: 't1',
    transitionId: 's1',
    transitionUri: 'store://long_take/transitions/s1.mp4',
    userId: 'u1',
  }

  it('asks H3 for exactly 4 s at 768p and 9:16, with the prompt as written', async () => {
    generateVideo.mockImplementation(async (o: { outputPath: string }) => ({
      height: 1344,
      model: 'minimax-h3-max-turbo',
      path: o.outputPath,
      processedDuration: 4.458,
      providerTaskId: 'req-1',
      usage: {},
      width: 768,
    }))
    const clip = await withBeatLoopProvider('fal', () =>
      generateBeatLoopClipVideo({ ...base, model: 'minimax-h3-max-turbo', tempDir: dir }),
    )
    expect(generateVideo).toHaveBeenCalledTimes(1)
    expect(generateVideo.mock.calls[0][0]).toMatchObject({
      aspectRatio: '9:16',
      exactDurationSeconds: 4,
      firstFrameUrl: base.firstFramePath,
      lastFrameUrl: base.lastFramePath,
      models: ['minimax-h3-max-turbo'],
      prompt: base.prompt,
      resolution: '768p',
      role: 'video.firstLast',
    })
    expect(clip).toMatchObject({
      actualModel: 'minimax-h3-max-turbo',
      path: path.join(dir, 's1.mp4'),
      prompt: base.prompt,
      providerTaskId: 'req-1',
    })
    expect(recordGenerationCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'minimax-h3-max-turbo', status: 'success', type: 'video' }),
    )
  })

  it('asks Omni for 4 s at 720p when the clip runs on Google', async () => {
    generateVideo.mockImplementation(async (o: { outputPath: string }) => ({
      height: 1280,
      model: 'omni-flash-google',
      path: o.outputPath,
      processedDuration: 4,
      usage: {},
      width: 720,
    }))
    await withBeatLoopProvider('google', () =>
      generateBeatLoopClipVideo({ ...base, model: 'omni-flash-google', tempDir: dir }),
    )
    expect(generateVideo.mock.calls[0][0]).toMatchObject({
      exactDurationSeconds: 4,
      models: ['omni-flash-google'],
      resolution: '720p',
    })
  })

  it('records a failed call and never tries another model itself', async () => {
    generateVideo.mockRejectedValue(new Error('fal minimax failed: busy'))
    await expect(
      withBeatLoopProvider('fal', () =>
        generateBeatLoopClipVideo({ ...base, model: 'minimax-h3-max-turbo', tempDir: dir }),
      ),
    ).rejects.toThrow('busy')
    expect(generateVideo).toHaveBeenCalledTimes(1)
    expect(recordGenerationCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', type: 'video' }),
    )
  })

  it("marks a failed video call as the call's own (only that may go to another model)", async () => {
    const onPaid = jest.fn()
    generateVideo.mockRejectedValue(new Error('fal minimax failed: busy'))
    const error = await withBeatLoopProvider('fal', () =>
      generateBeatLoopClipVideo({ ...base, model: 'minimax-h3-max-turbo', onPaid, tempDir: dir }),
    ).catch((e: unknown) => e)
    expect(isBeatLoopVideoCallFailure(error)).toBe(true)
    expect(isBeatLoopVideoCallFailure(new Error('ffmpeg failed'))).toBe(false)
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('stores the delivered clip as it came and reports it paid, before anything is done to it', async () => {
    generateVideo.mockImplementation(delivered({ providerTaskId: 'req-7' }))
    const onPaid = jest.fn(async () => {
      // Reported before the call returns: nothing after it can lose the spend.
      expect(recordGenerationCall).not.toHaveBeenCalled()
    })
    await withBeatLoopProvider('fal', () =>
      generateBeatLoopClipVideo({
        ...base,
        model: 'minimax-h3-max-turbo',
        onPaid,
        outputName: 's1_take2',
        tempDir: dir,
      }),
    )
    const stored = path.join(root, 'long_take/transitions/s1_take2_paid.mp4')
    expect(onPaid).toHaveBeenCalledWith({
      model: 'minimax-h3-max-turbo',
      providerTaskId: 'req-7',
      uri: stored,
    })
    expect(fs.readFileSync(stored, 'utf8')).toBe('clip bytes')
  })

  it('still reports the clip paid when storing it fails', async () => {
    failUploads = true
    generateVideo.mockImplementation(delivered())
    const onPaid = jest.fn(async () => undefined)
    await withBeatLoopProvider('fal', () =>
      generateBeatLoopClipVideo({ ...base, model: 'minimax-h3-max-turbo', onPaid, tempDir: dir }),
    )
    expect(onPaid).toHaveBeenCalledWith({ model: 'minimax-h3-max-turbo' })
  })

  it('finishes a clip already paid for from its stored copy, without asking the provider again', async () => {
    const copy = path.join(dir, 'paid-copy.mp4')
    fs.writeFileSync(copy, 'the paid clip')
    const onPaid = jest.fn()
    const clip = await withBeatLoopProvider('fal', () =>
      generateBeatLoopClipVideo({
        ...base,
        model: 'minimax-h3-max-turbo',
        onPaid,
        paidClip: { model: 'omni-flash-google', providerTaskId: 'req-3', uri: copy },
        tempDir: dir,
        transitionId: 's9',
      }),
    )
    expect(generateVideo).not.toHaveBeenCalled()
    expect(onPaid).not.toHaveBeenCalled()
    expect(clip).toMatchObject({ actualModel: 'omni-flash-google', providerTaskId: 'req-3' })
    expect(fs.readFileSync(clip.path, 'utf8')).toBe('the paid clip')
  })
})

describe('lockBeatLoopClip', () => {
  it('locks an H3-length clip to 96 frames and levels its sound', async () => {
    const file = path.join(dir, 'h3.mp4')
    makeClip(file, 107 / 24)
    const meta = await lockBeatLoopClip({ clip: { path: file }, transitionId: 's1' })
    expect(frameCount(file)).toBe(96)
    expect(meta.beatLock).toMatchObject({ frames: 96, retimed: true })
    expect(meta.beatLock.multiplier).toBeCloseTo(1.458, 2)
    expect(meta.audio).toMatchObject({ status: 'levelled' })
  })

  it('asks for a re-roll, without retrying the activity, when the clip is far off 4 s', async () => {
    const file = path.join(dir, 'long.mp4')
    makeClip(file, 6)
    const error = await lockBeatLoopClip({ clip: { path: file }, transitionId: 's2' }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect(error).toMatchObject({ nonRetryable: true, type: BEAT_LOOP_REROLL })
    expect((error as Error).message).toMatch(/s2/)
  })
})
