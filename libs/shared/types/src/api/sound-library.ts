/** A sound in the user's library: a short effect or music bed they uploaded, kept on this computer. */
export type LibrarySound = {
  addedAt: string
  durationSec: number
  /** Pinned to the top of the library. */
  favorite: boolean
  id: string
  /** When an export last used it (ISO), or null. */
  lastUsedAt: null | string
  name: string
  /** The part that plays: from here (s)… */
  trimStartSec?: number
  /** …to here (s); null or missing: to the end. */
  trimEndSec?: null | number
  /** Its level wherever it's used, 0..2 (1: as recorded). Missing: 1. */
  volume?: number
  /** `store://sound-library/<file>` (a served URL as it leaves for the browser). */
  url: string
  /** How many exports used it. */
  uses: number
}

/** What the library page may change (`PUT /api/sounds/:id`). */
export type LibrarySoundPatch = {
  favorite?: boolean
  name?: string
  trimEndSec?: null | number
  trimStartSec?: number
  volume?: number
}

/** How a sound plays: the part, and the level (defaults filled in). */
export type SoundPlayback = { endSec: number; startSec: number; volume: number }

/** A sound's playback settings, with defaults for one saved before they existed. */
export function soundPlayback(sound: LibrarySound): SoundPlayback {
  const startSec = Math.max(0, Math.min(sound.trimStartSec ?? 0, sound.durationSec))
  const end = sound.trimEndSec ?? sound.durationSec
  return {
    endSec: Math.max(startSec, Math.min(end, sound.durationSec)),
    startSec,
    volume: sound.volume ?? 1,
  }
}
