import {
  findMusicTrack,
  MUSIC_CHOICE_OPTIONS,
  MUSIC_MOODS,
  musicNoteFor,
  musicRequestFromText,
  musicRequestLabel,
  DEFAULT_LIBRARY_TRACK,
  resolveMusicRequest,
  sanitizeMusicChoice,
  sanitizeMusicRequest,
  sanitizeMusicSource,
} from './music-craft'

describe('music-craft', () => {
  it('sanitizes unknown choices to auto', () => {
    expect(sanitizeMusicChoice('upbeat')).toBe('upbeat')
    expect(sanitizeMusicChoice('loud')).toBe('auto')
    expect(sanitizeMusicChoice(undefined)).toBe('auto')
  })

  it('has a label, a pill label and a description per choice', () => {
    for (const c of ['auto', 'upbeat', 'calm', 'off'] as const) {
      expect(MUSIC_CHOICE_OPTIONS[c].label).toBeTruthy()
      expect(MUSIC_CHOICE_OPTIONS[c].pill).toBeTruthy()
      expect(MUSIC_CHOICE_OPTIONS[c].description).toBeTruthy()
    }
    expect(MUSIC_CHOICE_OPTIONS.auto.label).toBe('Pick for me')
    expect(MUSIC_CHOICE_OPTIONS.off.label).toBe('No music')
  })

  it('turns presets into a director note and auto/off into none', () => {
    expect(musicNoteFor('upbeat')).toMatch(/^Upbeat:/)
    expect(musicNoteFor('calm')).toMatch(/^Calm:/)
    expect(musicNoteFor('auto')).toBeNull()
    expect(musicNoteFor('off')).toBeNull()
  })

  it('resolves off to disabled, and every preset to a library track, never a generated bed', () => {
    expect(resolveMusicRequest({ choice: 'off' })).toEqual({
      bgmEnabled: false,
      bgmNote: null,
      bgmSource: null,
      bgmTrackId: null,
    })
    const library = (id: string) => ({
      bgmEnabled: true,
      bgmNote: null,
      bgmSource: 'library',
      bgmTrackId: id,
    })
    expect(resolveMusicRequest({ choice: 'calm' })).toEqual(library(DEFAULT_LIBRARY_TRACK.calm))
    expect(resolveMusicRequest({ choice: 'upbeat' })).toEqual(
      library(DEFAULT_LIBRARY_TRACK.dynamic),
    )
    // Auto follows the video's camera style, calm when it is unknown.
    expect(resolveMusicRequest({})).toEqual(library(DEFAULT_LIBRARY_TRACK.calm))
    expect(resolveMusicRequest({}, { cameraStyle: 'dynamic' })).toEqual(
      library(DEFAULT_LIBRARY_TRACK.dynamic),
    )
    expect(resolveMusicRequest({ choice: 'calm' }, { cameraStyle: 'dynamic' })).toEqual(
      library(DEFAULT_LIBRARY_TRACK.calm),
    )
    expect(DEFAULT_LIBRARY_TRACK).toEqual({ calm: 'warm-lofi', dynamic: 'groovy-lofi' })
  })

  it('lets a typed wish win over the preset', () => {
    expect(resolveMusicRequest({ choice: 'calm', note: '  lo-fi hip hop ' })).toEqual({
      bgmEnabled: true,
      bgmNote: 'lo-fi hip hop',
      bgmSource: 'generated',
      bgmTrackId: null,
    })
  })

  it('caps and flattens a long wish', () => {
    const note = `${'a'.repeat(250)}\nsecond line`
    const r = resolveMusicRequest({ choice: 'auto', note })
    expect(r.bgmNote).toHaveLength(200)
    expect(r.bgmNote).not.toContain('\n')
  })

  it('maps make_video text: off, auto, or a wish', () => {
    expect(musicRequestFromText('off')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('OFF ')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('auto')).toEqual({ choice: 'auto' })
    expect(musicRequestFromText(undefined)).toEqual({ choice: 'auto' })
    expect(musicRequestFromText('calm')).toEqual({ choice: 'calm' })
    expect(musicRequestFromText('warm acoustic guitar')).toEqual({
      choice: 'auto',
      note: 'warm acoustic guitar',
    })
  })

  it('understands the card labels and plain refusals, in any case', () => {
    expect(musicRequestFromText('No music')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('no music')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('none')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('No')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('Pick for me')).toEqual({ choice: 'auto' })
    expect(musicRequestFromText('Pick for me (Recommended)')).toEqual({ choice: 'auto' })
    expect(musicRequestFromText('UPBEAT')).toEqual({ choice: 'upbeat' })
    expect(musicRequestFromText('no music please')).toEqual({ choice: 'off' })
    expect(musicRequestFromText('None, thanks.')).toEqual({ choice: 'off' })
    // A wish that happens to start with "no" is still a wish.
    expect(musicRequestFromText('no drums, just piano')).toEqual({
      choice: 'auto',
      note: 'no drums, just piano',
    })
  })
})

