import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const uploadFile = jest.fn(async () => 'bgm/x')
const storage = {
  downloadFile: jest.fn(async () => undefined),
  exists: jest.fn(async () => false),
  uploadFile,
}
jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createLongTakeStorage: () => storage,
}))
jest.mock('@reelmakeeasy/common/long-take/bgm-mix', () => ({
  measureIntegratedLufs: jest.fn(async () => -20),
}))
jest.mock('./common', () => ({
  ...jest.requireActual('./common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
// What the fitter was handed: the work dir is gone once the activity returns.
let fittedBytes = ''
const fitted = jest.fn(async (p: string) => {
  fittedBytes = await readFile(p, 'utf8')
})
jest.mock('./bgm/bgm-audio', () => ({
  matchDurationLoopTrimFade: (p: string, sec: number) => fitted(p, sec),
}))
const downloaded = jest.fn(async (_uri: string, dest: string) => {
  await writeFile(dest, 'uploaded-bytes')
})
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  ...jest.requireActual('@reelmakeeasy/common/storage/stored-files'),
  downloadStoredFile: (uri: string, dest: string) => downloaded(uri, dest),
}))

let libraryDir = ''
const track = {
  description: 'Bright pop.',
  id: 'bright-steps',
  mood: 'upbeat',
  title: 'Bright Steps',
  variants: [
    { durationSec: 30, file: 'music/bright-steps-30s.mp3' },
    { durationSec: 60, file: 'music/bright-steps-60s.mp3' },
  ],
}
jest.mock('@reelmakeeasy/common/long-take/music-library', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/music-library'),
  libraryTrackPath: (v: { file: string }) => path.join(libraryDir, path.basename(v.file)),
  readMusicLibrary: () => ({ tracks: [track], version: 1 }),
}))

import { fitLongTakeBgmTrack } from './bgm-track'

describe('fitLongTakeBgmTrack', () => {
  beforeAll(async () => {
    libraryDir = await mkdtemp(path.join(os.tmpdir(), 'music-lib-'))
    await writeFile(path.join(libraryDir, 'bright-steps-30s.mp3'), 'thirty')
    await writeFile(path.join(libraryDir, 'bright-steps-60s.mp3'), 'sixty')
  })
  beforeEach(() => {
    uploadFile.mockClear()
    fitted.mockClear()
    downloaded.mockClear()
  })

  it('fits a library variant and returns a hashed bed with its source and track id', async () => {
    const bed = await fitLongTakeBgmTrack({
      durationSec: 24,
      projectId: 'p1',
      track: { id: 'bright-steps', source: 'library', title: 'Bright Steps' },
      userId: 'u',
    })
    expect(bed).toMatchObject({
      model: '',
      prompt: '',
      source: 'library',
      trackId: 'bright-steps',
      trackName: 'Bright Steps',
    })
    expect(bed.fileUri).toMatch(/^store:\/\/projects\/p1\/bgm\/bed-[0-9a-f]{16}\.mp3$/)
    expect(bed.cdnUrl).toContain('/projects/p1/bgm/bed-')
    expect(fitted).toHaveBeenCalledWith(expect.stringMatching(/bed\.mp3$/), 24)
    // The 30 s file was the one fitted.
    expect(fittedBytes).toBe('thirty')
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/bed\.mp3$/),
      expect.stringMatching(/^bgm\/bed-[0-9a-f]{16}\.mp3$/),
    )
  })

  it('loops the longest variant when the video outlasts it', async () => {
    await fitLongTakeBgmTrack({
      durationSec: 65,
      projectId: 'p1',
      track: { id: 'bright-steps', source: 'library', title: 'Bright Steps' },
      userId: 'u',
    })
    expect(fitted).toHaveBeenCalledWith(expect.any(String), 65)
    expect(fittedBytes).toBe('sixty')
  })

  it('downloads an uploaded track by its uri', async () => {
    const bed = await fitLongTakeBgmTrack({
      durationSec: 20,
      projectId: 'p1',
      track: {
        id: 'u1',
        source: 'upload',
        title: 'Brand theme',
        uri: 'store://music-tracks/u/x.mp3',
      },
      userId: 'u',
    })
    expect(downloaded).toHaveBeenCalledWith('store://music-tracks/u/x.mp3', expect.any(String))
    expect(bed).toMatchObject({ source: 'upload', trackId: 'u1', trackName: 'Brand theme' })
  })

  it('throws on an unknown library id and on an upload without a uri', async () => {
    await expect(
      fitLongTakeBgmTrack({
        durationSec: 20,
        projectId: 'p1',
        track: { id: 'nope', source: 'library', title: 'Nope' },
        userId: 'u',
      }),
    ).rejects.toThrow(/not found/i)
    await expect(
      fitLongTakeBgmTrack({
        durationSec: 20,
        projectId: 'p1',
        track: { id: 'u1', source: 'upload', title: 'Brand theme' },
        userId: 'u',
      }),
    ).rejects.toThrow(/uri/i)
  })
})
