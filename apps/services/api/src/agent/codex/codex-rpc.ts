import { type ChildProcess, spawn } from 'node:child_process'
import readline from 'node:readline'

import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { scrubCodexEnv } from './codex-config'

/** Max lines of stderr kept for diagnostics when the process fails. */
const STDERR_TAIL_LINES = 20
/** How long to wait for 'close' after 'exit' before failing anyway (see the 'exit' handler below). */
const CLOSE_GRACE_MS = 500
// eslint-disable-next-line no-control-regex -- stripping ANSI escape codes requires matching control characters
const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*[A-Za-z]/g
/** After SIGTERM on a timed-out (hung) child, how long before SIGKILL. */
const KILL_GRACE_MS = 2000

/** Per-method request timeouts. Starting a child or a thread can be slow (MCP servers,
 *  thread history); turn/start and turn/interrupt should answer quickly - the turn itself
 *  streams as notifications afterwards. Methods not listed have no timeout. */
export const DEFAULT_REQUEST_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  initialize: 60_000,
  'thread/resume': 60_000,
  'thread/start': 60_000,
  'turn/interrupt': 30_000,
  'turn/start': 30_000,
}

export interface CodexSpawnOptions {
  cwd?: string
  /** Defaults to `process.env` with ReelMakeEasy's secrets removed (`scrubCodexEnv`). */
  env?: NodeJS.ProcessEnv
  /** Overrides `DEFAULT_REQUEST_TIMEOUTS_MS` per method (tests use short ones). */
  requestTimeoutsMs?: Record<string, number>
}

export type RpcId = number | string

type Notification = { method: string; params?: Record<string, unknown> }

/** Handles a request *from* Codex. Return null for "not supported" (answered with -32601). */
export type ServerRequestHandler = (
  method: string,
  params: unknown,
  requestId: RpcId,
) => null | Promise<unknown>

