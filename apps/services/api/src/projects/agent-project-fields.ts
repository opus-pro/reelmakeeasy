import type { PrismaClient } from '@reelmakeeasy/api-db'
import { PROJECT_CREATED_VIA_AGENT } from '@reelmakeeasy/common/codex-agent/agent-sessions'

/** A project as the agent chat list needs it. */
export type AgentProjectSummaryRow = {
  createdAt: Date
  id: string
  isDeleted: boolean | null
  name: string
  previewThumbnail: null | string
  resultVideo: null | string
  resultVideoThumbnail: null | string
  stage: null | string
  styleThumbnailUrl: null | string
}

export const AGENT_PROJECT_SUMMARY_SELECT = {
  createdAt: true,
  id: true,
  isDeleted: true,
  name: true,
  previewThumbnail: true,
  resultVideo: true,
  resultVideoThumbnail: true,
  stage: true,
  styleThumbnailUrl: true,
} as const

/** The create data that marks a project as made by agent chat `agentSessionId`. Set only by
 *  the server (`createProject`'s options), never from a request body. */
export function agentProjectFields(agentSessionId: string | undefined): {
  agentSessionId?: string
  createdVia?: string
} {
  return agentSessionId ? { agentSessionId, createdVia: PROJECT_CREATED_VIA_AGENT } : {}
}

/** Prisma on MongoDB: `{ field: null }` does not match a document without the field, and
 *  projects made before these fields existed have neither. */
export function unsetOrNull<K extends 'agentSessionId' | 'createdVia'>(field: K) {
  return { OR: [{ [field]: null }, { [field]: { isSet: false } }] } as {
    OR: [Record<K, null>, Record<K, { isSet: false }>]
  }
}

/** One-time fill for agent projects made before the fields existed. Writes only fields that
 *  are not set, so running it again changes nothing. Returns the number of rows changed. */
export async function fillAgentFields(
  prisma: Pick<PrismaClient, 'project'>,
  input: { agentProjectIds: string[]; sessionByProject: Map<string, string> },
): Promise<number> {
  let changed = 0
  if (input.agentProjectIds.length) {
    const { count } = await prisma.project.updateMany({
      data: { createdVia: PROJECT_CREATED_VIA_AGENT },
      where: { AND: [{ id: { in: input.agentProjectIds } }, unsetOrNull('createdVia')] },
    })
    changed += count
  }
  for (const [projectId, sessionId] of input.sessionByProject) {
    const { count } = await prisma.project.updateMany({
      data: { agentSessionId: sessionId },
      where: { AND: [{ id: projectId }, unsetOrNull('agentSessionId')] },
    })
    changed += count
  }
  return changed
}
