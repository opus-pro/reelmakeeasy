import { statSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_LIBRARY_TRACK } from './music-craft'
import { MUSIC_MOODS, readMusicLibrary } from './music-library'

const presets = path.resolve(__dirname, '../../../../../presets')

describe('the shipped music library', () => {
  const library = readMusicLibrary({ manifestPath: path.join(presets, 'music/library.json') })

  it('ships the four lo-fi tracks the owner picked: two calm, two dynamic', () => {
    expect(library.tracks.map((t) => [t.id, t.type])).toEqual([
      ['warm-lofi', 'calm'],
      ['dreamy-keys', 'calm'],
      ['groovy-lofi', 'dynamic'],
      ['piano-groove', 'dynamic'],
    ])
    for (const t of library.tracks) {
      expect(MUSIC_MOODS).toContain(t.mood)
      // Every track says how it was made and under what terms it ships.
      expect(t.credit).toMatchObject({ artist: 'ElevenLabs Music v2.5 (via fal)' })
      expect(t.credit?.prompt).toMatch(/Instrumental, no vocals\.$/)
    }
  })

  it('has the default track for each type', () => {
    for (const [type, id] of Object.entries(DEFAULT_LIBRARY_TRACK))
      expect(library.tracks.find((t) => t.id === id)?.type).toBe(type)
  })

  it('has a minute-long file for every track, present on disk', () => {
    for (const track of library.tracks) {
      expect(track.variants.map((v) => v.durationSec)).toEqual([60])
      for (const variant of track.variants) {
        expect(statSync(path.join(presets, variant.file)).size).toBeGreaterThan(500_000)
      }
    }
  })
})
