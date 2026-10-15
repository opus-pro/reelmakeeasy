import { isStaleMusicTrack, musicPillText } from './MusicChoiceButton'

const catalog = {
  library: [{ id: 'bright-steps', title: 'Bright Steps' }],
  mine: [{ id: 't1', name: 'Brand theme' }],
}

describe('musicPillText', () => {
  it('names the pill after the choice', () => {
    expect(musicPillText({ choice: 'auto' })).toBe('Music: Auto')
    expect(musicPillText({ choice: 'upbeat' })).toBe('Music: Upbeat')
    expect(musicPillText({ choice: 'calm' })).toBe('Music: Calm')
    expect(musicPillText({ choice: 'off' })).toBe('Music: Off')
  })

  it('treats a stored value it does not know as Auto', () => {
    expect(musicPillText('loud' as never)).toBe('Music: Auto')
  })

  it('names a track by its title, a wish as Custom, and a track it cannot name yet as Track', () => {
    expect(
      musicPillText({ choice: 'auto', track: { id: 'bright-steps', source: 'library' } }, catalog),
    ).toBe('Music: Bright Steps')
    expect(musicPillText({ choice: 'auto', track: { id: 't1', source: 'upload' } }, catalog)).toBe(
      'Music: Brand theme',
    )
    expect(musicPillText({ choice: 'auto', note: 'lo-fi' })).toBe('Music: Custom')
    expect(musicPillText({ choice: 'auto', track: { id: 't1', source: 'upload' } })).toBe(
      'Music: Track',
    )
  })
})

describe('a stored track that no longer exists', () => {
  it('reads as Auto once the catalog has loaded, and is stale', () => {
    const gone = { choice: 'auto' as const, track: { id: 'deleted', source: 'upload' as const } }
    expect(musicPillText(gone, catalog, true)).toBe('Music: Auto')
    expect(isStaleMusicTrack(gone, catalog, true)).toBe(true)
    // Before the catalog loads it is only unknown yet.
    expect(musicPillText(gone, catalog, false)).toBe('Music: Track')
    expect(isStaleMusicTrack(gone, catalog, false)).toBe(false)
    expect(
      isStaleMusicTrack(
        { choice: 'auto', track: { id: 'bright-steps', source: 'library' } },
        catalog,
        true,
      ),
    ).toBe(false)
  })
})
