import type { PushedChunk } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import { musicTrackUri } from '@reelmakeeasy/common/long-take/music-tracks'

import { createChunkSink } from './chunk-sink'

function makeSink() {
  const kv = { del: jest.fn(async () => undefined), set: jest.fn(async () => undefined) }
  const prisma = {
    project: { update: jest.fn(async () => undefined), updateMany: jest.fn() },
    userMusicTrack: {
      create: jest.fn(async () => ({ id: 't1' })),
      findFirst: jest.fn(async (): Promise<null | { id: string }> => null),
      findMany: jest.fn(async (): Promise<{ name: string }[]> => []),
    },
  }
  const sink = createChunkSink({
    getBus: async () => null,
    kv: kv as never,
    prisma: prisma as never,
  })
  return { kv, prisma, sink }
}

const patch = (data: Record<string, unknown>): PushedChunk => ({
  content: { data },
  role: 'event',
  type: 'project-patch',
})

describe('chunk sink: project-patch', () => {
  it('writes the patch and drops the cached status, so the next status read sees it', async () => {
    const { kv, prisma, sink } = makeSink()
    await sink({ chunks: [patch({ bgmTrackName: 'Warm Keys' })], projectId: 'p1', userId: 'u' })
    expect(prisma.project.update).toHaveBeenCalledWith({
      data: { bgmTrackName: 'Warm Keys' },
      where: { id: 'p1' },
    })
    expect(kv.del).toHaveBeenCalledWith('long-take:status-cache:p1')
  })

  it('ignores an empty patch', async () => {
    const { kv, prisma, sink } = makeSink()
    await sink({ chunks: [patch({})], projectId: 'p1', userId: 'u' })
    expect(prisma.project.update).not.toHaveBeenCalled()
    expect(kv.del).not.toHaveBeenCalled()
  })
})

describe('chunk sink: music-track', () => {
  const uri = (owner: string) => musicTrackUri(owner, 'f1')
  const track = (data: Record<string, unknown>): PushedChunk => ({
    content: { data },
    role: 'event',
    type: 'music-track',
  })
  const data = (owner = 'u') => ({
    cdnUrl: 'http://cdn/f1.mp3',
    durationSec: 25.5,
    fileUri: uri(owner),
    name: 'Warm Keys',
    projectId: 'p1',
    sizeBytes: 400_000,
    source: 'generated',
  })

  it('adds a generated track to the pushing user’s music', async () => {
    const { prisma, sink } = makeSink()
    await sink({ chunks: [track(data())], projectId: 'p1', userId: 'u' })
    expect(prisma.userMusicTrack.create).toHaveBeenCalledWith({
      data: {
        cdnUrl: 'http://cdn/f1.mp3',
        durationSec: 25.5,
        fileUri: uri('u'),
        name: 'Warm Keys',
        projectId: 'p1',
        sizeBytes: 400_000,
        source: 'generated',
        userId: 'u',
      },
    })
  })

  it('adds it once, and never for a file outside the user’s folder', async () => {
    const { prisma, sink } = makeSink()
    prisma.userMusicTrack.findFirst.mockResolvedValueOnce({ id: 'already' })
    await sink({ chunks: [track(data())], projectId: 'p1', userId: 'u' })
    await sink({ chunks: [track(data('someone-else'))], projectId: 'p1', userId: 'u' })
    await sink({
      chunks: [track({ ...data(), durationSec: 'long' })],
      projectId: 'p1',
      userId: 'u',
    })
    expect(prisma.userMusicTrack.create).not.toHaveBeenCalled()
  })

  it('gives a second track with the same name a number, so a pick by name is unambiguous', async () => {
    const { prisma, sink } = makeSink()
    prisma.userMusicTrack.findMany.mockResolvedValueOnce([
      { name: 'Warm Keys' },
      { name: 'Warm Keys 2' },
    ])
    await sink({ chunks: [track(data())], projectId: 'p1', userId: 'u' })
    expect(prisma.userMusicTrack.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Warm Keys 3' }),
    })
  })
})
