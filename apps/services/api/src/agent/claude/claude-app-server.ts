import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  SdkMcpToolDefinition,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { AgentMode } from '@shared/types/api/agent'

import { modelImageType } from '../agent-attachments'
import { agentSkillNames } from '../codex/codex-home'
import type { RpcId, ServerRequestHandler } from '../codex/codex-rpc'
import type { DynamicToolSpec } from '../tools/agent-tools'

import type { AgentAppServer } from './agent-app-server'
import { claudeModel, scrubClaudeEnv } from './claude-config'
import { ClaudeTurnTranslator, type Notification, type TurnOutcome } from './claude-notifications'
import { ensureClaudePlugin } from './claude-plugin'
import { claudeOutputSchema, structuredAnswer } from './claude-schema'
import { jsonSchemaToZodShape } from './json-schema-zod'

type QueryHandle = AsyncIterable<SDKMessage> & { interrupt(): Promise<unknown> }
type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')

/** The SDK's `query()`, or a test's stand-in. */
export interface ClaudeAppServerOptions {
  /** The user's `claude` executable. */
  binary: string
  /** Wraps the ReelMakeEasy tools as an in-process MCP server (default: `createSdkMcpServer`). */
  buildMcpServer?: (
    tools: SdkMcpToolDefinition[],
  ) => McpSdkServerConfigWithInstance | Promise<McpSdkServerConfigWithInstance>
  cwd: string
  editing: boolean
  /** The child's env (default: `scrubClaudeEnv(process.env)`). */
  env?: Record<string, string | undefined>
  /** How long a turn may keep running after Stop before it is cut off (default 10 s). */
  interruptGraceMs?: number
  mode: AgentMode | undefined
  /** Default `claudeModel()`. */
  model?: string
  newId?: () => string
  /** ReelMakeEasy's plugin folder (default: `ensureClaudePlugin()`). */
  pluginDir?: string
  runQuery?: RunQuery
  /** Whether a stored conversation can be resumed (default: the SDK's `getSessionInfo`). */
  sessionExists?: (id: string, cwd: string) => Promise<boolean>
  tools: DynamicToolSpec[]
}

export type RunQuery = (params: {
  options: Options
  prompt: AsyncIterable<SDKUserMessage>
}) => QueryHandle

type AskedQuestion = {
  header?: unknown
  multiSelect?: unknown
  options?: unknown
  question?: unknown
}
type Running = {
  /** Cuts the turn off: its query is aborted and the turn ends as interrupted. */
  abort: AbortController
  done: () => void
  graceTimer?: NodeJS.Timeout
  handle: null | QueryHandle
  interrupted: boolean
}

const SHELL_TOOLS = ['AskUserQuestion', 'Bash', 'Glob', 'Grep', 'Read', 'Skill', 'TodoWrite']
/** The skills the briefs name (`reelmakeeasy-camera`, `reelmakeeasy-beat-loop`), as Claude knows
 *  them in ReelMakeEasy's plugin (named `reelmakeeasy`, claude-plugin.ts). */
const pluginSkills = () => agentSkillNames().map((name) => `reelmakeeasy:${name}`)
const DEFAULT_INTERRUPT_GRACE_MS = 10_000
const WEB_TOOLS = ['WebFetch', 'WebSearch']
const REELMAKEEASY_PREFIX = 'mcp__reelmakeeasy__'

let sdkPromise: null | Promise<Sdk> = null
/** The Agent SDK, loaded on first use: it is ESM-only, and tests never need the real one. */
export const loadSdk = (): Promise<Sdk> =>
  // eslint-disable-next-line no-restricted-syntax -- ESM-only package: a static import would make the API fail to start on Node versions that can't require ESM, and CJS jest can't load it
  (sdkPromise ??= import('@anthropic-ai/claude-agent-sdk'))

/**
 * Which built-in tools a chat's Claude has (`builtIn`) and which run without asking
 * (`allowed`), mirroring Codex's per-mode config: Easy searches the web and has no shell (so a
 * poisoned page can't make it read and leak a file); Free chat and editing have the shell
 * (sandboxed) and no web. AskUserQuestion is never pre-approved: `canUseTool` turns it into a
 * question card.
 */
