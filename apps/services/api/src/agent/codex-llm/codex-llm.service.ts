import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import type { ChatTransport, ChatTransportRequest, ChatTransportResponse } from '@reelmakeeasy/llm'
import { Injectable, type OnModuleDestroy, Optional } from '@nestjs/common'

import { NO_SHELL_ARGS, scrubCodexEnv } from '../codex/codex-config'
import { agentCodexHome, ensureAgentCodexHome } from '../codex/codex-home'
import { resolveCodexBinaryOrThrow } from '../codex/codex-locator'
import { CodexRpcClient } from '../codex/codex-rpc'
import { Semaphore } from '../semaphore'

import { type CodexInputItem, type CodexTurnInput, toCodexTurnInput } from './codex-chat-input'
import { strictifySchema, stripNulls } from './strict-schema'

export interface CodexLlmDeps {
  /** How long the child may sit with no call in flight before it is closed (default
   *  `LLM_IDLE_MS`); the next call spawns a fresh one. */
  idleMs?: number
  /** Calls running at once on the shared app-server (default 3); the rest wait their turn. */
  maxConcurrent?: number
  /** Calls a child serves before it is retired for a fresh one (default 200). */
  recycleAfterCalls?: number
  spawnCodex?: (cwd: string) => Promise<CodexRpcClient>
  /** The threads' cwd (default `<dataDir()>/agent/llm-work`). */
  workDir?: string
}

const DEFAULT_MAX_CONCURRENT = 3
/** An idle child is closed after this long: a video's LLM calls come in bursts, and an
 *  app-server left running between videos only holds memory. */
export const LLM_IDLE_MS = 10 * 60 * 1000
/** Every ephemeral thread stays in its app-server's memory, so a child is replaced after
 *  this many calls: new calls go to a fresh child, the old one closes once it is idle. */
const RECYCLE_AFTER_CALLS = 200
const SCHEMA_HINT = '\n\nReply with only JSON matching this schema:\n'
const logger = new Logger('CodexLlmService')

type TurnResult = { error?: string; status: string; text: string }

/** An app-server, the call waiting on each of its threads, and its call counts. */
type Live = {
  client: CodexRpcClient
  /** Calls that have finished on this child, whatever their outcome. */
  finished: number
  /** Runs while the current child has no call in flight; closes it when it fires. */
  idleTimer?: NodeJS.Timeout
  inFlight: number
  /** No new calls; closed once `inFlight` reaches 0. */
  retired: boolean
  waiters: Map<string, TurnWaiter>
}

/** Waits for one thread's turn: its agent messages, then its `turn/completed`. */
type TurnWaiter = {
  reject: (error: Error) => void
  resolve: (turn: { error?: null | { message?: string }; status?: string }) => void
  texts: string[]
}

class CodexLlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`codex llm timed out after ${Number((timeoutMs / 1000).toFixed(1))}s`)
  }
}

/**
 * The argv and env of the pipeline's app-server. Unlike an agent session it can't ask the
 * user anything (no `default_mode_request_user_input`), streams no reasoning summaries,
 * never searches the web and has no shell tool (its calls only ever need text back). The env is scrubbed of ReelMakeEasy's secrets and points at the
 * agent sessions' isolated Codex home.
 */
export function llmAppServerSpawnSpec(env: NodeJS.ProcessEnv): {
  args: string[]
  env: NodeJS.ProcessEnv
} {
  return {
    args: [
      'app-server',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      ...NO_SHELL_ARGS,
      '-c',
      'web_search="disabled"',
      '-c',
      'model_reasoning_summary="none"',
    ],
    env: { ...scrubCodexEnv(env), CODEX_HOME: agentCodexHome() },
  }
}

async function spawnLlmCodex(cwd: string): Promise<CodexRpcClient> {
  const binary = await resolveCodexBinaryOrThrow()
  ensureAgentCodexHome({ warn: (msg) => logger.warn(msg) })
  const { args, env } = llmAppServerSpawnSpec(process.env)
  return CodexRpcClient.spawn(binary, args, { cwd, env })
}

/** The user text with the schema appended, for a retry without `outputSchema`. */
function withSchemaHint(
  input: CodexInputItem[],
  schema: Record<string, unknown>,
): CodexInputItem[] {
  const hint = SCHEMA_HINT + JSON.stringify(schema)
  const last = input.map((item) => item.type).lastIndexOf('text')
  if (last === -1) return [...input, { text: hint.trimStart(), type: 'text' }]
  return input.map((item, i) =>
    i === last && item.type === 'text' ? { text: item.text + hint, type: 'text' } : item,
  )
}

/** A structured reply with the strict-mode nulls removed, or the raw text if it isn't JSON
 *  (libs/llm's `parseStructured` then repairs or rejects it). */
