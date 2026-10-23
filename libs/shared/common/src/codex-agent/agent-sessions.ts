import type { AgentMode, AgentSessionListItem } from '@shared/types/api/agent'
import {
  isSettledProjectStage,
  isStaleInProgressProject,
  PROJECT_STAGE,
} from '@shared/types/enums/project'

/** The title a new agent chat starts with, until a rule below names it. */
export const DEFAULT_CHAT_TITLE = 'New chat'
export const CHAT_TITLE_MAX = 60
/** `Project.createdVia` for projects agent mode made. */
export const PROJECT_CREATED_VIA_AGENT = 'agent'

/** The welcome card's names for the modes. */
export const AGENT_MODE_LABEL: Record<AgentMode, string> = {
  autonomous: 'Easy',
  free: 'Advanced',
  motion: 'Motion Reel (Easy)',
  motion_free: 'Motion Reel',
  ranking: 'Ranking',
  ranking_easy: 'Ranking (Easy)',
}

export type SessionRowMenu = {
  /** Enabled (false while the flow is setting up the video, or Codex is working). */
  deleteChat: boolean
  /** Shown whenever the row has a live (non-deleted) project. */
  deleteProject: boolean
  /** Disabled (with a tooltip) while the video is still generating, except for a
   *  settled stage (PAUSED and the like) -- see ProjectCardMenuItems.tsx's buildLastMenuItem
   *  for the same exemption on the Projects page card. */
  deleteProjectBlocked: boolean
  download: boolean
  openInEditor: boolean
  renameProject: boolean
}

export type SessionRowStatus =
  | { kind: 'deleted' }
  | { kind: 'done' }
  | { kind: 'failed' }
  | { kind: 'generating' }
  | { kind: 'none' }

/** A mode as saved on disk, as a mode the app has now. Guided mode was removed: a chat saved
 *  with it keeps its history and carries on as Free chat. Anything else unknown is no mode. */
export function agentModeFromStored(mode: unknown): AgentMode | undefined {
  if (mode === 'guided') return 'free'
  return mode === 'autonomous' ||
    mode === 'free' ||
    mode === 'motion' ||
    mode === 'motion_free' ||
    mode === 'ranking' ||
    mode === 'ranking_easy'
    ? mode
    : undefined
}

/** Titles that mean "not named yet": the default, and the one chats got before it. */
const UNSET_TITLES = new Set([DEFAULT_CHAT_TITLE, 'Untitled video'])

export function isUnsetChatTitle(title: null | string | undefined): boolean {
  const trimmed = title?.trim()
  return !trimmed || UNSET_TITLES.has(trimmed)
}

/** A chat title from free text: whitespace flattened, at most 60 characters, cut at a word
 *  boundary (or hard, for one long word) with an ellipsis. */
export function chatTitleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= CHAT_TITLE_MAX) return flat
  const cut = flat.slice(0, CHAT_TITLE_MAX - 1)
  const space = cut.lastIndexOf(' ')
  const head = space > CHAT_TITLE_MAX / 2 ? cut.slice(0, space) : cut
  return `${head.trimEnd()}…`
}

const activity = (i: { createdAt: string; updatedAt?: string }) =>
  Date.parse(i.updatedAt || i.createdAt) || 0

/** Newest activity first (`updatedAt`, else `createdAt`), then by id for a stable order. */
export function sessionRowMenu(item: AgentSessionListItem): SessionRowMenu {
  const status = sessionRowStatus(item)
  // Independent of `status.kind`: a settled stage like PAUSED reports `none` (nothing to poll
  // or show a pill for) but its project is still live and its actions still apply.
  const live = Boolean(item.project) && !item.project?.deleted
  return {
    deleteChat: !item.flowActive && item.status !== 'running',
    deleteProject: live,
    deleteProjectBlocked:
      status.kind === 'generating' && !isSettledProjectStage(item.project?.stage),
    download: status.kind === 'done',
    openInEditor: live,
    renameProject: live,
  }
}

export function sessionRowStatus(item: AgentSessionListItem): SessionRowStatus {
  const { project } = item
  if (!project) return { kind: 'none' }
  if (project.deleted) return { kind: 'deleted' }
  if (
    project.hasResultVideo ||
    project.stage === PROJECT_STAGE.FINISHED ||
    project.stage === PROJECT_STAGE.EDITOR
  )
    return { kind: 'done' }
  if (project.stage === PROJECT_STAGE.FAILED || project.stage === PROJECT_STAGE.CANCELED)
    return { kind: 'failed' }
  // Settled but not done/failed (PAUSED): nothing is advancing it, so it is not "generating" --
  // without this, the row (and the list's 10s poll) would spin forever.
  if (isSettledProjectStage(project.stage)) return { kind: 'none' }
  // A project orphaned by an API restart (non-settled stage, no video, stuck past the
  // staleness threshold): treat it as failed instead of generating forever.
  if (
    isStaleInProgressProject({
      createdAt: project.createdAt,
      resultVideo: null,
      stage: project.stage,
    })
  )
    return { kind: 'failed' }
  return { kind: 'generating' }
}

export function sortSessionsByActivity<
  T extends { createdAt: string; id: string; updatedAt?: string },
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id))
}

/** Hides rows whose mode was never chosen (an Agent-button press that never became a real
 *  chat), except the one that is currently open -- it must stay visible to navigate away from. */
export function visibleSessions(
  items: readonly AgentSessionListItem[],
  activeId: null | string,
): AgentSessionListItem[] {
  return items.filter((item) => item.mode !== null || item.id === activeId)
}
