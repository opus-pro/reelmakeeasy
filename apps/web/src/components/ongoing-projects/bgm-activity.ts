'use client'

import type { BgmRemuxOutcome } from '@shared/types/api/long-take'

import { atomWithPersistence } from '@/atom/common'

import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'

/**
 * BGM (re)generation rows for the Activity notification.
 *
 * A BGM run is started from the project detail page music panel, but the
 * Activity widget is not rendered on `/story-mode/:id` -- the row only becomes
 * visible once the user navigates back to a dashboard route, by which time the
 * viewer that knows about the run is unmounted. So the armed run is mirrored
 * into a persisted store here: the viewer arms/disarms it (authoritative while
 * it is mounted) and the Activity widget settles leftovers from its own poll.
 *
 * Initial-submission BGM is NOT tracked: it is produced inside the main
 * story-mode workflow, while `generating` on the bgm-settings read probes the
 * separate `bgm-regen` workflow id -- so only a detail-page run arms a row.
 */

// Re-read cadence for a tracked run while the widget is visible; matches the
// viewer's own settings cadence (BGM_GENERATING_REFRESH_MS).
export const BGM_ACTIVITY_POLL_MS = 15_000

// A locally armed row can be ahead of server truth: the row is armed the
// moment the request is accepted, and the workflow probe behind `generating`
// can still read the workflow as absent for a beat. Within this window a
// not-generating read must NOT settle the row, or a run whose author navigated
// away immediately would lose its row seconds after starting it.
export const BGM_ACTIVITY_START_GRACE_MS = 30_000

// Backstop for a row nothing ever settles (poll blocked by route/offline, a
// tab that never returns to a dashboard route). Mirrors the viewer's own
// pending cap (BGM_REGEN_PENDING_TIMEOUT_MS) so a stuck row cannot outlive the
// longest run we would wait for.
export const BGM_ACTIVITY_MAX_AGE_MS = 10 * 60 * 1000

export type BgmActivityEntries = Record<string, BgmActivityEntry>

export type BgmActivityEntry = {
  // Last time the server confirmed this run is still generating. The age
  // backstop measures from here once set, so a long run the poll can see stays
  // on the list instead of expiring out from under affirmative server truth.
  confirmedAt?: number
  // Where the row navigates to (the project detail route).
  href: string
  // Whether the run had a bed to replace when it started -- decides the
  // "BGM Generating" vs "BGM Regenerating" label. Captured at arm time: the
  // successful run itself lands a bed, so a live read would flip the label
  // mid-run.
  kind: BgmActivityKind
  // Login identity that armed the run (JWT `sub`, the server's ownership key).
  // The store is per-browser, so a row is only ever shown to -- and polled by
  // -- the identity it belongs to; anyone else prunes it on sight.
  ownerId: string
  projectId: string
  startedAt: number
  // Raw (un-hostnamed) project thumbnail path; the consumer resolves it, so a
  // persisted entry never pins a stale file origin.
  thumbnail?: string
  // Project name at arm time; rendered as the row's subtitle.
  title: string
}

export type BgmActivityKind = 'generate' | 'regenerate'

/** Persisted across a full reload so a mid-run refresh keeps the row. */
export const bgmActivityEntriesAtom = atomWithPersistence<BgmActivityEntries>(
  'bgm:activity-runs',
  {},
  { preload: false },
)

/** Records that the server still reports this run as generating. */
export function confirmBgmActivityEntry(
  entries: BgmActivityEntries,
  projectId: string,
  now: number,
): BgmActivityEntries {
  const entry = entries[projectId]
  if (!entry) {
    return entries
  }
  return { ...entries, [projectId]: { ...entry, confirmedAt: now } }
}

/**
 * The age backstop only applies to a row nothing has confirmed lately -- a run
 * the poll still sees as generating keeps its row however long it takes.
 */
export function isBgmActivityExpired(entry: BgmActivityEntry, now: number): boolean {
  return now - Math.max(entry.startedAt, entry.confirmedAt ?? 0) >= BGM_ACTIVITY_MAX_AGE_MS
}

/**
 * Whether the project detail page should be reporting a BGM run right now.
 *
 * `hasDeliveredVideo` is the video-still-generating guard: the project's own
 * row already reports that generation, and the BGM produced by the submission
 * pipeline is not a music-panel run (it runs inside the main story-mode
 * workflow, so it never shows up as `serverGenerating` either).
 */
export function isBgmActivityRunActive(params: {
  canEditBgm: boolean
  hasDeliveredVideo: boolean
  musicPending: boolean
  serverGenerating: boolean
}): boolean {
  const { canEditBgm, hasDeliveredVideo, musicPending, serverGenerating } = params
  return canEditBgm && hasDeliveredVideo && (serverGenerating || musicPending)
}

