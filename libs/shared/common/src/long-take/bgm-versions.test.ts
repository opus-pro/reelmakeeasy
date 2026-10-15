import { resolveBgmVersionHistory, resolveBgmVersionList } from './bgm-versions'

describe('bgm-versions: track sources', () => {
  it('seeds an unrecorded current bed with its source and track id', () => {
    const history = resolveBgmVersionHistory({
      bgmBedUri: 'store://projects/p/bgm/bed-1.mp3',
      bgmSource: 'library',
      bgmTrackId: 'bright-steps',
      bgmTrackName: 'Bright Steps',
      bgmVersions: [],
    })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ source: 'library', trackId: 'bright-steps' })
  })

  it('seeds a generated bed without a track id and leaves older entries as they are', () => {
    const history = resolveBgmVersionHistory({
      bgmBedUri: 'store://projects/p/bgm/bed-2.mp3',
      bgmSource: 'generated',
      bgmTrackId: null,
      bgmVersions: [
        {
          createdAt: '2026-10-01T00:00:00.000Z',
          model: 'lyria2',
          prompt: 'p',
          trackName: 't',
          uri: 'store://projects/p/bgm/bed-1.mp3',
        },
      ],
    })
    expect(history[0]).not.toHaveProperty('source')
    expect(history[1]).toMatchObject({ source: 'generated' })
    expect(history[1]).not.toHaveProperty('trackId')
  })

  it('carries source and track id onto the wire, null when unknown', () => {
    const { versions } = resolveBgmVersionList({
      bgmBedUri: 'store://projects/p/bgm/bed-2.mp3',
      bgmVersions: [
        {
          createdAt: '2026-10-01T00:00:00.000Z',
          model: '',
          prompt: '',
          source: 'upload',
          trackId: 'u1',
          trackName: 'Brand theme',
          uri: 'store://projects/p/bgm/bed-1.mp3',
        },
      ],
    })
    expect(versions[0]).toMatchObject({ source: 'upload', trackId: 'u1' })
    expect(versions[1]).toMatchObject({ source: null, trackId: null })
  })
})
