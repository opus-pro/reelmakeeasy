import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runGoogle } from './google'
import { generateAudio, generateImageWithMeta, generateVideo } from './media'
import {
  GenerationNotSetUpError,
  resetGenerationProviderForTesting,
  resetModelRegistryForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from './registry'

// No ffprobe in CI: every probe reports a 6 s 720x1280 clip.
jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], cb: (err: null, out: { stdout: string }) => void) =>
    cb(null, {
      stdout: JSON.stringify({
        format: { duration: '6.0' },
        streams: [{ height: 1280, width: 720 }],
      }),
    }),
}))

const CLIP_URI = 'https://generativelanguage.googleapis.com/v1beta/files/v1:download?alt=media'

beforeEach(() => {
  resetModelRegistryForTesting()
  setGenerationProvider('google')
})

afterEach(() => {
  jest.restoreAllMocks()
  resetGenerationProviderForTesting()
})

describe('media on the google provider', () => {
  it('makes pictures with Gemini', async () => {
    const generate = jest.spyOn(runGoogle, 'generateContent').mockResolvedValue({
      candidates: [
        { content: { parts: [{ inlineData: { data: 'UE5H', mimeType: 'image/png' } }] } },
      ],
    })
    const result = await generateImageWithMeta({
      aspectRatio: '9:16',
      models: [],
      prompt: 'a fox',
      task: 'test',
    })
    expect(result.imageBase64).toBe('UE5H')
    expect(generate).toHaveBeenCalledWith(
      'gemini-3-pro-image',
      expect.objectContaining({
        generationConfig: expect.objectContaining({ responseModalities: ['IMAGE'] }),
      }),
    )
  })

  it("makes clips on Omni Flash by default, at the clip's own length", async () => {
    const create = jest.spyOn(runGoogle, 'createInteraction').mockResolvedValue({
      id: 'interaction-1',
      status: 'completed',
      steps: [{ content: [{ type: 'video', uri: CLIP_URI }], type: 'model_output' }],
    })
    // Stubbed so a wrong route fails here and never reaches the live API.
    const predict = jest
      .spyOn(runGoogle, 'predictLongRunning')
      .mockRejectedValue(new Error('Veo was called'))
    jest.spyOn(runGoogle, 'download').mockResolvedValue(Buffer.from('mp4'))
    const dir = await mkdtemp(path.join(os.tmpdir(), 'media-google-'))
    const result = await generateVideo({
      aspectRatio: '9:16',
      durationSeconds: 5,
      firstFrameUrl: 'data:image/png;base64,U1RBUlQ=',
      lastFrameUrl: 'data:image/png;base64,RU5E',
      models: [],
      outputPath: path.join(dir, 'clip.mp4'),
      prompt: 'move',
      task: 'test',
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-omni-1.1-flash',
        response_format: expect.objectContaining({ duration: '5s' }),
      }),
      expect.anything(),
    )
    expect(predict).not.toHaveBeenCalled()
    expect(result).toMatchObject({ providerTaskId: 'interaction-1' })
  })

  it('makes clips on Veo, when picked, through a long-running operation', async () => {
    const predict = jest
      .spyOn(runGoogle, 'predictLongRunning')
      .mockResolvedValue({ name: 'models/veo-3.1-fast-generate-preview/operations/op1' })
    jest.spyOn(runGoogle, 'pollOperation').mockResolvedValue({
      done: true,
      name: 'op1',
      response: { generateVideoResponse: { generatedSamples: [{ video: { uri: CLIP_URI } }] } },
    })
    const download = jest.spyOn(runGoogle, 'download').mockResolvedValue(Buffer.from('mp4'))
    const dir = await mkdtemp(path.join(os.tmpdir(), 'media-google-'))
    const result = await generateVideo({
      aspectRatio: '9:16',
      durationSeconds: 5,
      firstFrameUrl: 'data:image/png;base64,U1RBUlQ=',
      lastFrameUrl: 'data:image/png;base64,RU5E',
      models: ['veo-3.1-fast-google'],
      outputPath: path.join(dir, 'clip.mp4'),
      prompt: 'move',
      task: 'test',
    })
    expect(predict).toHaveBeenCalledWith(
      'veo-3.1-fast-generate-preview',
      expect.objectContaining({ parameters: expect.objectContaining({ durationSeconds: 8 }) }),
    )
    expect(download).toHaveBeenCalledWith(CLIP_URI, expect.anything())
    expect(result).toMatchObject({
      height: 1280,
      providerTaskId: 'models/veo-3.1-fast-generate-preview/operations/op1',
      width: 720,
    })
    expect((await readFile(result.path)).toString()).toBe('mp4')
  })

  it('makes music with Lyria', async () => {
    const generate = jest.spyOn(runGoogle, 'generateContent').mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'lyrics' }, { inlineData: { data: 'TVAz', mimeType: 'audio/mpeg' } }],
          },
        },
      ],
    })
    const result = await generateAudio({
      format: 'wav',
      models: [],
      prompt: 'calm piano',
      task: 'test',
    })
    expect(result.audioBase64).toBe('TVAz')
    expect(generate).toHaveBeenCalledWith('lyria-3-clip-preview', expect.anything())
  })

  it('refuses every kind with the Setup reason when the chosen provider cannot run', async () => {
    const generate = jest.spyOn(runGoogle, 'generateContent')
    const fal = jest.spyOn(global, 'fetch')
    setGenerationUnavailable('Gemini is chosen in Setup but GEMINI_API_KEY is missing')
    const calls = [
      () => generateImageWithMeta({ models: [], prompt: 'p', task: 'test' }),
      () => generateVideo({ models: [], outputPath: '/tmp/x.mp4', prompt: 'p', task: 'test' }),
      () => generateAudio({ models: [], prompt: 'p', task: 'test' }),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(GenerationNotSetUpError)
      await expect(call()).rejects.toThrow(/GEMINI_API_KEY is missing/)
    }
    expect(generate).not.toHaveBeenCalled()
    expect(fal).not.toHaveBeenCalled()
  })
})
