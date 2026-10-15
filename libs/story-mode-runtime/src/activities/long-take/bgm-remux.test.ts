import * as fs from 'node:fs'

// The project's stored files (relative paths) and its delivered objects (store:// uris).
const stored = new Set<string>()
const downloadFile = jest.fn(async (_relativePath: string, localPath: string) => {
  await fs.promises.writeFile(localPath, 'x')
})
const storage = {
  downloadFile,
  exists: async (relativePath: string) => stored.has(relativePath),
  getFullPath: (relativePath: string) => `store://projects/p1/${relativePath}`,
  uploadFile: jest.fn(async () => undefined),
}
jest.mock('./storage', () => ({ createLongTakeStorage: () => storage }))
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
jest.mock('./common', () => ({
  formatLogFields: (fields: unknown) => JSON.stringify(fields),
  isActivityCancelled: () => false,
  logger,
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
const uploads: string[] = []
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  downloadStoredFile: async (_uri: string, localPath: string) => {
    await fs.promises.writeFile(localPath, 'bed')
  },
  downloadStoredFileWithVersion: async (uri: string, localPath: string) => {
    if (uri.endsWith('watermark_video.mp4')) throw new Error('No watermark variant')
    await fs.promises.writeFile(localPath, 'video')
    return '7'
  },
  storedFileVersion: async () => '7',
  workspaceUri: (projectId: string, name: string) => `store://projects/${projectId}/${name}`,
  isVersionConflictError: () => false,
  NO_CACHE: 'no-cache',
  uploadToStore: async (localPath: string) => {
    uploads.push(localPath)
  },
}))
jest.mock('@reelmakeeasy/common/long-take/validate-delivered-video', () => ({
  assertDeliveredVideoPlayable: async () => undefined,
}))
let loop: unknown
jest.mock('@reelmakeeasy/common/long-take/beat-loop-delivery', () => ({
  BEAT_LOOP_CONCAT_PATH: 'long_take/beat_loop_clips.mp4',
  readBeatLoopRenderSpec: async () => loop,
}))
const masterBeatLoopSound = jest.fn(async (input: { outputPath: string }) => ({
  audioPath: input.outputPath,
  bedToVoiceGainDb: 4.2,
  result: {},
}))
jest.mock('@reelmakeeasy/common/long-take/beat-loop-music', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/beat-loop-music'),
  masterBeatLoopSound: (input: { outputPath: string }) => masterBeatLoopSound(input),
}))
const remuxBgmVariant = jest.fn(async (input: { outputBaseName: string; workDir: string }) => ({
  bedToVoiceGainDb: -3,
  gainDb: -10,
  outputPath: `${input.workDir}/${input.outputBaseName}.mp4`,
}))
jest.mock('@reelmakeeasy/common/long-take/bgm-remux', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/bgm-remux'),
  remuxBgmVariant: (input: { outputBaseName: string; workDir: string }) => remuxBgmVariant(input),
}))
const pushChunks = jest.fn(async (_input: unknown) => ({ success: true }))
jest.mock('@reelmakeeasy/common/agent-v2/util/push-chunks', () => ({
  pushChunks: (input: unknown) => pushChunks(input),
}))
const BED = 'store://projects/p1/bgm/bed-1.mp3'
jest.mock('@shared/db-access-layer', () => ({
  getProjectDataService: () => ({ getProject: async () => ({ bgmBedUri: BED, id: 'p1' }) }),
}))

import { resolveBgmDuckDbForVolume } from '@reelmakeeasy/common/long-take/bgm-volume'

import { remuxLongTakeBgm } from './bgm-remux'

const params = { bgmBedUri: BED, bgmEnabled: true, bgmVolume: 40, projectId: 'p1', userId: 'u' }

beforeEach(() => {
  stored.clear()
  uploads.length = 0
  loop = undefined
  downloadFile.mockClear()
  masterBeatLoopSound.mockClear()
  remuxBgmVariant.mockClear()
  pushChunks.mockClear()
})

describe('remuxLongTakeBgm on a loop short', () => {
  beforeEach(() => {
    loop = { clipCount: 6, stamps: [] }
    stored.add('long_take/beat_loop_clips.mp4')
    stored.add('story_loader/audio/voice_over.mp3')
  })

  it("masters the loop's own sound with the music under it and copies it under the picture", async () => {
    await expect(remuxLongTakeBgm(params)).resolves.toMatchObject({ applied: 'mixed' })

    // From the files the finish mixed, never the voiceover alone.
    expect(downloadFile.mock.calls.map(([relativePath]) => relativePath).sort()).toEqual([
      'long_take/beat_loop_clips.mp4',
      'story_loader/audio/voice_over.mp3',
    ])
    expect(masterBeatLoopSound).toHaveBeenCalledWith(
      expect.objectContaining({
        bedPath: expect.stringContaining('bgm_bed'),
        bgmVolume: 40,
        clipsPath: expect.stringContaining('loop_clips'),
        durationS: 24,
        voicePath: expect.stringContaining('loop_voice'),
      }),
    )
    const [sound] = masterBeatLoopSound.mock.calls[0]
    expect(remuxBgmVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        copyAudio: true,
        voiceoverPath: sound.outputPath,
        withBed: false,
      }),
    )
    expect(remuxBgmVariant.mock.calls[0][0]).not.toHaveProperty('bedPath', expect.anything())
    expect(uploads).toHaveLength(1)
    // The live preview's music level follows the loop's measurement, not the variant's.
    expect(JSON.stringify(pushChunks.mock.calls[0][0])).toContain('"bgmBedGainDb":4.2')
  })

  it('turning music off masters the loop sound without it', async () => {
    await expect(remuxLongTakeBgm({ ...params, bgmEnabled: false })).resolves.toMatchObject({
      applied: 'voiceover_only',
    })
    expect(masterBeatLoopSound.mock.calls[0][0]).not.toHaveProperty('bedPath')
    expect(remuxBgmVariant).toHaveBeenCalledWith(
      expect.objectContaining({ copyAudio: true, withBed: false }),
    )
    expect(pushChunks).not.toHaveBeenCalled()
  })

  it("fails, saying how to fix it, when the loop's clips are gone (rather than drop their sound)", async () => {
    stored.delete('long_take/beat_loop_clips.mp4')
    await expect(remuxLongTakeBgm(params)).rejects.toThrow(
      /beat_loop_clips\.mp4 is missing.*render the loop again/,
    )
    expect(uploads).toHaveLength(0)
  })
})

describe('remuxLongTakeBgm on a story video', () => {
  it('rebuilds from the voiceover with the bed mixed in, as before', async () => {
    stored.add('story_loader/audio/voice_over.m4a')
    await remuxLongTakeBgm(params)

    expect(masterBeatLoopSound).not.toHaveBeenCalled()
    expect(remuxBgmVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        bedPath: expect.stringContaining('bgm_bed'),
        copyAudio: false,
        duckDb: resolveBgmDuckDbForVolume(40),
        voiceoverPath: expect.stringContaining('voiceover.m4a'),
        withBed: true,
      }),
    )
  })
})
