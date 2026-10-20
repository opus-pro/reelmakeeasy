import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { keyIsUnder, parseStoreUri, storeUri, toSavedAddress } from '@reelmakeeasy/common/storage/address'
import { dataDir, filePath, fileStore } from '@reelmakeeasy/common/storage/file-store'
import {
  type LibrarySound,
  type LibrarySoundPatch,
  soundPlayback,
} from '@shared/types/api/sound-library'

import type { SoundFile } from '../ranking/ranking-render'

import { run } from '../ranking/ranking-render'

/** Where the sounds live in the file store. */
const STORE_FOLDER = 'sound-library'
const SOUND_EXT = new Set(['.aac', '.flac', '.m4a', '.mp3', '.mp4', '.mov', '.ogg', '.opus', '.wav', '.webm'])
const NAME_MAX = 80
/** A sound longer than this is refused: the library is for effects and short beds. */
const MAX_SEC = 600
const SOUND_ID = /^[\da-f-]{36}$/

export class SoundNotFoundError extends Error {}
export class SoundInputError extends Error {}

/** A sound's length in seconds; throws when the file has no sound. */
export async function probeSound(file: string): Promise<number> {
  const out = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file],
    path.dirname(file),
  )
  const parsed = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] }
  if (!parsed.streams?.some((s) => s.codec_type === 'audio')) throw new SoundInputError('That file has no sound.')
  const sec = Number(parsed.format?.duration)
  if (!Number.isFinite(sec) || sec <= 0) throw new SoundInputError('That file has no length.')
  return sec
}

/**
 * The user's sound library: effects and beds they uploaded, kept on this computer. The list is
 * `<DATA_DIR>/sound-library/library.json`; the files are stored files under `sound-library/`.
 * Favourites come first, then the most used, then the newest.
 */
export class SoundLibraryService {
  private readonly listFile: string

  constructor(root: string = path.join(dataDir(), STORE_FOLDER)) {
    fs.mkdirSync(root, { recursive: true })
    this.listFile = path.join(root, 'library.json')
  }

  list(): LibrarySound[] {
    return this.read().toSorted(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || b.uses - a.uses || b.addedAt.localeCompare(a.addedAt),
    )
  }

  get(id: string): LibrarySound {
    const sound = this.read().find((s) => s.id === id)
    if (!sound) throw new SoundNotFoundError('That sound is no longer in your library.')
    return sound
  }

  /** The local file behind a sound (for the render). */
  localFile(id: string): string {
    return filePath(this.get(id).url)
  }

  /** What the render plays for a sound: its file, the part and the level. */
  playback(id: string): SoundFile {
    const sound = this.get(id)
    return { file: filePath(sound.url), ...soundPlayback(sound) }
  }

  /** Adds an upload (`store://tmp/...` from a signed upload) to the library. */
  async add(upload: unknown, name: unknown): Promise<LibrarySound> {
    const source = typeof upload === 'string' ? toSavedAddress(upload) : ''
    let key: string
    try {
      key = parseStoreUri(source)
    } catch {
      throw new SoundInputError('Upload the sound first.')
    }
    if (!keyIsUnder(key, 'tmp')) throw new SoundInputError('Upload the sound first.')
    const fileName = typeof name === 'string' && name.trim() ? path.basename(name.trim()) : 'sound.mp3'
    const ext = path.extname(fileName).toLowerCase()
    if (!SOUND_EXT.has(ext)) throw new SoundInputError('Use an audio file: mp3, wav, m4a, ogg, flac or aac.')
    const id = randomUUID()
    const target = storeUri(`${STORE_FOLDER}/${id}${ext}`)
    await fileStore.file(source).copyTo(target)
    let durationSec: number
    try {
      durationSec = await probeSound(filePath(target))
    } catch (error) {
      await fileStore.file(target).delete({ ignoreNotFound: true })
      throw error instanceof SoundInputError ? error : new SoundInputError("That file can't be read as sound.")
    }
    if (durationSec > MAX_SEC) {
      await fileStore.file(target).delete({ ignoreNotFound: true })
      throw new SoundInputError('Keep sounds under 10 minutes.')
    }
    const sound: LibrarySound = {
      addedAt: new Date().toISOString(),
      durationSec: Math.round(durationSec * 100) / 100,
      favorite: false,
      id,
      lastUsedAt: null,
      name: fileName.replace(/\.[^.]+$/, '').slice(0, NAME_MAX),
      url: target,
      uses: 0,
    }
    this.write([...this.read(), sound])
    return sound
  }

  update(id: string, patch: LibrarySoundPatch): LibrarySound {
    const sounds = this.read()
    const sound = sounds.find((s) => s.id === id)
    if (!sound) throw new SoundNotFoundError('That sound is no longer in your library.')
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string') throw new SoundInputError('The name must be text.')
      const name = patch.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
      if (name) sound.name = name
    }
    if (patch.favorite !== undefined) sound.favorite = patch.favorite === true
    if (patch.volume !== undefined) {
      const volume = Number(patch.volume)
      if (!Number.isFinite(volume) || volume < 0 || volume > 2)
        throw new SoundInputError('The volume is from 0 to 200%.')
      sound.volume = Math.round(volume * 100) / 100
    }
    if (patch.trimStartSec !== undefined || patch.trimEndSec !== undefined) {
      const start = Number(patch.trimStartSec ?? sound.trimStartSec ?? 0)
      const rawEnd = patch.trimEndSec === undefined ? sound.trimEndSec : patch.trimEndSec
      const end = rawEnd === null || rawEnd === undefined ? sound.durationSec : Number(rawEnd)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sound.durationSec + 0.05 || end - start < 0.1)
        throw new SoundInputError(`Trim it inside its ${sound.durationSec.toFixed(1)} s (at least 0.1 s).`)
      sound.trimStartSec = Math.round(start * 100) / 100
      sound.trimEndSec = end >= sound.durationSec - 0.01 ? null : Math.round(end * 100) / 100
    }
    this.write(sounds)
    return sound
  }

  async remove(id: string): Promise<void> {
    const sounds = this.read()
    const sound = sounds.find((s) => s.id === id)
    if (!sound) throw new SoundNotFoundError('That sound is no longer in your library.')
    this.write(sounds.filter((s) => s.id !== id))
    await fileStore.file(sound.url).delete({ ignoreNotFound: true })
  }

  /** An export used these sounds (each counted once per export). */
  recordUse(ids: Iterable<string>): void {
    const used = new Set(ids)
    if (!used.size) return
    const now = new Date().toISOString()
    this.write(this.read().map((s) => (used.has(s.id) ? { ...s, lastUsedAt: now, uses: s.uses + 1 } : s)))
  }

  /** Whether `id` names a sound in the library (for checking a project's choices). */
  has(id: string): boolean {
    return SOUND_ID.test(id) && this.read().some((s) => s.id === id)
  }

  private read(): LibrarySound[] {
    try {
      return JSON.parse(fs.readFileSync(this.listFile, 'utf8')) as LibrarySound[]
    } catch {
      return []
    }
  }

  private write(sounds: LibrarySound[]): void {
    const tmp = `${this.listFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(sounds, null, 1)}\n`)
    fs.renameSync(tmp, this.listFile)
  }
}
