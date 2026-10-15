import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseMusicLibrary, pickLibraryVariant, readMusicLibrary } from './music-library'

const track = {
  description: 'Bright pop.',
  id: 'bright-steps',
  mood: 'lo-fi' as const,
  title: 'Bright Steps',
  variants: [
    { durationSec: 60, file: 'music/bright-steps-60s.mp3' },
    { durationSec: 30, file: 'music/bright-steps-30s.mp3' },
  ],
}

describe('music-library', () => {
  it('parses a manifest, sorting variants by length', () => {
    const lib = parseMusicLibrary({ tracks: [track], version: 1 })
    expect(lib.tracks).toHaveLength(1)
    expect(lib.tracks[0].variants.map((v) => v.durationSec)).toEqual([30, 60])
  })

  it('rejects bad moods, duplicate ids and files outside music/', () => {
    expect(() => parseMusicLibrary({ tracks: [{ ...track, mood: 'jazz' }], version: 1 })).toThrow()
    expect(() => parseMusicLibrary({ tracks: [track, track], version: 1 })).toThrow(/duplicate/i)
    expect(() =>
      parseMusicLibrary({
        tracks: [{ ...track, variants: [{ durationSec: 30, file: '../x.mp3' }] }],
        version: 1,
      }),
    ).toThrow()
    expect(() => parseMusicLibrary({ tracks: [{ ...track, variants: [] }], version: 1 })).toThrow()
  })

  it('picks the shortest variant that covers the video, else the longest', () => {
    const parsed = parseMusicLibrary({ tracks: [track], version: 1 }).tracks[0]
    expect(pickLibraryVariant(parsed, 24).durationSec).toBe(30)
    expect(pickLibraryVariant(parsed, 30).durationSec).toBe(30)
    expect(pickLibraryVariant(parsed, 31).durationSec).toBe(60)
    expect(pickLibraryVariant(parsed, 90).durationSec).toBe(60)
  })

  it('reads a manifest from disk, and a missing or invalid one as empty', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'music-lib-'))
    const file = path.join(dir, 'library.json')
    writeFileSync(file, JSON.stringify({ tracks: [track], version: 1 }))
    expect(readMusicLibrary({ manifestPath: file }).tracks[0].id).toBe('bright-steps')
    expect(readMusicLibrary({ manifestPath: path.join(dir, 'none.json') }).tracks).toEqual([])
    const bad = path.join(dir, 'bad.json')
    writeFileSync(bad, '{"version":1,"tracks":[{"id":1}]}')
    expect(readMusicLibrary({ manifestPath: bad }).tracks).toEqual([])
  })
})
