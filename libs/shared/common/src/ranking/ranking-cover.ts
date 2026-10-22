import type { RankingItem, RankingProject } from '@shared/types/api/ranking'

import { rankingSegments } from './ranking-project'

/**
 * A ranking's cover, the picture its card shows: the short at its payoff. The title band and
 * every rank's label over a frame of the rank revealed last (#1 in a countdown); a ranking with
 * no clips yet shows the overlay alone.
 */

/** Bumped when the cover's look changes, so every cover is drawn again. */
const COVER_VERSION = 3

/** The cover's size: the short's 9:16 frame at a third. */
export const RANKING_COVER_WIDTH = 360
export const RANKING_COVER_HEIGHT = 640

/** The rank the cover shows and the moment of its clip (seconds into the file), or null when no
 *  rank has a clip. A moment a little into the trim: past the first frame, near the action. */
export function rankingCoverShot(
  project: RankingProject,
): null | { atSec: number; item: RankingItem } {
  const last = rankingSegments(project).at(-1)
  const clip = last?.item.clip
  if (!last || !clip) return null
  const length = Math.max(0, clip.trimEndSec - clip.trimStartSec)
  return { atSec: clip.trimStartSec + length * 0.4, item: last.item }
}

/**
 * What the cover is drawn from, as a short key: two rankings with the same key look the same on
 * their cards. Made from the ranking as saved (its files as `store://` addresses, not as the
 * URLs the browser gets), so only the API makes it. Everything the picture shows counts (title,
 * look, labels, clips and their trims, the reveal order, stickers); the name, dates, sounds and
 * slides don't.
 */
export function rankingCoverKey(project: RankingProject): string {
  const {
    createdAt: _createdAt,
    name: _name,
    sounds: _sounds,
    transition: _transition,
    updatedAt: _updatedAt,
    ...look
  } = project as RankingProject & Record<string, unknown>
  delete look['cover']
  delete look['lastRender']
  const items = project.items.map(({ cues: _cues, ...item }) => item)
  return fnv1a(JSON.stringify({ ...look, items, version: COVER_VERSION }))
}

/** FNV-1a (32-bit) of a string, in base 36: a short, stable key (not for security). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