type UserContent = SDKUserMessage['message']['content']

export function claudeToolPolicy(
  mode: AgentMode | undefined,
  editing: boolean,
): { allowed: string[]; builtIn: string[] } {
  if (mode === 'autonomous' && !editing) return { allowed: WEB_TOOLS, builtIn: WEB_TOOLS }
  return {
    allowed: [...SHELL_TOOLS.filter((t) => t !== 'AskUserQuestion'), `${REELMAKEEASY_PREFIX}*`],
    builtIn: SHELL_TOOLS,
  }
}

const userMessage = (content: UserContent): SDKUserMessage => ({
  message: { content, role: 'user' },
  parent_tool_use_id: null,
  type: 'user',
})

/** Claude takes a picture up to 5 MB; a bigger one still reaches it by its path in the text. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * A turn's input (Codex's shape) as Claude's message: the text items joined, then each
 * `localImage` the model can take as an image block. A picture that can't be read, is too big
 * or is of another type is left out (the text still names its path).
 */
export function turnContent(input: Record<string, unknown>[]): UserContent {
  const text = input
    .map((item) => (typeof item['text'] === 'string' ? item['text'] : ''))
    .filter(Boolean)
    .join('\n')
  const images = input.flatMap((item) => {
    const file = item['type'] === 'localImage' ? item['path'] : undefined
    const mediaType = typeof file === 'string' ? modelImageType(file) : null
    if (typeof file !== 'string' || !mediaType) return []
    try {
      if (fs.statSync(file).size > MAX_IMAGE_BYTES) return []
      const data = fs.readFileSync(file).toString('base64')
      return [{ source: { data, media_type: mediaType, type: 'base64' }, type: 'image' }]
    } catch {
      return []
    }
  })
  if (!images.length) return text
  return [{ text, type: 'text' }, ...images] as UserContent
}

/** The query's messages until `signal` aborts (then it throws): a cut-off turn ends even if
 *  the CLI never answers. */