describe('music-craft: tracks', () => {
  const catalog = {
    library: [
      { id: 'bright-steps', title: 'Bright Steps' },
      { id: 'quiet-piano', title: 'Quiet Piano' },
    ],
    mine: [{ id: 'u1', name: 'Brand theme' }],
  }

  it('resolves a track request to its source and id with no note', () => {
    expect(
      resolveMusicRequest({ choice: 'upbeat', track: { id: 'u1', source: 'upload' } }),
    ).toEqual({ bgmEnabled: true, bgmNote: null, bgmSource: 'upload', bgmTrackId: 'u1' })
    expect(resolveMusicRequest({ choice: 'calm' })).toMatchObject({
      bgmSource: 'library',
      bgmTrackId: DEFAULT_LIBRARY_TRACK.calm,
    })
    expect(resolveMusicRequest({ choice: 'off', track: { id: 'u1', source: 'upload' } })).toEqual({
      bgmEnabled: false,
      bgmNote: null,
      bgmSource: null,
      bgmTrackId: null,
    })
  })

  it('sanitizes sources', () => {
    expect(sanitizeMusicSource('library')).toBe('library')
    expect(sanitizeMusicSource('LIBRARY')).toBeNull()
    expect(sanitizeMusicSource(undefined)).toBeNull()
  })

  it('finds a track by exact title, then unique substring, "my" prefix for own tracks', () => {
    expect(findMusicTrack('bright steps', catalog)).toEqual({
      id: 'bright-steps',
      source: 'library',
    })
    expect(findMusicTrack('Bright Steps (Recommended)', catalog)).toEqual({
      id: 'bright-steps',
      source: 'library',
    })
    expect(findMusicTrack('piano', catalog)).toEqual({ id: 'quiet-piano', source: 'library' })
    expect(findMusicTrack('my brand theme', catalog)).toEqual({ id: 'u1', source: 'upload' })
    expect(findMusicTrack('Brand theme', catalog)).toEqual({ id: 'u1', source: 'upload' })
    expect(findMusicTrack('steps and piano', catalog)).toBeNull()
    expect(findMusicTrack('t', catalog)).toBeNull()
  })

  it('maps text to a request: labels, refusals, tracks, else a wish', () => {
    expect(musicRequestFromText('Bright Steps', catalog)).toEqual({
      choice: 'auto',
      track: { id: 'bright-steps', source: 'library' },
    })
    expect(musicRequestFromText('my brand theme', catalog)).toEqual({
      choice: 'auto',
      track: { id: 'u1', source: 'upload' },
    })
    expect(musicRequestFromText('Upbeat', catalog)).toEqual({ choice: 'upbeat' })
    expect(musicRequestFromText('no music', catalog)).toEqual({ choice: 'off' })
    expect(musicRequestFromText('warm acoustic guitar', catalog)).toEqual({
      choice: 'auto',
      note: 'warm acoustic guitar',
    })
    expect(musicRequestFromText('Bright Steps')).toEqual({ choice: 'auto', note: 'Bright Steps' })
  })

  it('labels a request for pills', () => {
    expect(musicRequestLabel({ choice: 'auto' })).toBe('Auto')
    expect(musicRequestLabel({ choice: 'off' })).toBe('Off')
    expect(
      musicRequestLabel(
        { choice: 'auto', track: { id: 'bright-steps', source: 'library' } },
        catalog,
      ),
    ).toBe('Bright Steps')
    expect(
      musicRequestLabel({ choice: 'auto', track: { id: 'u1', source: 'upload' } }, catalog),
    ).toBe('Brand theme')
    expect(
      musicRequestLabel({ choice: 'auto', track: { id: 'gone', source: 'upload' } }, catalog),
    ).toBe('Auto')
  })
})

describe('music-craft: stored requests', () => {
  it('reads an old stored choice string, an object, or junk', () => {
    expect(sanitizeMusicRequest('calm')).toEqual({ choice: 'calm' })
    expect(sanitizeMusicRequest('loud')).toEqual({ choice: 'auto' })
    expect(sanitizeMusicRequest(null)).toEqual({ choice: 'auto' })
    expect(
      sanitizeMusicRequest({
        choice: 'auto',
        note: '  lo-fi ',
        track: { id: 'u1', source: 'upload' },
      }),
    ).toEqual({ choice: 'auto', note: 'lo-fi', track: { id: 'u1', source: 'upload' } })
    expect(
      sanitizeMusicRequest({ choice: 'upbeat', track: { id: 'x', source: 'generated' } }),
    ).toEqual({
      choice: 'upbeat',
    })
  })

  it('lists the library moods in display order', () => {
    expect(MUSIC_MOODS).toEqual(['lo-fi', 'chill', 'groove', 'piano'])
  })
})

describe('music-craft: AI tracks and refusals', () => {
  const catalog = {
    library: [{ id: 'quiet-piano', title: 'Quiet Piano' }],
    mine: [
      { aiGenerated: true, id: 'a1', name: 'Curious Acoustic Echo' },
      { id: 'u1', name: 'Nothing But Sky' },
    ],
  }

  it('a typed wish is never matched to part of an AI track name, only to its full name', () => {
    expect(musicRequestFromText('acoustic', catalog)).toEqual({ choice: 'auto', note: 'acoustic' })
    expect(musicRequestFromText('curious acoustic echo', catalog)).toEqual({
      choice: 'auto',
      track: { id: 'a1', source: 'upload' },
    })
  })

  it('a track whose name starts like a refusal is still picked by its name', () => {
    expect(musicRequestFromText('Nothing But Sky', catalog)).toEqual({
      choice: 'auto',
      track: { id: 'u1', source: 'upload' },
    })
    expect(musicRequestFromText('nothing', catalog)).toEqual({ choice: 'off' })
  })
})
