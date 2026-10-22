import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LibrarySound } from '@shared/types/api/sound-library'

import { SoundInputError, SoundLibraryService, SoundNotFoundError } from './sound-library.service'

const ID = (n: number) => `00000000-0000-0000-0000-00000000000${n}`
const sound = (n: number, over: Partial<LibrarySound> = {}): LibrarySound => ({
  addedAt: `2026-10-0${n}T00:00:00.000Z`,
  durationSec: 1,
  favorite: false,
  id: ID(n),
  lastUsedAt: null,
  name: `s${n}`,
  url: `store://sound-library/${ID(n)}.mp3`,
  uses: 0,
  ...over,
})

function library(sounds: LibrarySound[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-'))
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify(sounds))
  return new SoundLibraryService(root)
}

describe('SoundLibraryService', () => {
  it('lists favourites first, then the most used, then the newest', () => {
    const lib = library([sound(1, { uses: 5 }), sound(2), sound(3, { favorite: true }), sound(4, { uses: 5 })])
    expect(lib.list().map((s) => s.name)).toEqual(['s3', 's4', 's1', 's2'])
  })

  it('renames and stars, and counts each export that used a sound', () => {
    const lib = library([sound(1), sound(2)])
    lib.update(ID(1), { favorite: true, name: '  Vine   boom  ' })
    expect(lib.get(ID(1))).toMatchObject({ favorite: true, name: 'Vine boom' })
    lib.recordUse([ID(1), ID(1), ID(2)])
    lib.recordUse([ID(1)])
    expect(lib.get(ID(1)).uses).toBe(2)
    expect(lib.get(ID(2)).uses).toBe(1)
    expect(lib.get(ID(1)).lastUsedAt).not.toBeNull()
  })

  it('keeps a trim inside the sound and a volume from 0 to 200%', () => {
    const lib = library([sound(1, { durationSec: 4 })])
    expect(lib.update(ID(1), { trimEndSec: 2.5, trimStartSec: 0.5, volume: 1.4 })).toMatchObject({
      trimEndSec: 2.5,
      trimStartSec: 0.5,
      volume: 1.4,
    })
    expect(lib.playback(ID(1))).toMatchObject({ endSec: 2.5, startSec: 0.5, volume: 1.4 })
    // To the end again.
    expect(lib.update(ID(1), { trimEndSec: null }).trimEndSec).toBeNull()
    expect(() => lib.update(ID(1), { trimEndSec: 9 })).toThrow(/inside its 4.0 s/)
    expect(() => lib.update(ID(1), { volume: 3 })).toThrow(/200%/)
  })

  it('knows its own sounds only, and refuses uploads from outside tmp/', async () => {
    const lib = library([sound(1)])
    expect(lib.has(ID(1))).toBe(true)
    expect(lib.has('../../etc/passwd')).toBe(false)
    expect(() => lib.get(ID(2))).toThrow(SoundNotFoundError)
    await expect(lib.add('store://projects/x/secret.mp3', 'a.mp3')).rejects.toThrow(SoundInputError)
    await expect(lib.add('store://tmp/u/a.exe', 'a.exe')).rejects.toThrow(/audio file/)
  })
})
