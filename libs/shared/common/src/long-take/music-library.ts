import fs from 'node:fs'
import path from 'node:path'

import { getLogger } from '../logger'
import { presetPath, presetsDir, presetUrl } from '../storage/presets'

import { MUSIC_MOODS, MUSIC_TRACK_TYPES, type MusicMood, type MusicTrackType } from './music-craft'

export { MUSIC_MOODS, type MusicMood, type MusicTrackType } from './music-craft'

/**
 * The built-in music library: instrumental lo-fi tracks made for ReelMakeEasy, calm or
 * dynamic, each a minute long, listed in `presets/music/library.json` beside the files. A track is applied
 * by fitting the variant that covers the video (trim + fade), never by generation.
 */
export interface MusicLibrary {
  tracks: MusicLibraryTrack[]
  version: 1
}

export interface MusicLibraryTrack {
  /** Who made it and under what license: shown in the credits, kept as proof of the license. */
  credit?: MusicLibraryCredit
  description: string
  id: string
  mood: MusicMood
  title: string
  /** The videos it suits; the default track for each type is `DEFAULT_LIBRARY_TRACK`. */
  type?: MusicTrackType
  /** Ascending by length. */
  variants: MusicLibraryVariant[]
}
export interface MusicLibraryCredit {
  /** Who or what made it (an artist, or the music model). */
  artist: string
  /** The terms it ships under. */
  license: string
  /** The prompt an AI-made track was generated from. */
  prompt?: string
  /** Where it came from: the track's page, or the model's. */
  source: string
}

export interface MusicLibraryVariant {
  durationSec: number
  /** Relative to `presets/`, under `music/`. */
  file: string
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const FILE_RE = /^music\/[\w.-]+\.mp3$/

class MusicLibraryError extends Error {}

function fail(message: string): never {
  throw new MusicLibraryError(`music library: ${message}`)
}

function parseTrack(raw: unknown, index: number): MusicLibraryTrack {
  const t = (raw ?? {}) as Partial<MusicLibraryTrack>
  const where = `tracks[${index}]`
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) fail(`${where}: bad id`)
  if (typeof t.title !== 'string' || !t.title.trim()) fail(`${where}: title is required`)
  if (!MUSIC_MOODS.includes(t.mood as MusicMood)) fail(`${where}: unknown mood`)
  if (!Array.isArray(t.variants) || t.variants.length === 0) {
    fail(`${where}: at least one variant`)
  }
  const variants = t.variants
    .map((v, i) => parseVariant(v, `${where}.variants[${i}]`))
    .sort((a, b) => a.durationSec - b.durationSec)
  if (t.type !== undefined && !MUSIC_TRACK_TYPES.includes(t.type)) fail(`${where}: unknown type`)
  const credit = t.credit
  if (
    credit !== undefined &&
    !(['artist', 'license', 'source'] as const).every(
      (k) => typeof credit?.[k] === 'string' && credit[k].trim(),
    )
  )
    fail(`${where}: credit needs an artist, a license and a source`)
  return {
    ...(credit ? { credit } : {}),
    description: typeof t.description === 'string' ? t.description.trim() : '',
    id: t.id,
    mood: t.mood as MusicMood,
    title: t.title.trim(),
    ...(t.type ? { type: t.type } : {}),
    variants,
  }
}

function parseVariant(raw: unknown, where: string): MusicLibraryVariant {
  const v = (raw ?? {}) as Partial<MusicLibraryVariant>
  if (typeof v.durationSec !== 'number' || !Number.isFinite(v.durationSec) || v.durationSec <= 0) {
    fail(`${where}: durationSec must be a positive number`)
  }
  if (typeof v.file !== 'string' || !FILE_RE.test(v.file)) {
    fail(`${where}: file must be music/<name>.mp3`)
  }
  return { durationSec: v.durationSec, file: v.file }
}

/** Validates a manifest; throws with the first problem it finds. */
export function parseMusicLibrary(json: unknown): MusicLibrary {
  const raw = (json ?? {}) as Partial<MusicLibrary>
  if (raw.version !== 1) fail('version must be 1')
  if (!Array.isArray(raw.tracks)) fail('tracks must be a list')
  const tracks = raw.tracks.map(parseTrack)
  const seen = new Set<string>()
  for (const t of tracks) {
    if (seen.has(t.id)) fail(`duplicate track id ${t.id}`)
    seen.add(t.id)
  }
  return { tracks, version: 1 }
}

const EMPTY: MusicLibrary = { tracks: [], version: 1 }
const cache = new Map<string, MusicLibrary>()

/** `presets/music/library.json`, read once per process. Missing or invalid reads as empty. */
export function readMusicLibrary(opts?: { manifestPath?: string }): MusicLibrary {
  const manifestPath = opts?.manifestPath ?? path.join(presetsDir(), 'music/library.json')
  const cached = cache.get(manifestPath)
  if (cached) return cached
  let library = EMPTY
  if (fs.existsSync(manifestPath)) {
    try {
      library = parseMusicLibrary(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    } catch (error) {
      getLogger('music-library').warn(
        `Ignoring ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  cache.set(manifestPath, library)
  return library
}

/** The shortest variant that covers the video; the longest when none does (it is looped). */
export function pickLibraryVariant(
  track: MusicLibraryTrack,
  targetSec: number,
): MusicLibraryVariant {
  const covering = track.variants.find((v) => v.durationSec >= targetSec)
  return covering ?? track.variants[track.variants.length - 1]
}

/** URL browsers load a library file from. */
export function libraryTrackUrl(variant: MusicLibraryVariant): string {
  return presetUrl(variant.file)
}

/** Absolute path of a library file, for server-side readers. */
export function libraryTrackPath(variant: MusicLibraryVariant): string {
  return presetPath(variant.file)
}