export function pruneBgmActivityEntries(
  entries: BgmActivityEntries,
  now: number,
): BgmActivityEntries {
  const kept = Object.entries(entries).filter(([, entry]) => !isBgmActivityExpired(entry, now))
  return kept.length === Object.keys(entries).length ? entries : Object.fromEntries(kept)
}

/**
 * Drops every row that belongs to another login identity -- a logout / account
 * switch / impersonation change on this browser must not leave the previous
 * identity's project name and thumbnail on the list (their owner-only read
 * would fail for the new identity, which by itself keeps a row alive).
 * Only call with a known identity; an empty one means "not loaded yet".
 */
export function pruneForeignBgmActivityEntries(
  entries: BgmActivityEntries,
  ownerId: string,
): BgmActivityEntries {
  if (!ownerId) {
    return entries
  }
  const kept = Object.entries(entries).filter(([, entry]) => entry.ownerId === ownerId)
  return kept.length === Object.keys(entries).length ? entries : Object.fromEntries(kept)
}

export function removeBgmActivityEntry(
  entries: BgmActivityEntries,
  projectId: string,
): BgmActivityEntries {
  if (entries[projectId] === undefined) {
    return entries
  }
  const { [projectId]: _removed, ...rest } = entries
  return rest
}

/**
 * A not-generating read only settles a row once the arm grace has passed --
 * see BGM_ACTIVITY_START_GRACE_MS. A failed read never reaches here: the
 * caller keeps the row rather than settling it from a transport error.
 *
 * `outcome` is the read's `regenOutcome`, and it can veto the settle: when the
 * workflow probe behind it fails, the service answers `'unknown'` with
 * `generating: false` on purpose, so settling on `generating` alone would drop
 * the row of a workflow that is very likely still running. Same rule the
 * viewer's own pending machinery follows (see useBgmRegenerate).
 */
export function shouldSettleBgmActivity(params: {
  generating: boolean
  now: number
  outcome?: string
  startedAt: number
}): boolean {
  const { generating, now, outcome, startedAt } = params
  if (generating || isIndefiniteBgmRegenOutcome(outcome)) {
    return false
  }
  return now - startedAt >= BGM_ACTIVITY_START_GRACE_MS
}

export function toBgmActivityItem(
  entry: BgmActivityEntry,
  thumbnail: string | undefined,
): OngoingProjectsNotificationItem {
  return {
    href: entry.href,
    id: toBgmActivityItemId(entry.projectId),
    kind: 'bgm',
    projectId: entry.projectId,
    // Reuses the project AI-generating icon + animation of the status.
    status: 'generating',
    subtitle: entry.title,
    thumbnail,
    // Plain words: "BGM" means nothing to most people.
    title: 'Making music',
  }
}

/** Namespaced so a BGM row never collides with the project's own row. */
export function toBgmActivityItemId(projectId: string): string {
  return `bgm:${projectId}`
}

/**
 * Keeps `kind` and `startedAt` of an already-tracked run: the publisher
 * re-arms on every project-detail change (title, thumbnail), and neither the
 * label nor the grace/expiry clock may restart mid-run.
 *
 * `startsNewRun` is the opposite case -- a run that STARTED at the caller. It
 * replaces the row wholesale, because a leftover entry from an earlier run
 * (armed, then abandoned before anything settled it) would otherwise hand the
 * new run a label from the old bed state and a clock old enough to expire it
 * or to have burnt through its startup grace. Merely *discovering* a run in
 * flight is not that case -- see useBgmActivityPublisher.
 */
// Outcomes that describe a run definitively enough to settle a row. Anything
// else present -- 'unknown' from a failed probe, 'running', or a value a newer
// backend adds -- is an indefinite answer this stale bundle must not act on. An
// ABSENT field is a pre-regenOutcome backend, whose `generating` is the only
// signal there is, so it does not veto (same reading as useBgmRegenerate).
const SETTLED_BGM_REGEN_OUTCOMES: readonly BgmRemuxOutcome[] = [
  'completed',
  'failed',
  'not_started',
  'terminated',
]

export function upsertBgmActivityEntry(
  entries: BgmActivityEntries,
  entry: BgmActivityEntry,
  startsNewRun = false,
): BgmActivityEntries {
  const existing = startsNewRun ? undefined : entries[entry.projectId]
  const next: BgmActivityEntry = existing
    ? {
        ...entry,
        confirmedAt: existing.confirmedAt,
        kind: existing.kind,
        startedAt: existing.startedAt,
      }
    : entry
  if (
    existing &&
    existing.href === next.href &&
    existing.ownerId === next.ownerId &&
    existing.thumbnail === next.thumbnail &&
    existing.title === next.title
  ) {
    return entries
  }
  return { ...entries, [entry.projectId]: next }
}

function isIndefiniteBgmRegenOutcome(outcome?: string): boolean {
  if (outcome === undefined || outcome === null) {
    return false
  }
  return !SETTLED_BGM_REGEN_OUTCOMES.includes(outcome as BgmRemuxOutcome)
}