type RawMessage = {
  error?: { code: number; message?: string }
  id?: RpcId
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

/** JSON-RPC over the stdio of a `codex app-server` process (one JSON object per line). */
export class CodexRpcClient {
  /** Started on 'exit' as a fallback in case 'close' never arrives (see the 'exit' handler below). */
  private closeGraceTimer?: NodeJS.Timeout
  private exited = false
  private exitHandlers: ((code: null | number, reason: string) => void)[] = []
  private readonly logger = new Logger(CodexRpcClient.name)
  private nextId = 1
  private notificationHandlers: ((msg: Notification) => void)[] = []
  private pending = new Map<RpcId, { reject: (e: Error) => void; resolve: (v: unknown) => void }>()
  private serverRequestHandler?: ServerRequestHandler
  /** Bounded ring buffer of the process's last stderr lines, ANSI stripped, surfaced only on failure. */
  private readonly stderrTail: string[] = []
  private readonly timeoutsMs: Record<string, number>

  private constructor(
    private readonly child: ChildProcess,
    timeoutsMs: Record<string, number> = {},
  ) {
    this.timeoutsMs = { ...DEFAULT_REQUEST_TIMEOUTS_MS, ...timeoutsMs }
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line))
    if (child.stderr) {
      readline.createInterface({ input: child.stderr }).on('line', (line) => {
        this.stderrTail.push(line.replace(ANSI_ESCAPE_RE, ''))
        if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift()
      })
    }
    // A spawn failure (bad path, EACCES) or a write landing after the child died
    // but before Node delivers 'close' otherwise surfaces as an unhandled 'error'
    // and crashes the whole process. Route both into the same failure path.
    child.on('error', (err) => this.fail(null, err.message))
    child.stdin!.on('error', (err) => this.fail(null, err.message))
    // 'close' (not 'exit') is preferred so the stderr tail has been fully read
    // by the time we build the failure message: 'close' fires only after
    // every stdio stream has ended, while 'exit' can race ahead of buffered
    // stderr. But 'close' only fires once every holder of the child's stdio
    // fds has closed them - if Codex leaves behind a backgrounded subprocess
    // that inherited stdout/stderr, 'close' may never come. 'exit' always
    // fires, so it starts a short grace timer that fails anyway (with
    // whatever stderr tail was captured by then) if 'close' hasn't beaten it.
    child.on('exit', (code) => {
      if (this.exited) return
      this.closeGraceTimer = setTimeout(() => this.fail(code, `exited (${code})`), CLOSE_GRACE_MS)
    })
    child.on('close', (code) => {
      clearTimeout(this.closeGraceTimer)
      this.fail(code, `exited (${code})`)
    })
  }

  static spawn(binary: string, args: string[], opts: CodexSpawnOptions = {}): CodexRpcClient {
    // `env` is read from process.env at call time (rather than left to
    // child_process's own default) so a caller that mutates process.env right
    // before spawning - as tests do to point the fake app-server at a log file
    // or a set of resumable thread ids - reliably reaches the child. It is
    // scrubbed so Codex never sees ReelMakeEasy's own keys.
    const env = opts.env ?? scrubCodexEnv(process.env)
    return new CodexRpcClient(
      spawn(binary, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }),
      opts.requestTimeoutsMs,
    )
  }

  close(): void {
    if (!this.exited) this.child.kill('SIGTERM')
  }

  notify(method: string): void {
    this.write({ method })
  }

  /** `reason` is the same message pending requests were rejected with (includes the stderr tail). */
  onExit(fn: (code: null | number, reason: string) => void): void {
    this.exitHandlers.push(fn)
  }

  onNotification(fn: (msg: Notification) => void): void {
    this.notificationHandlers.push(fn)
  }

  /** One handler for requests from Codex (e.g. user input); a second call replaces it. */
  onServerRequest(fn: ServerRequestHandler): void {
    this.serverRequestHandler = fn
  }

  /** Sends a request. It rejects if Codex answers with an error, exits, or doesn't answer
   *  within `timeoutMs` (default per method, see `DEFAULT_REQUEST_TIMEOUTS_MS`); a timeout
   *  means the app-server is hung, so the child is stopped and every pending request fails. */
  request<T = unknown>(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.exited) return Promise.reject(new Error('codex app-server exited'))
    const id = this.nextId++
    const timeoutMs = opts.timeoutMs ?? this.timeoutsMs[method]
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => this.timeOut(method, timeoutMs), timeoutMs)
        : undefined
      this.pending.set(id, {
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
      })
      this.write({ id, method, params })
    })
  }

  /** Marks the client failed and settles everything exactly once, however it was triggered. */
  private fail(code: null | number, reason: string): void {
    if (this.exited) return
    this.exited = true
    clearTimeout(this.closeGraceTimer)
    // Once the client is considered dead there is no reason to keep reading:
    // if a backgrounded subprocess is still holding the child's stdio fds
    // open (the reason 'close' may never arrive), our own end of those pipes
    // would otherwise sit open indefinitely as a live handle.
    this.child.stdout?.destroy()
    this.child.stderr?.destroy()
    const tail = this.stderrTail.join('\n').trim()
    const message = tail ? `codex app-server ${reason}: ${tail}` : `codex app-server ${reason}`
    for (const p of this.pending.values()) p.reject(new Error(message))
    this.pending.clear()
    for (const fn of this.exitHandlers) {
      try {
        fn(code, message)
      } catch (error) {
        this.logger.error(`codex exit handler threw: ${ensureError(error).message}`)
      }
    }
  }

  /** Answers a request from Codex with the handler's result, or refuses it. */
  private handleServerRequest(id: RpcId, method: string, params: unknown): void {
    let answer: null | Promise<unknown> = null
    try {
      answer = this.serverRequestHandler?.(method, params, id) ?? null
    } catch (error) {
      this.logger.error(
        `codex server request handler threw on ${method}: ${ensureError(error).message}`,
      )
    }
    if (!answer) {
      this.write({ error: { code: -32601, message: 'Not supported by ReelMakeEasy' }, id })
      return
    }
    answer.then(
      (result) => this.write({ id, result }),
      (error: unknown) =>
        this.write({ error: { code: -32000, message: ensureError(error).message }, id }),
    )
  }

  private onLine(line: string): void {
    let msg: RawMessage
    try {
      msg = JSON.parse(line) as RawMessage
    } catch {
      return
    }
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'app-server error'))
      else p.resolve(msg.result)
      return
    }
    if (msg.id !== undefined && msg.method) {
      // A request from Codex (user input; approvals never come with approvalPolicy "never").
      this.handleServerRequest(msg.id, msg.method, msg.params)
      return
    }
    if (!msg.method) return
    const notification: Notification = { method: msg.method, params: msg.params }
    for (const fn of this.notificationHandlers) {
      // One throwing handler must not skip the others (or kill the readline loop).
      try {
        fn(notification)
      } catch (error) {
        this.logger.error(
          `codex notification handler threw on ${msg.method}: ${ensureError(error).message}`,
        )
      }
    }
  }

  /** A request went unanswered: treat the app-server as hung. Stop it (SIGKILL if SIGTERM
   *  isn't enough) and fail everything now rather than waiting for it to exit. */
  private timeOut(method: string, timeoutMs: number): void {
    if (this.exited) return
    this.child.kill('SIGTERM')
    const killTimer = setTimeout(() => this.child.kill('SIGKILL'), KILL_GRACE_MS)
    killTimer.unref()
    this.child.once('exit', () => clearTimeout(killTimer))
    const within = timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`
    this.fail(null, `did not answer ${method} within ${within}`)
  }

  private write(msg: unknown): void {
    if (this.exited) return
    try {
      this.child.stdin!.write(JSON.stringify(msg) + '\n')
    } catch {
      // A synchronous write failure is a symptom of the same death the 'error'
      // listener already handles; never let it escape as an unhandled throw.
    }
  }
}
