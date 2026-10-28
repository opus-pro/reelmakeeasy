import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  AgentHarnessName,
  ChatModelChoice,
  ChatModelOption,
  ChatModelState,
} from '@shared/types/api/agent'

import { loadSdk } from './claude/claude-app-server'
import { scrubClaudeEnv } from './claude/claude-config'
import { resolveClaudeBinaryOrThrow } from './claude/claude-locator'
import { buildAppServerArgs, scrubCodexEnv } from './codex/codex-config'
import { ensureAgentCodexHome } from './codex/codex-home'
import { resolveCodexBinaryOrThrow } from './codex/codex-locator'
import { CodexRpcClient } from './codex/codex-rpc'
import {
  type ChatModelCatalog,
  chatModelState,
  isMotionModel,
  motionModelChoice,
  motionModelGate,
  motionOption,
  usableChoice,
} from './chat-models'

const logger = new Logger('ChatModelService')

/** How long a harness's model list is trusted before it's asked again. */
const CATALOG_TTL_MS = 10 * 60_000
/** A harness that doesn't answer in time has no list this time (asked again next time). */
const PROBE_TIMEOUT_MS = 30_000

export interface ChatModelDeps {
  /** Asks a harness for its models and plan (default: Codex's app-server, Claude Code's SDK). */
  probe?: (harness: AgentHarnessName) => Promise<ChatModelCatalog>
  /** Where `chat-models.json` (the saved defaults) lives. */
  root?: string
  ttlMs?: number
}

type SavedDefaults = Partial<Record<AgentHarnessName, ChatModelChoice>>

/** A model as Codex's `model/list` describes it (the fields used here). */
interface CodexModel {
  defaultReasoningEffort?: string
  displayName?: string
  hidden?: boolean
  id: string
  supportedReasoningEfforts?: { reasoningEffort: string }[]
}

/** Why a Claude Animation can't run on another agent. */
export const ANIMATION_CLAUDE_ONLY = 'Claude Animation runs only on Claude Code.'

/**
 * The models agent chats can run on: each harness's list (asked once and kept for a while),
 * the default saved for it, and the recommended one (see chat-models.ts).
 */
export class ChatModelService {
  private readonly cache = new Map<
    AgentHarnessName,
    { at: number; catalog: ChatModelCatalog | null; pending?: Promise<ChatModelCatalog | null> }
  >()
  private readonly file: string
  private readonly probe: (harness: AgentHarnessName) => Promise<ChatModelCatalog>
  private readonly ttlMs: number

  constructor(deps: ChatModelDeps = {}) {
    this.file = path.join(deps.root ?? path.join(dataDir(), 'agent'), 'chat-models.json')
    this.probe = deps.probe ?? probeHarness
    this.ttlMs = deps.ttlMs ?? CATALOG_TTL_MS
  }

  /** The harness's models, asked again when older than the TTL (or `refresh`); null when the
   *  harness can't say (not installed, signed out, too slow). */
  async catalog(
    harness: AgentHarnessName,
    opts: { refresh?: boolean } = {},
  ): Promise<ChatModelCatalog | null> {
    const hit = this.cache.get(harness)
    if (hit?.pending) return hit.pending
    if (hit && !opts.refresh && Date.now() - hit.at < this.ttlMs) return hit.catalog
    const pending = withTimeout(this.probe(harness), PROBE_TIMEOUT_MS)
      .then((catalog) => {
        this.cache.set(harness, { at: Date.now(), catalog })
        return catalog
      })
      .catch((error: unknown) => {
        logger.warn(`Couldn't list ${harness}'s models: ${ensureError(error).message}`)
        this.cache.set(harness, { at: Date.now(), catalog: null })
        return null
      })
    this.cache.set(harness, { at: hit?.at ?? 0, catalog: hit?.catalog ?? null, pending })
    return pending
  }