function structuredContent(text: string, schema: Record<string, unknown>): string {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  try {
    return JSON.stringify(stripNulls(JSON.parse(unfenced), schema))
  } catch {
    return text
  }
}

/**
 * Runs the video pipeline's LLM calls (libs/llm chat requests) on the user's Codex, for
 * agent-mode projects. One `codex app-server` (spawned on first use, respawned after it
 * exits) serves every call; each call is a fresh ephemeral read-only thread with one turn.
 * Structured requests get a strict `outputSchema`; if Codex rejects it, the call is retried
 * once without it, the schema then spelled out in the prompt.
 *
 * Calls share the child: one request it leaves unanswered (30 s RPC timeout) kills it and
 * fails every sibling call in flight, up to `maxConcurrent`. A child with no call in flight
 * for `idleMs` is closed; the next call spawns a new one.
 */
@Injectable()
export class CodexLlmService implements OnModuleDestroy {
  readonly transport: ChatTransport = {
    name: 'codex',
    send: (request, timeoutMs) => this.send(request, timeoutMs),
  }
  private current: Live | null = null
  private destroyed = false
  private readonly idleMs: number
  private readonly recycleAfterCalls: number
  /** Retired children still finishing their calls. */
  private readonly retiring = new Set<Live>()
  private readonly semaphore: Semaphore
  private readonly spawnCodex: (cwd: string) => Promise<CodexRpcClient>
  private starting: null | Promise<Live> = null
  private readonly workDir: string

  constructor(@Optional() deps?: CodexLlmDeps) {
    this.idleMs = deps?.idleMs ?? LLM_IDLE_MS
    this.recycleAfterCalls = deps?.recycleAfterCalls ?? RECYCLE_AFTER_CALLS
    this.semaphore = new Semaphore(deps?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)
    this.spawnCodex = deps?.spawnCodex ?? spawnLlmCodex
    this.workDir = deps?.workDir ?? path.join(dataDir(), 'agent', 'llm-work')
  }

  onModuleDestroy(): void {
    this.destroyed = true
    clearTimeout(this.current?.idleTimer)
    this.current?.client.close()
    this.current = null
    for (const live of this.retiring) live.client.close()
    this.retiring.clear()
  }

  /** A live child with this call counted in its `inFlight`, claimed in the same tick it is
   *  picked so a sibling call finishing meanwhile can't retire and close it under us. */
  private async acquireLive(): Promise<Live> {
    for (;;) {
      const live = this.current ?? (await this.ensureLive())
      if (live.retired) continue
      clearTimeout(live.idleTimer)
      live.inFlight++
      return live
    }
  }

  /** Starts the idle clock once the current child has nothing in flight: when it runs out the
   *  child is closed (and forgotten), so the next call spawns a fresh one. */
  private armIdle(live: Live): void {
    if (this.current !== live || live.inFlight > 0) return
    clearTimeout(live.idleTimer)
    live.idleTimer = setTimeout(() => {
      live.idleTimer = undefined
      if (this.current !== live || live.inFlight > 0) return
      this.current = null
      live.client.close()
    }, this.idleMs)
    live.idleTimer.unref?.()
  }