async function* untilAborted<T>(it: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = it[Symbol.asyncIterator]()
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new Error('The turn was cut off'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
  aborted.catch(() => undefined)
  for (;;) {
    const next = await Promise.race([iterator.next(), aborted])
    if (next.done) return
    yield next.value
  }
}

/** A quiet turn's `outputSchema`, if it asked for a structured answer. */
const schemaOf = (p: Record<string, unknown>): Record<string, unknown> | undefined =>
  p['outputSchema'] && typeof p['outputSchema'] === 'object'
    ? (p['outputSchema'] as Record<string, unknown>)
    : undefined

/** The outcome a finished query's `result` message gives the turn. A turn that asked for a
 *  structured answer needs one: without it the turn failed. */
function outcomeOf(
  result: null | Record<string, unknown>,
  interrupted: boolean,
  outputSchema?: Record<string, unknown>,
): TurnOutcome {
  if (interrupted) return { status: 'interrupted' }
  if (!result) return { error: 'Claude ended the turn without a result', status: 'failed' }
  if (result['subtype'] !== 'success') {
    const errors = Array.isArray(result['errors'])
      ? (result['errors'] as unknown[]).map(String)
      : []
    return { error: errors.join('; ') || String(result['subtype']), status: 'failed' }
  }
  if (!outputSchema) return { status: 'completed' }
  try {
    const structuredText = structuredAnswer(result, claudeOutputSchema(outputSchema).unwrap)
    return { status: 'completed', structuredText }
  } catch (error) {
    return { error: ensureError(error).message, status: 'failed' }
  }
}

/**
 * Runs the user's Claude Code through the Agent SDK while speaking Codex's app-server protocol,
 * so `AgentSessionService` drives it exactly like Codex: `thread/start|resume`, `turn/start`
 * (one SDK `query()` per turn, resuming the conversation), `turn/interrupt`, Codex-shaped
 * notifications, and ReelMakeEasy tool calls and questions as server requests.
 */
export class ClaudeAppServer implements AgentAppServer {
  private brief = ''
  private closed = false
  private conversation: null | { id: string; started: boolean } = null
  private readonly exitHandlers: ((code: null | number, reason: string) => void)[] = []
  /** Tells this process's question ids apart from an earlier one's in the same chat (a card's
   *  id is stored with the chat, and each restart starts counting again). */
  private readonly instance = randomUUID().slice(0, 8)
  private nextAsk = 1
  private nextCall = 1
  private nextTurn = 1
  private readonly notificationHandlers: ((msg: Notification) => void)[] = []
  private readonly o: Pick<ClaudeAppServerOptions, 'pluginDir' | 'runQuery'> &
    Required<Omit<ClaudeAppServerOptions, 'pluginDir' | 'runQuery'>>
  private running: null | (Running & { turnId: string }) = null
  private serverRequest: null | ServerRequestHandler = null

  constructor(options: ClaudeAppServerOptions) {
    this.o = {
      buildMcpServer: async (tools) =>
        (await loadSdk()).createSdkMcpServer({ name: 'reelmakeeasy', tools }),
      env: scrubClaudeEnv(process.env),
      interruptGraceMs: DEFAULT_INTERRUPT_GRACE_MS,
      model: claudeModel(),
      newId: randomUUID,
      sessionExists: async (id, cwd) =>
        (await (await loadSdk()).getSessionInfo(id, { dir: cwd })) !== undefined,
      ...options,
    }
  }

  /** Stops the running turn at once and says nothing more: unlike a Codex child, a turn can
   *  still finish after `close()`, and it must not reach a session that has moved on. */
  close(): void {
    this.closed = true
    const running = this.running
    if (!running) return
    running.interrupted = true
    void running.handle?.interrupt().catch(() => undefined)
    running.abort.abort()
  }

  notify(): void {
    // Codex's `initialized` notification: nothing to set up here.
  }

  onExit(fn: (code: null | number, reason: string) => void): void {
    this.exitHandlers.push(fn)
  }

  onNotification(fn: (msg: Notification) => void): void {
    this.notificationHandlers.push(fn)
  }

  onServerRequest(fn: ServerRequestHandler): void {
    this.serverRequest = fn
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const p = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case 'initialize': {
        return {} as T
      }
      case 'thread/resume': {
        return (await this.resumeThread(p)) as T
      }
      case 'thread/start': {
        this.brief = String(p['developerInstructions'] ?? '')
        this.conversation = { id: this.o.newId(), started: false }
        return { thread: { id: this.conversation.id } } as T
      }
      case 'turn/interrupt': {
        await this.interrupt()
        return {} as T
      }
      case 'turn/start': {
        return this.startTurn(p) as T
      }
      default: {
        throw new Error(`Claude Code does not support ${method}`)
      }
    }
  }

  /** `AskUserQuestion`: shown as a question card; the answers go back keyed by question text. */
  private async askUser(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const asked = (Array.isArray(input['questions']) ? input['questions'] : []) as AskedQuestion[]
    const requestId = `ask-${this.instance}-${this.nextAsk++}`
    const questions = asked.map((q, i) => ({
      header: String(q.header ?? ''),
      id: `q${i}`,
      isOther: true,
      isSecret: false,
      options: Array.isArray(q.options) ? q.options : [],
      question: String(q.question ?? ''),
    }))
    const withdrawn = new Promise<'withdrawn'>((resolve) => {
      if (signal.aborted) resolve('withdrawn')
      signal.addEventListener('abort', () => resolve('withdrawn'), { once: true })
    })
    try {
      const answer = await Promise.race([
        this.serverRequest?.(
          'item/tool/requestUserInput',
          { itemId: requestId, questions },
          requestId,
        ) ?? Promise.reject(new Error('No one to ask')),
        withdrawn,
      ])
      if (answer === 'withdrawn') {
        this.emit({ method: 'serverRequest/resolved', params: { requestId } })
        return { behavior: 'deny', interrupt: true, message: 'The user did not answer.' }
      }
      const byId =
        ((answer ?? {}) as { answers?: Record<string, { answers?: string[] }> }).answers ?? {}
      const answers = Object.fromEntries(
        questions.map((q) => [q.question, (byId[q.id]?.answers ?? []).join(', ')]),
      )
      return { behavior: 'allow', updatedInput: { answers, questions: asked } }
    } catch {
      return { behavior: 'deny', interrupt: true, message: 'The user did not answer.' }
    }
  }

  private async buildOptions(
    turnId: string,
    p: Record<string, unknown>,
    abortController: AbortController,
  ): Promise<Options> {
    const policy = claudeToolPolicy(this.o.mode, this.o.editing)
    const conversation = this.conversation as { id: string; started: boolean }
    const canUseTool: CanUseTool = (name, input, { signal }) =>
      this.permission(name, input, signal, policy)
    const options: Options = {
      abortController,
      allowedTools: policy.allowed,
      canUseTool,
      cwd: this.o.cwd,
      disallowedTools: ['Agent', 'NotebookEdit', 'Task'],
      env: this.o.env,
      includePartialMessages: true,
      mcpServers: { reelmakeeasy: await this.o.buildMcpServer(this.toolDefinitions(turnId)) },
      // A chat's own model (turn/start `model`, as Codex takes it), else the harness default.
      model: typeof p['model'] === 'string' && p['model'] ? p['model'] : this.o.model,
      pathToClaudeCodeExecutable: this.o.binary,
      permissionMode: 'default',
      plugins: [{ path: this.o.pluginDir ?? ensureClaudePlugin(), type: 'local' }],
      settingSources: [],
      // Only ReelMakeEasy's own server: no claude.ai connectors or user MCP servers.
      strictMcpConfig: true,
      systemPrompt: { append: this.brief, preset: 'claude_code', type: 'preset' },
      tools: policy.builtIn,
      ...(conversation.started ? { resume: conversation.id } : { sessionId: conversation.id }),
    }
    if (policy.builtIn.includes('Bash'))
      options.sandbox = { allowUnsandboxedCommands: false, enabled: true }
    if (policy.builtIn.includes('Skill')) options.skills = pluginSkills()
    if (typeof p['effort'] === 'string') options.effort = p['effort'] as Options['effort']
    const outputSchema = schemaOf(p)
    if (outputSchema)
      options.outputFormat = {
        schema: claudeOutputSchema(outputSchema).schema,
        type: 'json_schema',
      }
    return options
  }

  /** A ReelMakeEasy tool call, sent to the session as Codex's `item/tool/call` request. */
  private async callTool(tool: string, args: unknown, turnId: string) {
    const requestId: RpcId = `call-${this.nextCall++}`
    try {
      if (this.closed) throw new Error('This chat has moved on')
      const answer = (await this.serverRequest?.(
        'item/tool/call',
        { arguments: args, callId: requestId, tool, turnId },
        requestId,
      )) as undefined | { contentItems?: { text?: string }[]; success?: boolean }
      if (!answer) throw new Error('No one to answer the tool call')
      const text = (answer.contentItems ?? []).map((c) => c.text ?? '').join('\n')
      return { content: [{ text, type: 'text' as const }], isError: answer.success === false }
    } catch (error) {
      return {
        content: [{ text: ensureError(error).message, type: 'text' as const }],
        isError: true,
      }
    }
  }

  private emit(msg: Notification): void {
    if (this.closed) return
    for (const fn of this.notificationHandlers) fn(msg)
  }

  /** Asks Claude to stop; a turn still running after the grace period is cut off. */
  private async interrupt(): Promise<void> {
    const running = this.running
    if (!running) return
    running.interrupted = true
    clearTimeout(running.graceTimer)
    running.graceTimer = setTimeout(() => running.abort.abort(), this.o.interruptGraceMs)
    await running.handle?.interrupt().catch(() => undefined)
  }

  private async permission(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    policy: { allowed: string[]; builtIn: string[] },
  ): Promise<PermissionResult> {
    if (name === 'AskUserQuestion' && policy.builtIn.includes(name))
      return this.closed
        ? { behavior: 'deny', interrupt: true, message: 'This chat has moved on.' }
        : this.askUser(input, signal)
    // A quiet turn's JSON answer (outputFormat) arrives through this tool.
    if (name === 'StructuredOutput') return { behavior: 'allow', updatedInput: input }
    const reelmakeeasy =
      name.startsWith(REELMAKEEASY_PREFIX) && policy.allowed.includes(`${REELMAKEEASY_PREFIX}*`)
    if (reelmakeeasy || (name !== 'AskUserQuestion' && policy.allowed.includes(name)))
      return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: `${name} is not available in this chat.` }
  }

  private async resumeThread(p: Record<string, unknown>): Promise<Record<string, never>> {
    const id = String(p['threadId'] ?? '')
    if (!id || !(await this.o.sessionExists(id, this.o.cwd)))
      throw new Error(`No Claude conversation ${id || '(none)'} to resume`)
    this.brief = String(p['developerInstructions'] ?? '')
    this.conversation = { id, started: true }
    return {}
  }

  /** Runs one turn's query to its end, translating every message. */
  private async runTurn(
    turnId: string,
    content: UserContent,
    p: Record<string, unknown>,
    running: Running,
  ): Promise<void> {
    const translator = new ClaudeTurnTranslator(turnId)
    let result: null | Record<string, unknown> = null
    let error: null | string = null
    const finished = new Promise<void>((resolve) => (running.done = resolve))
    // The prompt stays open until the turn ends: permission answers travel on the same channel.
    const prompt = (async function* () {
      yield userMessage(content)
      await finished
    })()
    try {
      const options = await this.buildOptions(turnId, p, running.abort)
      const runQuery = this.o.runQuery ?? ((await loadSdk()).query as unknown as RunQuery)
      const handle = runQuery({ options, prompt })
      running.handle = handle
      if (running.interrupted) await handle.interrupt()
      for await (const msg of untilAborted(handle, running.abort.signal)) {
        const m = msg as unknown as Record<string, unknown>
        for (const n of translator.translate(m)) this.emit(n)
        if (m['type'] === 'result') {
          result = m
          break
        }
      }
      if (this.conversation) this.conversation.started = true
    } catch (caught) {
      error = ensureError(caught).message
    } finally {
      clearTimeout(running.graceTimer)
      running.done()
    }
    const outcome =
      error && !running.interrupted
        ? { error, status: 'failed' as const }
        : outcomeOf(result, running.interrupted, schemaOf(p))
    this.running = null
    for (const n of translator.finish(outcome)) this.emit(n)
  }

  private startTurn(p: Record<string, unknown>): { turn: { id: string } } {
    if (!this.conversation) throw new Error('Start or resume a conversation first')
    if (this.running) throw new Error('A turn is already running')
    const input = Array.isArray(p['input']) ? (p['input'] as Record<string, unknown>[]) : []
    const content = turnContent(input)
    const turnId = `turn-${this.nextTurn++}`
    const running: Running & { turnId: string } = {
      abort: new AbortController(),
      done: () => undefined,
      handle: null,
      interrupted: false,
      turnId,
    }
    this.running = running
    // After the caller has the turn id, as Codex's notifications follow its response.
    setImmediate(() => {
      this.emit({ method: 'turn/started', params: { turn: { id: turnId } } })
      void this.runTurn(turnId, content, p, running)
    })
    return { turn: { id: turnId } }
  }

  private toolDefinitions(turnId: string): SdkMcpToolDefinition[] {
    return this.o.tools.map((spec) => ({
      description: spec.description,
      handler: (args: unknown) => this.callTool(spec.name, args, turnId),
      inputSchema: jsonSchemaToZodShape(spec.inputSchema),
      name: spec.name,
    })) as unknown as SdkMcpToolDefinition[]
  }
}
