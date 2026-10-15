import { Project } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'

// The timestamp when the ongoing-notification feature was launched.
// Stored in localStorage under FEATURE_LAUNCH_STORAGE_KEY so it is visible
// and can be manually overridden (e.g. for debugging). Only applied as a
// baseline when the localStorage value is non-empty - clear it to disable.
const FEATURE_LAUNCH_TIME = new Date('2026-03-17T00:00:00.000Z').getTime()
const FEATURE_LAUNCH_STORAGE_KEY = 'reelmakeeasy:ongoing-notification:feature-launch-time'
const ONGOING_PROJECTS_NOTIFICATION_ENABLED_STORAGE_KEY =
  'reelmakeeasy:feature:enable_ongoing_projects_notification'
const ONGOING_CONNECTED_FALLBACK_POLLING_STORAGE_KEY =
  'reelmakeeasy:feature:enable_ongoing_projects_notification_connected_fallback_polling'

// Module-level cache - reset on every page refresh (module reload).
let _cachedBaseline: number | undefined

export function getConnectedFallbackPollingEnabled(): boolean {
  const raw = getLocalStorage()?.getItem(ONGOING_CONNECTED_FALLBACK_POLLING_STORAGE_KEY) ?? null
  return parseStoredBoolean(raw) ?? false
}

export function getCreatedFromBaseline(): number {
  return _cachedBaseline ?? (_cachedBaseline = _computeCreatedFromBaseline())
}

export function getOngoingNotificationEnabled(): boolean | null {
  const raw = getLocalStorage()?.getItem(ONGOING_PROJECTS_NOTIFICATION_ENABLED_STORAGE_KEY) ?? null
  return parseStoredBoolean(raw)
}

export function isOngoingProject(project: Pick<Project, 'stage'>): boolean {
  const stage = project.stage

  return (
    stage !== PROJECT_STAGE.CANCELED &&
    stage !== PROJECT_STAGE.EDITOR &&
    stage !== PROJECT_STAGE.FAILED &&
    stage !== PROJECT_STAGE.FINISHED
  )
}

/** Row label for a project, shared by the project rows and the BGM job rows. */
export function resolveProjectTitle(project: Pick<Project, 'initPrompt' | 'name'>): string {
  return project.name?.trim() || project.initPrompt?.trim() || 'Untitled Project'
}

export function toGlobalProjectId(source: string, id: string): string {
  return `${source}:${id}`
}

function _computeCreatedFromBaseline(): number {
  // Previous natural month: first day at midnight in the local browser timezone
  const now = new Date()
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0).getTime()
  const storage = getLocalStorage()

  if (!storage) {
    return prevMonthStart
  }

  // Sync the hardcoded launch time to localStorage on first run so it is
  // discoverable and manually overridable.
  if (!storage.getItem(FEATURE_LAUNCH_STORAGE_KEY)) {
    storage.setItem(FEATURE_LAUNCH_STORAGE_KEY, new Date(FEATURE_LAUNCH_TIME).toISOString())
  }

  // Only inject the feature launch time when localStorage value is non-empty.
  const stored = storage.getItem(FEATURE_LAUNCH_STORAGE_KEY)
  const featureLaunchTime = stored ? new Date(stored).getTime() : null

  // Use the later of feature launch time and previous month start.
  return featureLaunchTime === null ? prevMonthStart : Math.max(featureLaunchTime, prevMonthStart)
}

function getLocalStorage(): null | Storage {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage ?? null
}

function parseStoredBoolean(raw: null | string): boolean | null {
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  return null
}

/**
 * Folds the local job rows (BGM) into the server's project totals
 * for the collapsed activity chip.
 *
 * Every job row counts toward the total, but only the rows still RUNNING count
 * as ongoing. Counting finished ones left the chip stuck on "Generating... 0/1"
 * after a job finished, while the expanded row already read complete.
 *
 * A pure function rather than an expression inside the component's JSX so the
 * rule is testable on its own: the view takes both totals as props, so a view
 * test cannot tell a correct roll-up from a broken one.
 */
export function resolveJobRollupTotals(
  jobItems: Pick<OngoingProjectsNotificationItem, 'status'>[],
  serverAllTotal: number,
  serverOngoingTotal: number,
): { allTotal: number; ongoingTotal: number } {
  const ongoingJobs = jobItems.filter((item) => item.status === 'generating').length
  return {
    allTotal: serverAllTotal + jobItems.length,
    ongoingTotal: serverOngoingTotal + ongoingJobs,
  }
}
