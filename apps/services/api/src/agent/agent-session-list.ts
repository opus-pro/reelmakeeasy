import {
  DEFAULT_CHAT_TITLE,
  isUnsetChatTitle,
  sortSessionsByActivity,
} from '@reelmakeeasy/common/codex-agent/agent-sessions'
import type {
  AgentSession,
  AgentSessionListItem,
  AgentSessionProject,
} from '@shared/types/api/agent'

import type { AgentProjectSummaryRow } from '../projects/agent-project-fields'
import { normalizeProjectListMediaUrl } from '../projects/projects-list.util'

function projectOf(
  projectId: null | string,
  rows: Map<string, AgentProjectSummaryRow>,
): AgentSessionProject | null {
  if (!projectId) return null
  const row = rows.get(projectId)
  if (!row)
    return {
      createdAt: null,
      deleted: true,
      hasResultVideo: false,
      id: projectId,
      name: '',
      stage: null,
      thumbnail: null,
    }
  // Same normalization the Projects list applies (a store:// address served as a URL), so a
  // sidebar thumbnail doesn't hand the browser an address it can't fetch.
  const thumbnail =
    normalizeProjectListMediaUrl(row.previewThumbnail) ||
    normalizeProjectListMediaUrl(row.resultVideoThumbnail) ||
    normalizeProjectListMediaUrl(row.styleThumbnailUrl) ||
    null
  return {
    createdAt: row.createdAt.toISOString(),
    deleted: Boolean(row.isDeleted),
    hasResultVideo: Boolean(row.resultVideo),
    id: row.id,
    name: row.name,
    stage: row.stage,
    thumbnail,
  }
}

/** The agent chat list: each chat with its project joined in, newest activity first. A row
 *  with a live project is named after the project, so a rename anywhere shows here.
 *
 *  `rows: null` means the project lookup itself failed (not that no projects exist): every
 *  row gets `project: null` rather than the "deleted" shape `projectOf` gives a genuinely
 *  missing id -- a DB hiccup must not make a live project look deleted. */
export function buildAgentSessionList(
  sessions: AgentSession[],
  rows: AgentProjectSummaryRow[] | null,
): AgentSessionListItem[] {
  const byId = rows ? new Map(rows.map((r) => [r.id, r])) : null
  return sortSessionsByActivity(
    sessions.map((s): AgentSessionListItem => {
      const project = byId ? projectOf(s.projectId, byId) : null
      const liveProjectName = project && !project.deleted && project.name ? project.name : null
      return {
        createdAt: s.createdAt,
        flowActive: Boolean(s.flowActive),
        id: s.id,
        mode: s.mode ?? null,
        project,
        status: s.status,
        // A legacy/unset chat title ("Untitled video", or unset) shows as "New chat" here
        // without touching what's stored -- see isUnsetChatTitle.
        title: liveProjectName ?? (isUnsetChatTitle(s.title) ? DEFAULT_CHAT_TITLE : s.title),
        updatedAt: s.updatedAt || s.createdAt,
      }
    }),
  )
}