  private async call(
    turn: CodexTurnInput,
    schema: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<ChatTransportResponse> {
    const live = await this.acquireLive()
    try {
      return await this.callOn(live, turn, schema, timeoutMs)
    } finally {
      live.inFlight--
      live.finished++
      this.recycle(live)
      this.armIdle(live)
    }
  }

  private async callOn(
    live: Live,
    turn: CodexTurnInput,
    schema: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<ChatTransportResponse> {
    // The clock starts once the app-server is up: spawning has its own request timeouts.
    const deadline = Date.now() + timeoutMs
    const outputSchema = schema ? strictifySchema(schema) : undefined
    let result = await this.runTurn(live, turn, outputSchema, deadline, timeoutMs)
    if (schema && result.status === 'failed' && result.error?.includes('invalid_json_schema')) {
      logger.warn(`codex rejected the output schema, retrying without it: ${result.error}`)
      const hinted = { ...turn, input: withSchemaHint(turn.input, schema) }
      result = await this.runTurn(live, hinted, undefined, deadline, timeoutMs)
    }
    if (result.status !== 'completed')
      throw new Error(`codex llm turn failed: ${result.error ?? result.status}`)
    const content = schema ? structuredContent(result.text, schema) : result.text
    return { choices: [{ message: { content } }], model: 'codex' }
  }

  private ensureLive(): Promise<Live> {
    if (this.destroyed) return Promise.reject(new Error('codex llm service is shut down'))
    if (this.current) return Promise.resolve(this.current)
    if (!this.starting) {
      const starting = this.startLive()
      this.starting = starting
      const clear = () => {
        if (this.starting === starting) this.starting = null
      }
      starting.then(clear, clear)
    }
    return this.starting
  }

  /** Stops a timed-out turn once its id is known; the call has already failed. */
  private interrupt(
    client: CodexRpcClient,
    threadId: string | undefined,
    turnStart: Promise<{ turn?: { id?: string } }> | undefined,
  ): void {
    if (!threadId || !turnStart) return
    turnStart
      .then((started) => {
        const turnId = started?.turn?.id
        if (turnId) return client.request('turn/interrupt', { threadId, turnId })
      })
      .catch(() => undefined)
  }

  /** Retires a child that has served its calls, and closes a retired one once it is idle. */
  private recycle(live: Live): void {
    if (!live.retired && live.finished >= this.recycleAfterCalls) {
      live.retired = true
      if (this.current === live) this.current = null
      this.retiring.add(live)
    }
    if (live.retired && live.inFlight === 0) {
      this.retiring.delete(live)
      live.client.close()
    }
  }

  /** Routes a notification to the call waiting on its thread; other threads are ignored. */
  private route(live: Live, msg: { method: string; params?: Record<string, unknown> }): void {
    const threadId = msg.params?.['threadId']
    const waiter = typeof threadId === 'string' ? live.waiters.get(threadId) : undefined
    if (!waiter) return
    if (msg.method === 'item/completed') {
      const item = msg.params?.['item'] as undefined | { text?: unknown; type?: string }
      if (item?.type === 'agentMessage' && typeof item.text === 'string')
        waiter.texts.push(item.text)
    } else if (msg.method === 'turn/completed') {
      waiter.resolve((msg.params?.['turn'] ?? {}) as Parameters<TurnWaiter['resolve']>[0])
    }
  }

  private async runTurn(
    live: Live,
    turn: CodexTurnInput,
    outputSchema: Record<string, unknown> | undefined,
    deadline: number,
    timeoutMs: number,
  ): Promise<TurnResult> {
    const { client } = live
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CodexLlmTimeoutError(timeoutMs)), deadline - Date.now())
    })
    /** Set once the call has settled (or timed out): a late thread/start starts no turn. */
    let settled = false
    let threadId: string | undefined
    let turnStart: Promise<{ turn?: { id?: string } }> | undefined
    const work = async (): Promise<TurnResult> => {
      const started = await client.request<{ thread: { id: string } }>('thread/start', {
        approvalPolicy: 'never',
        cwd: this.workDir,
        developerInstructions: turn.developerInstructions,
        ephemeral: true,
        sandbox: 'read-only',
      })
      threadId = started.thread.id
      if (settled) throw new CodexLlmTimeoutError(timeoutMs)
      // Registered before turn/start: the turn may complete before its response is read.
      let waiter!: TurnWaiter
      const done = new Promise<Parameters<TurnWaiter['resolve']>[0]>((resolve, reject) => {
        waiter = { reject, resolve, texts: [] }
      })
      done.catch(() => undefined) // awaited below; a rejection before that isn't unhandled
      live.waiters.set(threadId, waiter)
      turnStart = client.request('turn/start', {
        effort: 'low',
        input: turn.input,
        ...(outputSchema ? { outputSchema } : {}),
        threadId,
      })
      await turnStart
      const completed = await done
      return {
        error: completed.error?.message ?? undefined,
        status: completed.status ?? 'failed',
        text: waiter.texts.at(-1) ?? '',
      }
    }
    try {
      return await Promise.race([work(), timedOut])
    } catch (error) {
      if (error instanceof CodexLlmTimeoutError) this.interrupt(client, threadId, turnStart)
      throw error
    } finally {
      settled = true
      clearTimeout(timer)
      if (threadId) live.waiters.delete(threadId)
    }
  }

  private async send(
    request: ChatTransportRequest,
    timeoutMs: number,
  ): Promise<ChatTransportResponse> {
    const turn = toCodexTurnInput(request)
    const schema = request.response_format?.json_schema.schema
    return this.semaphore.run(() => this.call(turn, schema, timeoutMs))
  }

  private async startLive(): Promise<Live> {
    fs.mkdirSync(this.workDir, { recursive: true })
    const client = await this.spawnCodex(this.workDir)
    const live: Live = { client, finished: 0, inFlight: 0, retired: false, waiters: new Map() }
    client.onNotification((msg) => this.route(live, msg))
    client.onExit((_code, reason) => {
      clearTimeout(live.idleTimer)
      if (this.current === live) this.current = null
      this.retiring.delete(live)
      for (const waiter of live.waiters.values()) waiter.reject(new Error(reason))
      live.waiters.clear()
    })
    try {
      await client.request('initialize', {
        capabilities: null,
        clientInfo: { name: 'reelmakeeasy', title: 'ReelMakeEasy', version: '1' },
      })
      client.notify('initialized')
    } catch (error) {
      client.close()
      throw error
    }
    if (this.destroyed) {
      client.close()
      throw new Error('codex llm service is shut down')
    }
    this.current = live
    return live
  }
}
