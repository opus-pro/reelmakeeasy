import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const generateBed = jest.fn()
jest.mock('./bgm/generate-bed', () => ({
  generateBed: (...args: unknown[]) => generateBed(...args),
}))

const uploadFile = jest.fn(async () => 'bgm/x')
const storage = {
  downloadFile: jest.fn(async () => undefined),
  exists: jest.fn(async () => false),
  readJsonFile: jest.fn(async () => {
    throw new Error('No such object')
  }),
  uploadFile,
}
jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createLongTakeStorage: () => storage,
}))
jest.mock('@reelmakeeasy/common/long-take/bgm-mix', () => ({
  measureIntegratedLufs: jest.fn(async () => -20),
}))
let cancelled = false
jest.mock('./common', () => ({
  ...jest.requireActual('./common'),
  getVideoDurationSeconds: async () => 25.5,
  isActivityCancelled: () => cancelled,
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
const pushed: unknown[] = []
jest.mock('@reelmakeeasy/common/agent-v2/util/push-chunks', () => ({
  pushChunks: async (input: unknown) => {
    pushed.push(input)
    return { success: true }
  },
}))
const uploadedTracks: [string, string][] = []
let failTrackUpload = false
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  ...jest.requireActual('@reelmakeeasy/common/storage/stored-files'),
  uploadToStore: async (local: string, uri: string) => {
    if (failTrackUpload) throw new Error('disk full')
    uploadedTracks.push([local, uri])
  },
}))

import { generateLongTakeBgmBed } from './bgm'

describe('generateLongTakeBgmBed', () => {
  beforeEach(() => {
    generateBed.mockReset()
    uploadFile.mockClear()
    generateBed.mockImplementation(async (_fields: unknown, _sec: number, workDir: string) => {
      const localPath = path.join(workDir, 'bed.mp3')
      await writeFile(localPath, 'audio-bytes')
      const rawPath = path.join(workDir, 'composed.mp3')
      await writeFile(rawPath, 'composition-bytes')
      return {
        durationMs: 30000,
        localPath,
        rawPath,
        model: 'lyria2',
        prompt: 'Warm piano. Instrumental.',
        trackName: 'Warm Keys',
      }
    })
  })

  it('uploads the bed under bgm/ with a content hash and returns its uris', async () => {
    const bed = await generateLongTakeBgmBed({
      durationSec: 30,
      projectId: 'p1',
      styleName: 'Ink',
      userId: 'u',
      userRequest: 'calm piano',
    })
    expect(bed).toMatchObject({
      durationMs: 30000,
      model: 'lyria2',
      prompt: 'Warm piano. Instrumental.',
      trackName: 'Warm Keys',
    })
    expect(bed?.fileUri).toMatch(/^store:\/\/projects\/p1\/bgm\/bed-[0-9a-f]{16}\.mp3$/)
    expect(bed?.cdnUrl).toContain('/projects/p1/bgm/bed-')
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/bed\.mp3$/),
      expect.stringMatching(/^bgm\/bed-[0-9a-f]{16}\.mp3$/),
    )
    expect(generateBed.mock.calls[0][0]).toMatchObject({
      hasVoiceover: true,
      styleName: 'Ink',
      userRequest: 'calm piano',
    })
  })

  it('rejects when the generator fails (the workflow keeps it non-fatal)', async () => {
    generateBed.mockRejectedValueOnce(new Error('fal down'))
    await expect(
      generateLongTakeBgmBed({ durationSec: 30, projectId: 'p1', userId: 'u' }),
    ).rejects.toThrow('fal down')
  })

  it('adds the whole composition to the user’s music, marked as generated', async () => {
    pushed.length = 0
    uploadedTracks.length = 0
    await generateLongTakeBgmBed({ durationSec: 30, projectId: 'p1', userId: 'u' })
    expect(uploadedTracks).toHaveLength(1)
    expect(uploadedTracks[0][0]).toMatch(/composed\.mp3$/)
    expect(uploadedTracks[0][1]).toMatch(/^store:\/\/music-tracks\/u\/[\w-]+\.mp3$/)
    const chunk = (
      pushed[0] as { chunks: { content: { data: Record<string, unknown> }; type: string }[] }
    ).chunks[0]
    expect(chunk.type).toBe('music-track')
    expect(chunk.content.data).toMatchObject({
      durationSec: 25.5,
      fileUri: uploadedTracks[0][1],
      name: 'Warm Keys',
      projectId: 'p1',
      source: 'generated',
    })
  })

  it('still returns the bed when saving it to the user’s music fails', async () => {
    failTrackUpload = true
    const bed = await generateLongTakeBgmBed({ durationSec: 30, projectId: 'p1', userId: 'u' })
    failTrackUpload = false
    expect(bed?.fileUri).toMatch(/bgm\/bed-/)
  })

  it('an abandoned attempt (stopped or timed out) adds nothing to the user’s music', async () => {
    pushed.length = 0
    uploadedTracks.length = 0
    cancelled = true
    await generateLongTakeBgmBed({ durationSec: 30, projectId: 'p1', userId: 'u' }).catch(
      () => null,
    )
    cancelled = false
    expect(uploadedTracks).toHaveLength(0)
    expect(pushed.filter((p) => JSON.stringify(p).includes('music-track'))).toHaveLength(0)
  })
})
