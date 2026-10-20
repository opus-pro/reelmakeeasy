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
  /** `store://sound-library/<file>` (a served URL as it leaves for the browser). */
  url: string
  /** How many exports used it. */
  uses: number
}

/** What the library page may change (`PUT /api/sounds/:id`). */
export type LibrarySoundPatch = { favorite?: boolean; name?: string }
