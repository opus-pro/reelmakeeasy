import fs from 'node:fs'
import path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import type { SharedJobContext } from '@reelmakeeasy/common/job-context/type'
import { Logger } from '@reelmakeeasy/common/logger'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type ChatEndpointPreference,
  type ChatTransport,
  type ChatTransportResolver,
  LlmNotSetUpError,
  type LlmProviderName,
} from '@reelmakeeasy/llm'
import { activityStorage, workflowStorage } from '@reelmakeeasy/workflow-engine/engine'
import type { AgentHarnessName } from '@shared/types/api/agent'
import type { LlmProvider } from '@shared/types/api/setup'

/** Where the agent project ids are kept: `<dataDir()>/agent/codex-projects.json`. */
export function defaultCodexProjectsFile(): string {
  return path.join(dataDir(), 'agent', 'codex-projects.json')
}

/**
 * The persisted map of agent-mode projects to the harness whose chat made them: their pipeline
 * runs use that harness (Codex or Claude) for their LLM calls. Stored as `{ "<id>": "claude" }`;
 * the older array of ids reads as all Codex.
 */
export class AgentProjects {
  private readonly harnesses: Map<string, AgentHarnessName>
  private readonly warn: (message: string) => void

  constructor(
    private readonly file: string = defaultCodexProjectsFile(),
    opts: { warn?: (message: string) => void } = {},
  ) {
    const logger = new Logger(AgentProjects.name)
    this.warn = opts.warn ?? ((message) => logger.warn(message))
    this.harnesses = new Map(this.load())
  }

  /** Persists immediately. */
  add(projectId: string, harness: AgentHarnessName = 'codex'): void {
    if (this.harnesses.get(projectId) === harness) return
    this.harnesses.set(projectId, harness)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.harnesses)))
    fs.renameSync(tmp, this.file)
  }

  /** Every agent-mode project id. */
  all(): string[] {
    return [...this.harnesses.keys()]
  }

  /** The harness a project's LLM calls run on, or null for a project not made in agent mode. */
  harnessOf(projectId: string): AgentHarnessName | null {
    return this.harnesses.get(projectId) ?? null
  }

  has(projectId: string): boolean {
    return this.harnesses.has(projectId)
  }

  private load(): [string, AgentHarnessName][] {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return []
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed))
        return parsed
          .filter((id): id is string => typeof id === 'string')
          .map((id) => [id, 'codex'])
      if (!parsed || typeof parsed !== 'object') throw new Error('not a JSON object')
      return Object.entries(parsed).filter(
        (e): e is [string, AgentHarnessName] => e[1] === 'codex' || e[1] === 'claude',
      )
    } catch (error) {
      this.warn(
        `ignoring unreadable ${this.file} (${ensureError(error).message}); no project uses an agent harness`,
      )
      return []
    }
  }
}

function jobContextProjectId(): null | string {
  try {
    return JobContext.getByKey('projectId', null)
  } catch {
    return null // outside JobContext.run
  }
}

/** `ao:{projectId}:{domain}:...` -> projectId; null for any other shape. */
function projectIdOf(workflowId: string | undefined): null | string {
  if (!workflowId) return null
  const parts = workflowId.split(':')
  if (parts[0] !== 'ao' || parts.length < 3 || !parts[1]) return null
  return parts[1]
}

/** The project id of the LLM call in progress: JobContext.projectId if set, else parsed from
 *  the running activity's workflowId (`ao:{projectId}:...`), else from the running workflow
 *  body's (workflowStorage), else null. */
export function currentLlmProjectId(): null | string {
  return (
    jobContextProjectId() ||
    projectIdOf(activityStorage.getStore()?.info?.workflowExecution?.workflowId) ||
    projectIdOf(workflowStorage.getStore()?.execution.workflowId)
  )
}

/** Fails the type-check unless `T` is `true`. */
type Assert<T extends true> = T
/** True when A and B are the same type. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** The provider union is written out three times: `LlmProvider` (shared types), libs/llm's
 *  `LlmProviderName` and the JobContext pin. The API type-check fails here when they drift. */
export type LlmProviderUnionsMatch = Assert<Equals<LlmProvider, LlmProviderName>> &
  Assert<Equals<LlmProvider, NonNullable<SharedJobContext['llmProvider']>>>

/** The AI a call is pinned to with `JobContext.run({ llmProvider }, fn)`, or null. */
function jobContextLlmPin(): LlmProvider | null {
  try {
    return JobContext.getByKey('llmProvider', null)
  } catch {
    return null // outside JobContext.run
  }
}

/** What `makeLlmResolver` routes with. */
export interface LlmResolverDeps {
  /** The AI chosen in Setup and ready (`SetupSettingsService.currentLlm`), or null. */
  currentLlm: () => LlmProvider | null
  /** What a call fails with when no AI can take it (default: LLM_NOT_SET_UP_MESSAGE). */
  notSetUpMessage?: () => string
  projects: Pick<AgentProjects, 'harnessOf'>
  transports: Record<AgentHarnessName, ChatTransport>
}

/** Codex and Claude Code have a transport; Gemini and a custom endpoint use libs/llm's endpoint
 *  path (null), which `makeChatEndpointPreference` points at the right one. */
function transportFor(
  provider: LlmProvider,
  transports: Record<AgentHarnessName, ChatTransport>,
): ChatTransport | null {
  return provider === 'claude' || provider === 'codex' ? transports[provider] : null
}

/**
 * libs/llm's transport resolver. A call goes, in order:
 * 1. where `JobContext.llmProvider` pins it (audio calls pin Gemini on Codex and Claude Code);
 * 2. for an agent-mode project, to the harness whose chat made the project;
 * 3. otherwise to the AI chosen in Setup (`currentLlm`);
 * 4. with none ready, to a transport that fails with LlmNotSetUpError (never retried).
 */
export function makeLlmResolver(deps: LlmResolverDeps): ChatTransportResolver {
  const notSetUp: ChatTransport = {
    name: 'not-set-up',
    send: () => Promise.reject(new LlmNotSetUpError(deps.notSetUpMessage?.())),
  }
  return () => {
    const pinned = jobContextLlmPin()
    if (pinned) return transportFor(pinned, deps.transports)
    const projectId = currentLlmProjectId()
    const harness = projectId ? deps.projects.harnessOf(projectId) : null
    if (harness) return deps.transports[harness]
    const current = deps.currentLlm()
    return current ? transportFor(current, deps.transports) : notSetUp
  }
}

/**
 * libs/llm's chat endpoint preference, for the calls `makeLlmResolver` leaves on the endpoint
 * path: Gemini for a call pinned to it or when Gemini is chosen in Setup, the custom endpoint
 * when that is chosen, else none (the env decides, as before).
 */
export function makeChatEndpointPreference(
  currentLlm: () => LlmProvider | null,
): () => ChatEndpointPreference {
  return () => {
    const provider = jobContextLlmPin() ?? currentLlm()
    return provider === 'endpoint' || provider === 'gemini' ? provider : null
  }
}
