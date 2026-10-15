// BGM version identity and history resolution, shared by the
// versions read, the apply operation and the regenerate seed so all three
// agree on what the switchable versions of a project are.
//
// Node-only (node:crypto). The web never derives an id: the API hands out ids
// and takes them back.

import { createHash } from 'node:crypto'

import type { BgmVersion } from '@shared/types/api/project'

import type { MusicSource } from './music-craft'

/**
 * Sentinel createdAt for a synthesized entry -- a bed that is on the project
 * but was never recorded in the history, so its generation time is unknown.
 * Matches the value the regenerate seed has always used.
 */
const UNKNOWN_CREATED_AT = new Date(0).toISOString()

/** Project columns the version history is resolved from. */
export interface BgmVersionProjectFields {
  bgmBedGainDb?: null | number
  bgmBedUri?: null | string
  bgmModel?: null | string
  bgmPrompt?: null | string
  bgmSource?: null | string
  bgmTrackId?: null | string
  bgmTrackName?: null | string
  bgmVersions?: BgmVersion[] | null
}

/** One switchable version as the API exposes it. */
export interface ResolvedBgmVersion {
  /** Measured bed->voice parity gain; null when this bed predates the measurement. */
  bedToVoiceGainDb: null | number
  /** null when the bed was never recorded in the history (time unknown). */
  createdAt: null | string
  id: string
  model: null | string
  prompt: null | string
  /** Where the bed came from; null on entries recorded before the library shipped. */
  source: MusicSource | null
  /** The library track id or the user's track id it was fitted from. */
  trackId: null | string
  trackName: null | string
  uri: string
}

const isMusicSource = (value: unknown): value is MusicSource =>
  value === 'generated' || value === 'library' || value === 'upload'

/**
 * Stable public id for a BGM bed, derived from its URI rather than stored, so
 * every pre-MS2 history entry already has one and no migration is needed.
 *
 * Bed objects are content-hashed and immutable (`bgm/bed-<sha256[0:16]>.mp3`,
 * see the generation activity), so distinct beds always carry distinct URIs;
 * two entries can only collide when they are byte-identical, in which case
 * applying either is the same operation. Hashing the URI instead of parsing
 * the object name keeps this independent of the bed naming scheme.
 */
export function resolveBgmVersionId(uri: string): string {
  return createHash('sha256').update(uri).digest('hex').slice(0, 16)
}

/**
 * The project's switchable versions in storage shape, oldest first.
 *
 * `bgmVersions` is written only by the regenerate path, which seeds entry 0
 * from the current bed on the FIRST regenerate -- so a project that
 * has never regenerated has an empty history and one perfectly good bed. The
 * creation and rerun paths likewise persist a bed without touching the
 * history, which can leave a current bed newer than everything recorded.
 *
 * Both cases are the same rule: the current bed is a version, appended when
 * the history does not already carry it. Duplicate URIs are collapsed so ids
 * stay unique and an apply is never ambiguous.
 */
export function resolveBgmVersionHistory(project: BgmVersionProjectFields): BgmVersion[] {
  const history: BgmVersion[] = []
  const seen = new Set<string>()
  for (const version of project.bgmVersions ?? []) {
    if (!version?.uri || seen.has(version.uri)) {
      continue
    }
    seen.add(version.uri)
    history.push(version)
  }

  const currentUri = project.bgmBedUri
  if (currentUri && !seen.has(currentUri)) {
    history.push({
      ...(project.bgmBedGainDb == null ? {} : { bedToVoiceGainDb: project.bgmBedGainDb }),
      createdAt: UNKNOWN_CREATED_AT,
      model: project.bgmModel ?? '',
      prompt: project.bgmPrompt ?? '',
      ...(isMusicSource(project.bgmSource) ? { source: project.bgmSource } : {}),
      ...(project.bgmTrackId ? { trackId: project.bgmTrackId } : {}),
      trackName: project.bgmTrackName ?? '',
      uri: currentUri,
    })
  }
  return history
}

/**
 * The versions read: the resolved history with a derived id per entry, plus
 * which one the project is currently playing and baking. `currentVersionId` is
 * always present in `versions` when the project has a bed, because
 * resolveBgmVersionHistory appends the current bed when it is unrecorded.
 */
export function resolveBgmVersionList(project: BgmVersionProjectFields): {
  currentVersionId: null | string
  versions: ResolvedBgmVersion[]
} {
  return {
    currentVersionId: project.bgmBedUri ? resolveBgmVersionId(project.bgmBedUri) : null,
    versions: resolveBgmVersionHistory(project).map(toResolvedBgmVersion),
  }
}

/**
 * Storage entry -> wire entry. The stored shape uses '' and the epoch as
 * "unknown" (the fields are required there); the wire shape says null, so a
 * client never renders an empty track name or a 1970 timestamp.
 */
function toResolvedBgmVersion(version: BgmVersion): ResolvedBgmVersion {
  return {
    bedToVoiceGainDb: version.bedToVoiceGainDb ?? null,
    createdAt:
      version.createdAt && version.createdAt !== UNKNOWN_CREATED_AT ? version.createdAt : null,
    id: resolveBgmVersionId(version.uri),
    model: version.model || null,
    prompt: version.prompt || null,
    source: isMusicSource(version.source) ? version.source : null,
    trackId: version.trackId || null,
    trackName: version.trackName || null,
    uri: version.uri,
  }
}
