import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import { runFal } from './fal'
import { imageSizeOf } from './frame-fit'
import { runGoogle } from './google'
import { generateVideo } from './media'
import {
  resetGenerationProviderForTesting,
  resetModelRegistryForTesting,
  setGenerationProvider,
} from './registry'

// No ffprobe in CI: every probe reports a 4 s 720x1280 clip.
jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], cb: (err: null, out: { stdout: string }) => void) =>
    cb(null, {
      stdout: JSON.stringify({
        format: { duration: '4.0' },
        streams: [{ height: 1280, width: 720 }],
      }),
    }),
}))
// Never reach fal: the queue call and the download are stubbed.
jest.mock('./fal', () => ({
  download: jest.fn().mockResolvedValue(Buffer.from('mp4')),
  runFal: jest.fn().mockResolvedValue({
    output: { video: { url: 'https://fal.media/clip.mp4' } },
    requestId: 'fal-1',
  }),
}))

/** A 3.8 s slot, asked for exactly `exactSeconds` (a loop clip), or snapped when null (long-take). */
async function loopClip(models: string[], exactSeconds: null | number = 4) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'media-loop-'))
  return generateVideo({
    aspectRatio: '9:16',
    durationSeconds: 3.8,
    ...(exactSeconds === null ? {} : { exactDurationSeconds: exactSeconds }),
    firstFrameUrl: await png(768, 1344),
    lastFrameUrl: await png(768, 1376),
    models,
    outputPath: path.join(dir, 'clip.mp4'),
    prompt: '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]\nhit\n\nnon_diegetic_music: N/A',
    resolution: '768p',
    task: 'test',
  })
}

async function png(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: { background: { b: 40, g: 120, r: 200 }, channels: 3, height, width },
  })
    .png()
    .toBuffer()
  return `data:image/png;base64,${buffer.toString('base64')}`
}

beforeEach(() => resetModelRegistryForTesting())

afterEach(() => {
  jest.restoreAllMocks()
  jest.mocked(runFal).mockClear()
  resetGenerationProviderForTesting()
})

describe('loop clips', () => {
  it('asks H3 for exactly 4 s, where a long-take clip of 3.8 s gets 5 s', async () => {
    await loopClip(['minimax-h3-max-turbo'])
    expect(runFal).toHaveBeenLastCalledWith(
      'minimax/h3-max-turbo/image-to-video',
      expect.objectContaining({ duration: 4, resolution: '768P' }),
      undefined,
    )
    await loopClip(['minimax-h3-max-turbo'], null)
    expect(runFal).toHaveBeenLastCalledWith(
      'minimax/h3-max-turbo/image-to-video',
      expect.objectContaining({ duration: 5 }),
      undefined,
    )
  })

  it('sends Omni both frames cropped to 720x1280 and asks for "4s" at 720p', async () => {
    setGenerationProvider('google')
    const create = jest.spyOn(runGoogle, 'createInteraction').mockResolvedValue({
      id: 'interaction-1',
      status: 'completed',
      steps: [{ content: [{ data: 'bXA0', type: 'video' }], type: 'model_output' }],
    })
    await loopClip(['omni-flash-google'])
    const body = create.mock.calls[0]?.[0] as {
      input: { data?: string; mime_type?: string }[]
      response_format: Record<string, string>
    }
    expect(body.response_format).toMatchObject({ duration: '4s', resolution: '720p' })
    const pictures = body.input.filter((part) => part.data)
    expect(pictures).toHaveLength(2)
    for (const picture of pictures)
      expect(await imageSizeOf(`data:${picture.mime_type};base64,${picture.data}`)).toEqual({
        height: 1280,
        width: 720,
      })
  })
})