  /** The model a chat's turn runs on, from what is known now (a turn never waits for the
   *  list): picked for the chat, else the saved default, else the recommended one; null leaves
   *  the harness's own default. A missing list is asked for in the background. */
  choiceFor(harness: AgentHarnessName, chat?: ChatModelChoice): ChatModelChoice | null {
    const hit = this.cache.get(harness)
    if (!hit || Date.now() - hit.at >= this.ttlMs) void this.catalog(harness)
    return chatModelState({
      catalog: hit?.catalog ?? null,
      chat,
      harness,
      saved: this.saved(harness),
    }).current
  }

  /** A Motion Reel or Claude Animation chat's model (its family's newest; see
   *  `motionModelChoice`), from what is known now: picked for the chat, else the recommended
   *  level (the saved default is for other chats). While the list is unknown, the usual choice
   *  (the gate already checked it). */
  motionChoiceFor(harness: AgentHarnessName, chat?: ChatModelChoice): ChatModelChoice | null {
    const models = this.cache.get(harness)?.catalog?.models ?? []
    if (!models.length) return this.choiceFor(harness, chat)
    return motionModelChoice(harness, models, chat)
  }

  /** Why this account can't run a Motion Reel on `harness`, or null when it can (or the
   *  harness can't list its models: it is then not refused for being slow). */
  async motionGate(harness: AgentHarnessName): Promise<null | string> {
    const models = (await this.catalog(harness))?.models ?? []
    return models.length ? motionModelGate(harness, models) : null
  }

  /** Why this account can't run a Claude Animation on `harness`, or null when it can: Claude Code
   *  only, on the model a Motion Reel needs (Opus). */
  async animationGate(harness: AgentHarnessName): Promise<null | string> {
    if (harness !== 'claude') return ANIMATION_CLAUDE_ONLY
    const gate = await this.motionGate(harness)
    return gate && gate.replace(/^Motion Reel/, 'Claude Animation')
  }

  /** Whether `choice` may run a Motion Reel chat on `harness` (true while the list is unknown). */
  async motionOffers(harness: AgentHarnessName, choice: ChatModelChoice): Promise<boolean> {
    const models = (await this.catalog(harness))?.models ?? []
    if (!models.length) return true
    return isMotionModel(harness, models, choice.model) && (await this.offers(harness, choice))
  }

  /** `GET .../model` for a Motion Reel or Claude Animation chat: only the allowed model is
   *  offered (its levels from medium up), at the level picked for the chat, else the
   *  recommended one. */
  async motionState(harness: AgentHarnessName, chat?: ChatModelChoice): Promise<ChatModelState> {
    const state = await this.state(harness, chat)
    if (!state.models.length) return state
    const current = motionModelChoice(harness, state.models, chat)
    return {
      ...state,
      current,
      models: state.models.filter((m) => m.id === current?.model).map(motionOption),
      recommended: motionModelChoice(harness, state.models),
      source: chat ? 'chat' : 'recommended',
    }
  }

  /** Whether `choice` is a model (and thinking level) the harness offers; true while its list
   *  is unknown, so a pick isn't refused for a slow harness. */
  async offers(harness: AgentHarnessName, choice: ChatModelChoice): Promise<boolean> {
    const models: ChatModelOption[] = (await this.catalog(harness))?.models ?? []
    if (!models.length) return true
    const usable = usableChoice(choice, models)
    return usable !== null && usable.effort === choice.effort
  }

  saved(harness: AgentHarnessName): ChatModelChoice | undefined {
    return this.readDefaults()[harness]
  }

  /** Saves (or with null, clears) the default model for a harness's chats. */
  setDefault(harness: AgentHarnessName, choice: ChatModelChoice | null): void {
    const next = { ...this.readDefaults() }
    if (choice) next[harness] = choice
    else delete next[harness]
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    fs.renameSync(tmp, this.file)
  }

  /** What `GET /api/agent/sessions/:id/model` answers for a chat on `harness`. */
  async state(
    harness: AgentHarnessName,
    chat?: ChatModelChoice,
    opts: { refresh?: boolean } = {},
  ): Promise<ChatModelState> {
    const catalog = await this.catalog(harness, opts)
    return chatModelState({ catalog, chat, harness, saved: this.saved(harness) })
  }

