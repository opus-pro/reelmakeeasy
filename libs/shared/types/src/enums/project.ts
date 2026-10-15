/**
 * project stage is split into 3 stages:
 * 1. navigator agent: pre-execution
 * 2. director agent: execution
 * 3. editor agent: post-execution (use only limited tools)
 */
export const PROJECT_STAGE = {
  INITIALIZING: 'INITIALIZING',

  SCRIPT: 'SCRIPT',
  STORY_LOADER: 'STORY_LOADER',
  STORYBOARD: 'STORYBOARD',
  VIDEO_CREW: 'VIDEO_CREW',
  VIRAL_HOOK: 'VIRAL_HOOK',
  RESEARCHER: 'RESEARCHER',

  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED',

  // for 1.0, new added navigator agent and editor agent
  /** Navigator is a pre-director or pre-execution agent */
  NAVIGATOR: 'NAVIGATOR',
  /** Editor is a post-execution agent, must has a final video. */
  EDITOR: 'EDITOR',
  // UIP (User Intent Planner) -- planning stage before story-mode pipeline
  UIP_PLANNING: 'UIP_PLANNING',

  // for motion graphics projects for now
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const

export enum ProjectInputType {
  A2V = 'Video',
  S2V = 'Story Mode',
}

export const isTerminalStage = (
  stage?: (typeof PROJECT_STAGE)[keyof typeof PROJECT_STAGE],
): boolean => {
  return (
    stage === PROJECT_STAGE.FINISHED ||
    stage === PROJECT_STAGE.EDITOR ||
    stage === PROJECT_STAGE.CANCELED
  )
}

/**
 * Age past which a non-terminal project with no result video is considered
 * permanently stuck. Must exceed every legitimate run length: the
 * longest is the 3-day queued-workflow admission ceiling, so 96h clears it
 * with a day of margin.
 */
export const STALE_IN_PROGRESS_THRESHOLD_MS = 96 * 60 * 60 * 1000

/** Stages that need no staleness guard: the project is settled or deliberately idle. */
const SETTLED_PROJECT_STAGES: ReadonlySet<string> = new Set([
  PROJECT_STAGE.CANCELED,
  PROJECT_STAGE.EDITOR,
  PROJECT_STAGE.FAILED,
  PROJECT_STAGE.FINISHED,
  PROJECT_STAGE.PAUSED,
])

/**
 * True when the project's stage is settled or deliberately idle -- nothing is
 * advancing it, so no surface should treat it as work in flight. An UNKNOWN
 * stage is not settled, matching the DB-side `stage notIn terminal` filters.
 */
export function isSettledProjectStage(stage?: null | string): boolean {
  return Boolean(stage) && SETTLED_PROJECT_STAGES.has(stage as string)
}

/**
 * True when a project can no longer legitimately be in progress: non-settled
 * stage, no result video, and older than STALE_IN_PROGRESS_THRESHOLD_MS.
 * Display surfaces treat such projects as failed instead of generating forever.
 * A missing stage counts as in-progress, matching the DB-side
 * `stage notIn terminal` filters.
 */
export function isStaleInProgressProject(
  project: {
    createdAt?: Date | null | string
    resultVideo?: null | string
    stage?: null | string
  },
  nowMs: number = Date.now(),
): boolean {
  if (!project.createdAt || project.resultVideo) {
    return false
  }
  if (isSettledProjectStage(project.stage)) {
    return false
  }
  const createdAtMs = new Date(project.createdAt).getTime()
  if (Number.isNaN(createdAtMs)) {
    return false
  }
  return nowMs - createdAtMs >= STALE_IN_PROGRESS_THRESHOLD_MS
}
