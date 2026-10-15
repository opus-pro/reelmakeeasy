import { NotFoundException } from '@nestjs/common'

const deleteStoredFile = jest.fn(async (_uri: string) => undefined)
jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  ...jest.requireActual('@reelmakeeasy/common/storage/stored-files'),
  deleteStoredFile: (uri: string) => deleteStoredFile(uri),
}))
jest.mock('@reelmakeeasy/common/long-take/music-library', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/music-library'),
  libraryTrackUrl: (v: { file: string }) => `http://localhost:5017/api/presets/${v.file}`,
  readMusicLibrary: () => ({
    tracks: [
      {
        description: 'Bright pop.',
        id: 'bright-steps',
        mood: 'upbeat',
        title: 'Bright Steps',
        variants: [{ durationSec: 30, file: 'music/bright-steps-30s.mp3' }],
      },
    ],
    version: 1,
  }),
}))

import { MusicService } from './music.service'

const row = {
  cdnUrl: 'http://localhost:5017/api/files/music-tracks/u/t1.mp3',
  createdAt: new Date('2026-10-09T00:00:00Z'),
  durationSec: 42,
  fileUri: 'store://music-tracks/u/t1.mp3',
  id: 't1',
  name: 'Brand theme',
  orgId: null,
  sizeBytes: 2_000_000,
  updatedAt: new Date('2026-10-09T00:00:00Z'),
  userId: 'u',
}

function makeService() {
  const prisma = {
    userMusicTrack: {
      delete: jest.fn(async () => row),
      findFirst: jest.fn(async (q: { where: { id: string; userId: string } }) =>
        q.where.id === row.id && q.where.userId === row.userId ? row : null,
      ),
      findMany: jest.fn(async () => [row]),
    },
  }
  return { prisma, svc: new MusicService(prisma as never) }
}

describe('MusicService', () => {
  beforeEach(() => deleteStoredFile.mockClear())

  it('serves the library with playable urls', () => {
    const { svc } = makeService()
    expect(svc.library()).toEqual([
      expect.objectContaining({
        id: 'bright-steps',
        variants: [
          { durationSec: 30, url: 'http://localhost:5017/api/presets/music/bright-steps-30s.mp3' },
        ],
      }),
    ])
  })

  it('lists the user tracks as DTOs, marking generated ones', async () => {
    const { prisma, svc } = makeService()
    prisma.userMusicTrack.findMany.mockResolvedValueOnce([
      row,
      { ...row, id: 't2', name: 'Warm Keys', source: 'generated' },
    ] as never)
    expect(await svc.listTracks('u')).toEqual([
      {
        aiGenerated: false,
        createdAt: '2026-10-09T00:00:00.000Z',
        durationSec: 42,
        id: 't1',
        name: 'Brand theme',
        url: row.cdnUrl,
      },
      {
        aiGenerated: true,
        createdAt: '2026-10-09T00:00:00.000Z',
        durationSec: 42,
        id: 't2',
        name: 'Warm Keys',
        url: row.cdnUrl,
      },
    ])
  })

  it('delete removes the row and file only', async () => {
    const { prisma, svc } = makeService()
    await svc.deleteTrack('u', 't1')
    expect(prisma.userMusicTrack.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
    expect(deleteStoredFile).toHaveBeenCalledWith(row.fileUri)
    await expect(svc.deleteTrack('someone-else', 't1')).rejects.toThrow(NotFoundException)
  })

  it('resolves a track ref to the workflow arg, or 404', async () => {
    const { svc } = makeService()
    expect(await svc.resolveTrackArg('u', { id: 'bright-steps', source: 'library' })).toEqual({
      id: 'bright-steps',
      source: 'library',
      title: 'Bright Steps',
    })
    expect(await svc.resolveTrackArg('u', { id: 't1', source: 'upload' })).toEqual({
      id: 't1',
      source: 'upload',
      title: 'Brand theme',
      uri: row.fileUri,
    })
    await expect(svc.resolveTrackArg('u', { id: 'nope', source: 'library' })).rejects.toThrow(
      NotFoundException,
    )
    await expect(svc.resolveTrackArg('x', { id: 't1', source: 'upload' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('builds the catalog for title matching', async () => {
    const { svc } = makeService()
    expect(await svc.catalog('u')).toEqual({
      library: [
        { description: 'Bright pop.', id: 'bright-steps', mood: 'upbeat', title: 'Bright Steps' },
      ],
      mine: [{ aiGenerated: false, durationSec: 42, id: 't1', name: 'Brand theme' }],
    })
  })
})

describe('MusicService.createTrack', () => {
  beforeEach(() => deleteStoredFile.mockClear())

  it('removes the temp upload when the file is refused', async () => {
    const { svc } = makeService()
    const temp = `store://tmp/u/music-track/1-photo.mp3`
    await expect(
      svc.createTrack(
        'u',
        undefined,
        { name: 'Photo', tempFileUri: temp },
        {
          download: async () => undefined,
          probe: async () => ({ durationSec: 0, hasAudio: false }),
          sizeOf: async () => 1000,
          transcode: async () => undefined,
        },
      ),
    ).rejects.toThrow(/no audio/i)
    expect(deleteStoredFile).toHaveBeenCalledWith(temp)
  })
})