  private readDefaults(): SavedDefaults {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      const out: SavedDefaults = {}
      for (const harness of ['claude', 'codex'] as const) {
        const entry = (parsed as Record<string, unknown>)[harness] as
          | Record<string, unknown>
          | undefined
        if (entry && typeof entry['model'] === 'string')
          out[harness] = {
            ...(typeof entry['effort'] === 'string' ? { effort: entry['effort'] } : {}),
            model: entry['model'],
          }
      }
      return out
    } catch {
      return {}
    }
  }
}

function probeHarness(harness: AgentHarnessName): Promise<ChatModelCatalog> {
  return harness === 'claude' ? probeClaude() : probeCodex()
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(ensureError(error))
      },
    )
  })
}

/** A row of Claude Code's model list (the fields used here). */
interface ClaudeModelInfo {
  displayName: string
  resolvedModel?: string
  supportedEffortLevels?: string[]
  value: string
}

/** Codex's own lists: `account/read` for the plan, `model/list` for the models it shows. */
async function probeCodex(): Promise<ChatModelCatalog> {
  const binary = await resolveCodexBinaryOrThrow()
  const home = ensureAgentCodexHome({ warn: (msg) => logger.warn(msg) })
  const client = CodexRpcClient.spawn(binary, buildAppServerArgs({ webSearch: false }), {
    cwd: os.tmpdir(),
    env: { ...scrubCodexEnv(process.env), CODEX_HOME: home },
  })
  try {
    await client.request('initialize', {
      capabilities: null,
      clientInfo: { name: 'reelmakeeasy', title: 'ReelMakeEasy', version: '1' },
    })
    client.notify('initialized')
    const account = await client
      .request<{ account?: null | { planType?: string } }>('account/read', { refreshToken: false })
      .catch(() => null)
    const list = await client.request<{ data?: CodexModel[] }>('model/list', {})
    const models = (list.data ?? [])
      .filter((m) => !m.hidden)
      .map((m) => ({
        ...(m.defaultReasoningEffort ? { defaultEffort: m.defaultReasoningEffort } : {}),
        efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
        id: m.id,
        label: m.displayName || m.id,
      }))
    const plan = account?.account?.planType
    return { models, ...(plan ? { plan } : {}) }
  } finally {
    client.close()
  }
}

/** The plan, when the harness names one. */
function planOf(plan: string | undefined): { plan?: string } {
  return plan ? { plan } : {}
}

/** Claude Code's models and plan, from an SDK session that never sends a prompt. */
async function probeClaude(): Promise<ChatModelCatalog> {
  const binary = await resolveClaudeBinaryOrThrow()
  const { query } = await loadSdk()
  let release = (): void => undefined
  // A prompt that never sends a message: the session only answers the two questions below.
  const prompt = (async function* () {
    await new Promise<void>((resolve) => (release = resolve))
    yield* []
  })()
  const q = query({
    options: {
      cwd: os.tmpdir(),
      env: scrubClaudeEnv(process.env),
      pathToClaudeCodeExecutable: binary,
    },
    prompt: prompt as never,
  })
  try {
    const [account, rows] = await Promise.all([q.accountInfo(), q.supportedModels()])
    return { models: claudeModels(rows as ClaudeModelInfo[]), ...planOf(account.subscriptionType) }
  } finally {
    release()
    q.close()
  }
}

/** Claude Code's model rows, one per model: aliases (`opus`, `default`) folded into the
 *  model they stand for, named by the alias's friendlier name. */
export function claudeModels(rows: ClaudeModelInfo[]): ChatModelOption[] {
  const byId = new Map<string, ChatModelOption>()
  for (const row of rows) {
    if (row.value === 'default') continue
    const id = row.resolvedModel ?? row.value
    if (byId.has(id)) continue
    byId.set(id, { efforts: row.supportedEffortLevels ?? [], id, label: row.displayName })
  }
  return [...byId.values()]
}
