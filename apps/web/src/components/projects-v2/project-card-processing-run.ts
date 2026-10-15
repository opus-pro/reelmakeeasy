import type { BgmRunState } from '@shared/types/api/project'

/**
 * Resolves what the card status pill should show for a project's
 * background jobs, from the persisted run/processingSeenAt contract
 * the list read already returns. Kind-keyed so each job type adds a label map
 * entry without touching the card; unknown kinds render nothing rather than
 * throwing.
 */

/**
 * A `running` record older than this is treated as stale and hidden: the regen
 * workflow's execution timeout is 30 minutes, and a hard terminate can leave
 * the record uncleared (the failure path clears best-effort only).
 */
export const PROCESSING_RUN_STALE_MS = 45 * 60 * 1000

export type ProcessingRunPill = {
  label: string
  variant: 'done' | 'progress'
}

/**
 * Whether a run is still plausibly in flight. Shared with the list poll so a
 * record left `running` by a hard terminate stops the 30s refetch at the same
 * ceiling that hides the pill, instead of polling for as long as the list is
 * mounted.
 */
export function isProcessingRunActive(run: BgmRunState | null | undefined, now: number): boolean {
  if (run?.status !== 'running') {
    return false
  }
  const startedAt = toEpoch(run.startedAt)
  return startedAt !== null && now - startedAt <= PROCESSING_RUN_STALE_MS
}

/**
 * What the resolver reads off a project. `processingSeenAt` is a Date on the
 * shared type but an ISO string once the list payload deserializes, so both
 * are accepted (Project satisfies this either way).
 */
export type ProcessingRunSource = {
  bgmRun?: BgmRunState | null
  processingSeenAt?: Date | null | string
}

/**
 * The BGM pill renders off a persisted `bgmRun` record, which only exists on a
 * project that actually ran BGM, so the data is the gate.
 */
export function useProcessingRunPill(project: ProcessingRunSource): null | ProcessingRunPill {
  return resolveProcessingRunPill(project, Date.now())
}

// Only a running change gets a pill, in plain words: a "done" tag after every music
// change was noise (the owner asked to drop it).
const BGM_LABELS: Record<BgmRunState['kind'], { done: null | string; running: string }> = {
  generate: { done: null, running: 'Making music' },
  regenerate: { done: null, running: 'Making music' },
}

/** The list payload carries timestamps as ISO strings; the shared type says Date. */
export function resolveProcessingRunPill(
  project: ProcessingRunSource,
  now: number,
): null | ProcessingRunPill {
  return resolveRunPill(project.bgmRun, BGM_LABELS, project.processingSeenAt, now)
}

function resolveRunPill(
  run: BgmRunState | null | undefined,
  labelsByKind: Record<string, { done: null | string; running: string }>,
  processingSeenAt: Date | null | string | undefined,
  now: number,
): null | ProcessingRunPill {
  if (!run) {
    return null
  }
  const labels = labelsByKind[run.kind]
  if (!labels) {
    return null
  }
  if (run.status === 'running') {
    return isProcessingRunActive(run, now) ? { label: labels.running, variant: 'progress' } : null
  }
  if (run.status !== 'done' || labels.done === null) {
    return null
  }
  const settledAt = toEpoch(run.settledAt)
  if (settledAt === null) {
    return null
  }
  const seenAt = toEpoch(processingSeenAt)
  if (seenAt !== null && seenAt >= settledAt) {
    return null
  }
  return { label: labels.done, variant: 'done' }
}

function toEpoch(value: Date | null | string | undefined): null | number {
  if (value === null || value === undefined) {
    return null
  }
  const epoch = new Date(value).getTime()
  return Number.isFinite(epoch) ? epoch : null
}
