import { isOwnMusicTrackUri, musicTrackUri, musicTrackOwner } from './music-tracks'

describe('music-tracks', () => {
  it('keeps each user’s tracks in their own folder, with a safe folder name', () => {
    expect(musicTrackOwner('local-user')).toBe('local-user')
    expect(musicTrackOwner('a/b c')).toBe('a_b_c')
    expect(musicTrackUri('local-user', 'f1')).toMatch(
      /^store:\/\/music-tracks\/local-user\/f1\.mp3$/,
    )
  })

  it('tells a user’s own track file from anything else', () => {
    const mine = musicTrackUri('u', 'x')
    expect(isOwnMusicTrackUri('u', mine)).toBe(true)
    expect(isOwnMusicTrackUri('v', mine)).toBe(false)
    expect(isOwnMusicTrackUri('u', mine.replace('/u/', '/u/../v/'))).toBe(false)
    expect(isOwnMusicTrackUri('u', 'store://elsewhere/music-tracks/u/x.mp3')).toBe(false)
  })
})
