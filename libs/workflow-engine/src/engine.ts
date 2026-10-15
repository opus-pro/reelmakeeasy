import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import { journalClosed, journalOpened, setJournalPath } from './journal'
import {
  ActivityFailure,
  type ActivityOptions,
  ApplicationFailure,
  CancelledFailure,
  ChildWorkflowFailure,
  type Logger,
  msFromDuration,
  msOptionalFromDuration,
  ParentClosePolicy,
  QueryNotRegisteredError,
  TerminatedFailure,
  TimeoutFailure,
  toPayload,
  type Workflow,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
} from './common'

// ---------- configuration ----------

export interface ContextPropagator {
  /** Snapshot the caller's ambient context (e.g. request identity) at workflow start. */
  capture(): unknown
  /** Run `fn` with a previously captured context restored. */
  run<T>(ctx: unknown, fn: () => T): T
}

export interface EngineConfig {
  /** Retry cap applied when an activity's policy allows unlimited attempts. */
  defaultMaxActivityAttempts: number
  logger: Logger
  propagator?: ContextPropagator
  /** File recording open runs, so interrupted ones can be found after a restart. */
  journalPath?: string
  /** How long closed runs stay queryable / describable. */
  retentionMs: number
}

const consoleLogger: Logger = {
  debug: (m, meta) => console.debug(m, meta ?? ''),
  error: (m, meta) => console.error(m, meta ?? ''),
  info: (m, meta) => console.info(m, meta ?? ''),
  trace: () => undefined,
  warn: (m, meta) => console.warn(m, meta ?? ''),
}

const config: EngineConfig = {
  defaultMaxActivityAttempts: Number(
    process.env['MAX_ACTIVITY_ATTEMPTS'] ?? 10,
  ),
  logger: consoleLogger,
  retentionMs: 24 * 60 * 60 * 1000,
}

export function configureEngine(overrides: Partial<EngineConfig>): void {
  Object.assign(config, overrides)
  if ('journalPath' in overrides) setJournalPath(overrides.journalPath)
}

export function engineLogger(): Logger {
  return config.logger
}

function runWithPropagated<T>(ctx: unknown, fn: () => T): T {
  return config.propagator && ctx !== undefined ? config.propagator.run(ctx, fn) : fn()
}

// ---------- cancellation scopes ----------

export class Scope {
  public readonly controller = new AbortController()
  private cancelRequestedPromise?: Promise<never>

  constructor(
    public readonly parent: Scope | undefined,
    public readonly cancellable: boolean,
  ) {
    if (parent && cancellable) {
      if (parent.signal.aborted) this.cancel()
      else parent.signal.addEventListener('abort', () => this.cancel(), { once: true })
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get consideredCancelled(): boolean {
    return this.signal.aborted
  }

  /** Rejects with `CancelledFailure` once the scope is cancelled. */
  get cancelRequested(): Promise<never> {
    this.cancelRequestedPromise ??= new Promise<never>((_, reject) => {
      const fire = () => reject(new CancelledFailure('Cancellation scope cancelled'))
      if (this.signal.aborted) fire()
      else this.signal.addEventListener('abort', fire, { once: true })
    })
    // Keep an unobserved rejection from crashing the process.
    this.cancelRequestedPromise.catch(() => undefined)
    return this.cancelRequestedPromise
  }

  cancel(): void {
    if (!this.signal.aborted) this.controller.abort(new CancelledFailure())
  }
}

// ---------- executions ----------

export type ExecutionStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'CONTINUED_AS_NEW'
  | 'FAILED'
  | 'RUNNING'
  | 'TERMINATED'
  | 'TIMED_OUT'

type Handler = (...args: unknown[]) => unknown
interface UpdateEntry {
  handler: Handler
  validator?: Handler
}

interface Waiter {
  check(): void
}

export class ContinueAsNew extends Error {
  constructor(public readonly args: unknown[]) {
    super('Workflow continued as new')
    this.name = 'ContinueAsNew'
  }
}

interface ChildLink {
  execution: Execution
  policy: ParentClosePolicy
}

export interface StartOptions {
  args?: unknown[]
  memo?: Record<string, unknown>
  searchAttributes?: Record<string, unknown>
  taskQueue?: string
  workflowId: string
  workflowIdConflictPolicy?: WorkflowIdConflictPolicy | string
  workflowIdReusePolicy?: WorkflowIdReusePolicy | string
}

const SUGGEST_CONTINUE_AS_NEW_EVENTS = 4096
const SUGGEST_CONTINUE_AS_NEW_BYTES = 4 * 1024 * 1024

export class Execution {
  public readonly children = new Set<ChildLink>()
  public closeTime?: Date
  public failure?: Error
  public historyLength = 3
  public historySize = 0
  /** Per-run storage for state that workflow code would otherwise keep in module variables. */
  public readonly locals = new Map<unknown, unknown>()
  public nextRun?: Execution
  public readonly pendingSignals = new Map<string, unknown[][]>()
  public readonly pendingUpdates = new Map<string, (() => void)[]>()
  public readonly queryHandlers = new Map<string, Handler>()
  public result?: unknown
  public readonly rootScope = new Scope(undefined, true)
  public readonly runId = randomUUID()
  public readonly signalHandlers = new Map<string, Handler>()
  public readonly startTime = new Date()
  public status: ExecutionStatus = 'RUNNING'
  public readonly terminateController = new AbortController()
  public readonly updateHandlers = new Map<string, UpdateEntry>()
  public readonly waiters = new Set<Waiter>()

  private readonly closed: Promise<void>
  private markClosed!: () => void
  private pollTimer?: NodeJS.Timeout

  constructor(
    public readonly workflowId: string,
    public readonly workflowType: string,
    public readonly taskQueue: string,
    public readonly args: unknown[],
    public readonly firstExecutionRunId: string | undefined,
    public readonly continuedFromRunId: string | undefined,
    public readonly parent: { runId: string; workflowId: string } | undefined,
    public readonly reqContext: unknown,
    public readonly memo: Record<string, unknown> | undefined,
    public readonly searchAttributes: Record<string, unknown> | undefined,
  ) {
    this.closed = new Promise((resolve) => (this.markClosed = resolve))
  }

  get firstRunId(): string {
    return this.firstExecutionRunId ?? this.runId
  }

  get isRunning(): boolean {
    return this.status === 'RUNNING'
  }

  get terminateSignal(): AbortSignal {
    return this.terminateController.signal
  }

  recordEvents(count: number, payload?: unknown): void {
    this.historyLength += count
    if (payload !== undefined) {
      try {
        this.historySize += JSON.stringify(payload)?.length ?? 0
      } catch {
        // Unserializable payloads were already rejected by toPayload.
      }
    }
  }

  get continueAsNewSuggested(): boolean {
    return (
      this.historyLength > SUGGEST_CONTINUE_AS_NEW_EVENTS ||
      this.historySize > SUGGEST_CONTINUE_AS_NEW_BYTES
    )
  }

  whenClosed(): Promise<void> {
    return this.closed
  }

  close(status: ExecutionStatus, outcome: { failure?: Error; result?: unknown }): void {
    if (!this.isRunning) return
    this.status = status
    this.result = outcome.result
    this.failure = outcome.failure
    this.closeTime = new Date()
    this.rootScope.cancel()
    this.stopPolling()
    for (const waiter of this.waiters) waiter.check()
    this.markClosed()
  }

  /** Re-evaluates `condition()` predicates. */
  notify(): void {
    for (const waiter of [...this.waiters]) waiter.check()
  }

  addWaiter(waiter: Waiter): void {
    this.waiters.add(waiter)
    // Predicates may depend on state changed by plain workflow code, so poll
    // while anything is waiting, in addition to explicit notifications.
    this.pollTimer ??= setInterval(() => this.notify(), 50)
    this.pollTimer.unref?.()
  }

  removeWaiter(waiter: Waiter): void {
    this.waiters.delete(waiter)
    if (this.waiters.size === 0) this.stopPolling()
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }
}

// ---------- ambient contexts ----------

export interface WorkflowContextValue {
  execution: Execution
  scope: Scope
}

export const workflowStorage = new AsyncLocalStorage<WorkflowContextValue>()

export interface ActivityInfo {
  activityId: string
  activityType: string
  attempt: number
  currentAttemptScheduledTimestampMs: number
  heartbeatDetails: unknown
  heartbeatTimeoutMs?: number
  isLocal: boolean
  scheduledTimestampMs: number
  scheduleToCloseTimeoutMs?: number
  startToCloseTimeoutMs?: number
  taskQueue: string
  workflowExecution: { runId: string; workflowId: string }
  workflowNamespace: string
  workflowType: string
}

export interface ActivityContextValue {
  cancellationSignal: AbortSignal
  cancelled: Promise<never>
  heartbeat(details?: unknown): void
  info: ActivityInfo
  log: Logger
  sleep(ms: Duration): Promise<void>
}

type Duration = number | string

export const activityStorage = new AsyncLocalStorage<ActivityContextValue>()

export function currentWorkflowContext(): WorkflowContextValue {
  const ctx = workflowStorage.getStore()
  if (!ctx) throw new Error('Workflow APIs can only be used inside a workflow')
  return ctx
}

// ---------- helpers ----------

function abortPromise(signals: AbortSignal[], onAbort: () => Error): Promise<never> {
  return new Promise<never>((_, reject) => {
    for (const signal of signals) {
      if (signal.aborted) return reject(onAbort())
      signal.addEventListener('abort', () => reject(onAbort()), { once: true })
    }
  })
}

/** Resolves after `ms`, rejecting with `CancelledFailure` if any signal aborts first. */
export function cancellableSleep(ms: number, signals: AbortSignal[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signals.some((s) => s.aborted)) return reject(new CancelledFailure())
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new CancelledFailure())
    }
    function done() {
      cleanup()
      resolve()
    }
    function cleanup() {
      for (const s of signals) s.removeEventListener('abort', onAbort)
    }
    for (const s of signals) s.addEventListener('abort', onAbort, { once: true })
  })
}

class Semaphore {
  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const entry = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          const i = this.queue.indexOf(entry)
          if (i >= 0) this.queue.splice(i, 1)
          reject(new CancelledFailure())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        this.queue.push(entry)
      })
    }
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.queue.shift()?.()
    }
  }
}

// ---------- registry ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- activities are heterogeneous
type ActivityFn = (...args: any[]) => unknown

export interface WorkerRegistration {
  activities?: Record<string, unknown>
  maxConcurrentActivityTaskExecutions?: number
  taskQueue: string
  workflows?: Record<string, unknown>
}

const workflowsByType = new Map<string, Workflow>()
const activitiesByQueue = new Map<string, Map<string, ActivityFn>>()
const semaphores = new Map<string, Semaphore>()
const runsById = new Map<string, Execution[]>()

export function registerWorker(registration: WorkerRegistration): void {
  const { taskQueue } = registration
  for (const [name, fn] of Object.entries(registration.workflows ?? {})) {
    if (typeof fn === 'function') workflowsByType.set(name, fn as Workflow)
  }
  const queue = activitiesByQueue.get(taskQueue) ?? new Map<string, ActivityFn>()
  for (const [name, fn] of Object.entries(registration.activities ?? {})) {
    if (typeof fn === 'function') queue.set(name, fn as ActivityFn)
  }
  activitiesByQueue.set(taskQueue, queue)
  if (!semaphores.has(taskQueue)) {
    semaphores.set(taskQueue, new Semaphore(registration.maxConcurrentActivityTaskExecutions ?? 20))
  }
  config.logger.info(
    `[workflow-engine] registered worker taskQueue=${taskQueue} workflows=${Object.keys(registration.workflows ?? {}).length} activities=${queue.size}`,
  )
}

function findActivity(
  taskQueue: string,
  name: string,
): { fn: ActivityFn; queue: string } | undefined {
  const direct = activitiesByQueue.get(taskQueue)?.get(name)
  if (direct) return { fn: direct, queue: taskQueue }
  for (const [queue, fns] of activitiesByQueue) {
    const fn = fns.get(name)
    if (fn) return { fn, queue }
  }
  return undefined
}

function semaphoreFor(queue: string): Semaphore {
  let sem = semaphores.get(queue)
  if (!sem) {
    sem = new Semaphore(20)
    semaphores.set(queue, sem)
  }
  return sem
}

// ---------- run lifecycle ----------

export function latestRun(workflowId: string): Execution | undefined {
  const runs = runsById.get(workflowId)
  return runs?.[runs.length - 1]
}

export function findRun(workflowId: string, runId?: string): Execution | undefined {
  const runs = runsById.get(workflowId)
  if (!runs) return undefined
  if (!runId) return runs[runs.length - 1]
  return runs.find((r) => r.runId === runId || r.firstRunId === runId)
}

export function allRuns(): Execution[] {
  return [...runsById.values()].flat()
}

function checkStartAllowed(options: StartOptions, workflowType: string): Execution | undefined {
  const existing = latestRun(options.workflowId)
  if (!existing) return undefined
  if (existing.isRunning) {
    const conflict = options.workflowIdConflictPolicy ?? WorkflowIdConflictPolicy.FAIL
    if (conflict === WorkflowIdConflictPolicy.USE_EXISTING) return existing
    if (
      conflict === WorkflowIdConflictPolicy.TERMINATE_EXISTING ||
      options.workflowIdReusePolicy === WorkflowIdReusePolicy.TERMINATE_IF_RUNNING
    ) {
      terminateRun(existing, 'Terminated by a new run with the same workflow id')
      return undefined
    }
    throw new WorkflowExecutionAlreadyStartedError(
      `Workflow execution already started: ${options.workflowId}`,
      options.workflowId,
      workflowType,
    )
  }
  const reuse = options.workflowIdReusePolicy ?? WorkflowIdReusePolicy.ALLOW_DUPLICATE
  const failedLike = ['FAILED', 'CANCELLED', 'TERMINATED'].includes(existing.status)
  if (
    reuse === WorkflowIdReusePolicy.REJECT_DUPLICATE ||
    (reuse === WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY && !failedLike)
  ) {
    throw new WorkflowExecutionAlreadyStartedError(
      `Workflow execution already exists: ${options.workflowId}`,
      options.workflowId,
      workflowType,
    )
  }
  return undefined
}

export function startWorkflow(
  workflowType: string,
  options: StartOptions,
  link?: { parent: Execution; policy: ParentClosePolicy; scope: Scope },
): Execution {
  const reused = checkStartAllowed(options, workflowType)
  if (reused) return reused
  if (!workflowsByType.has(workflowType)) {
    throw new ApplicationFailure(
      `Workflow type "${workflowType}" is not registered`,
      'WorkflowNotRegistered',
      true,
    )
  }
  const reqContext = link ? link.parent.reqContext : config.propagator?.capture()
  const execution = new Execution(
    options.workflowId,
    workflowType,
    options.taskQueue ?? 'default',
    toPayload(options.args ?? []),
    undefined,
    undefined,
    link ? { runId: link.parent.runId, workflowId: link.parent.workflowId } : undefined,
    reqContext,
    options.memo,
    options.searchAttributes,
  )
  if (link) {
    link.parent.children.add({ execution, policy: link.policy })
    link.parent.recordEvents(3)
    link.scope.signal.addEventListener('abort', () => cancelRun(execution), { once: true })
  }
  launch(execution)
  return execution
}

function addRun(execution: Execution): void {
  journalOpened({
    runId: execution.runId,
    startTime: execution.startTime.toISOString(),
    taskQueue: execution.taskQueue,
    workflowId: execution.workflowId,
    workflowType: execution.workflowType,
  })
  const runs = runsById.get(execution.workflowId) ?? []
  runs.push(execution)
  runsById.set(execution.workflowId, runs)
}

function launch(execution: Execution): void {
  addRun(execution)
  const fn = workflowsByType.get(execution.workflowType)!
  const terminated = abortPromise([execution.terminateSignal], () => new TerminatedFailure())
  terminated.catch(() => undefined)

  // Start on the next tick so the caller gets its handle before workflow code runs.
  setImmediate(() => {
    workflowStorage.run({ execution, scope: execution.rootScope }, () =>
      runWithPropagated(execution.reqContext, async () => {
        try {
          const result = await Promise.race([fn(...execution.args), terminated])
          settle(execution, 'COMPLETED', { result: toPayload(result) })
        } catch (err) {
          if (err instanceof ContinueAsNew && !execution.terminateSignal.aborted) {
            continueRun(execution, err)
          } else if (execution.terminateSignal.aborted) {
            settle(execution, 'TERMINATED', { failure: new TerminatedFailure() })
          } else if (err instanceof CancelledFailure && execution.rootScope.consideredCancelled) {
            settle(execution, 'CANCELLED', { failure: err })
          } else {
            const failure = err instanceof Error ? err : new Error(String(err))
            config.logger.error(
              `[workflow-engine] workflow failed ${execution.workflowType} id=${execution.workflowId}: ${failure.message}`,
            )
            settle(execution, 'FAILED', { failure })
          }
        }
      }),
    )
  })
}

function settle(
  execution: Execution,
  status: ExecutionStatus,
  outcome: { failure?: Error; result?: unknown },
): void {
  if (!execution.isRunning) return
  execution.close(status, outcome)
  journalClosed(execution.runId)
  applyParentClosePolicy(execution)
  scheduleEviction(execution)
}

function continueRun(previous: Execution, can: ContinueAsNew): void {
  const next = new Execution(
    previous.workflowId,
    previous.workflowType,
    previous.taskQueue,
    toPayload(can.args),
    previous.firstRunId,
    previous.runId,
    previous.parent,
    previous.reqContext,
    previous.memo,
    previous.searchAttributes,
  )
  // Signals the old run never got a handler for carry over, like buffered history would.
  for (const [name, queued] of previous.pendingSignals) next.pendingSignals.set(name, [...queued])
  previous.nextRun = next
  settle(previous, 'CONTINUED_AS_NEW', {})
  launch(next)
}

function applyParentClosePolicy(parent: Execution): void {
  for (const { execution, policy } of parent.children) {
    if (!execution.isRunning) continue
    if (policy === ParentClosePolicy.ABANDON) continue
    const child = latestRun(execution.workflowId) ?? execution
    if (policy === ParentClosePolicy.REQUEST_CANCEL) cancelRun(child)
    else terminateRun(child, 'Parent workflow closed')
  }
}

function scheduleEviction(execution: Execution): void {
  const timer = setTimeout(() => {
    const runs = runsById.get(execution.workflowId)
    if (!runs) return
    const remaining = runs.filter((r) => r !== execution)
    if (remaining.length) runsById.set(execution.workflowId, remaining)
    else runsById.delete(execution.workflowId)
  }, config.retentionMs)
  timer.unref?.()
}

export function terminateRun(execution: Execution, reason?: string): void {
  if (!execution.isRunning) return
  config.logger.warn(
    `[workflow-engine] terminating ${execution.workflowType} id=${execution.workflowId}${reason ? `: ${reason}` : ''}`,
  )
  execution.terminateController.abort(new TerminatedFailure(reason))
  settle(execution, 'TERMINATED', { failure: new TerminatedFailure(reason) })
}

export function cancelRun(execution: Execution): void {
  if (execution.isRunning) execution.rootScope.cancel()
}

/** Resolves with the final result, following continue-as-new hand-offs. */
export async function awaitResult(execution: Execution, followRuns = true): Promise<unknown> {
  let current = execution
  for (;;) {
    await current.whenClosed()
    if (current.status === 'CONTINUED_AS_NEW' && followRuns && current.nextRun) {
      current = current.nextRun
      continue
    }
    if (current.status === 'COMPLETED') return current.result
    throw new WorkflowFailedError(
      `Workflow execution ${current.status.toLowerCase()}`,
      current.failure,
    )
  }
}

// ---------- activities ----------

function isNonRetryable(failure: Error, nonRetryableTypes: string[] | undefined): boolean {
  if (failure instanceof ApplicationFailure) {
    if (failure.nonRetryable) return true
    if (failure.type && nonRetryableTypes?.includes(failure.type)) return true
  }
  return !!nonRetryableTypes?.includes(failure.name)
}

export async function runActivity(
  ctx: WorkflowContextValue,
  activityType: string,
  rawArgs: unknown[],
  options: ActivityOptions,
  isLocal = false,
): Promise<unknown> {
  const { execution, scope } = ctx
  const taskQueue = options.taskQueue ?? execution.taskQueue
  const activityId = options.activityId ?? String(execution.historyLength)
  const args = toPayload(rawArgs)
  execution.recordEvents(3, args)

  const found = findActivity(taskQueue, activityType)
  if (!found) {
    throw new ActivityFailure(
      `Activity "${activityType}" is not registered on any task queue`,
      activityType,
      activityId,
      'NON_RETRYABLE_FAILURE',
      ApplicationFailure.nonRetryable(`Activity not registered: ${activityType}`, 'NotFoundError'),
    )
  }

  const retry = options.retry ?? {}
  const initialMs = msFromDuration(retry.initialInterval ?? 1000)
  const maxIntervalMs = msOptionalFromDuration(retry.maximumInterval) ?? initialMs * 100
  const coefficient = retry.backoffCoefficient ?? 2
  const maxAttempts =
    retry.maximumAttempts && retry.maximumAttempts > 0
      ? retry.maximumAttempts
      : config.defaultMaxActivityAttempts
  const startToCloseMs = msOptionalFromDuration(options.startToCloseTimeout)
  const scheduleToCloseMs = msOptionalFromDuration(options.scheduleToCloseTimeout)
  const heartbeatTimeoutMs = msOptionalFromDuration(options.heartbeatTimeout)
  const scheduledAt = Date.now()
  const outerSignals = [scope.signal, execution.terminateSignal]

  let heartbeatDetails: unknown
  let lastFailure: Error | undefined

  for (let attempt = 1; ; attempt++) {
    if (outerSignals.some((s) => s.aborted)) {
      throw new ActivityFailure(
        'Activity cancelled',
        activityType,
        activityId,
        'CANCEL_REQUESTED',
        new CancelledFailure(),
      )
    }
    const release = await semaphoreFor(found.queue)
      .acquire(scope.signal)
      .catch(() => undefined)
    if (!release) continue

    const attemptController = new AbortController()
    const abortAttempt = (reason: Error) => {
      if (!attemptController.signal.aborted) attemptController.abort(reason)
    }
    const onOuterAbort = () => abortAttempt(new CancelledFailure())
    for (const s of outerSignals) s.addEventListener('abort', onOuterAbort, { once: true })

    const timers: NodeJS.Timeout[] = []
    const attemptState: { beat?: () => void } = {}
    const timeoutPromise = new Promise<never>((_, reject) => {
      const fail = (failure: Error) => {
        abortAttempt(failure)
        reject(failure)
      }
      if (startToCloseMs) {
        timers.push(
          setTimeout(
            () =>
              fail(
                new TimeoutFailure(
                  'Activity start-to-close timeout',
                  'START_TO_CLOSE',
                  heartbeatDetails,
                ),
              ),
            startToCloseMs,
          ),
        )
      }
      if (scheduleToCloseMs) {
        const remaining = scheduleToCloseMs - (Date.now() - scheduledAt)
        timers.push(
          setTimeout(
            () =>
              fail(
                new TimeoutFailure(
                  'Activity schedule-to-close timeout',
                  'SCHEDULE_TO_CLOSE',
                  heartbeatDetails,
                ),
              ),
            Math.max(0, remaining),
          ),
        )
      }
      if (heartbeatTimeoutMs) {
        let lastBeat = Date.now()
        attemptState.beat = () => (lastBeat = Date.now())
        timers.push(
          setInterval(
            () => {
              if (Date.now() - lastBeat > heartbeatTimeoutMs) {
                fail(
                  new TimeoutFailure('Activity heartbeat timeout', 'HEARTBEAT', heartbeatDetails),
                )
              }
            },
            Math.min(heartbeatTimeoutMs, 1000),
          ),
        )
      }
      attemptController.signal.addEventListener(
        'abort',
        () => {
          const reason = attemptController.signal.reason
          if (reason instanceof CancelledFailure) reject(reason)
        },
        { once: true },
      )
    })
    timeoutPromise.catch(() => undefined)

    const cancelled = abortPromise([attemptController.signal], () => new CancelledFailure())
    cancelled.catch(() => undefined)
    const activityCtx: ActivityContextValue = {
      cancellationSignal: attemptController.signal,
      cancelled,
      heartbeat: (details?: unknown) => {
        if (details !== undefined) heartbeatDetails = toPayload(details)
        attemptState.beat?.()
      },
      info: {
        activityId,
        activityType,
        attempt,
        currentAttemptScheduledTimestampMs: Date.now(),
        heartbeatDetails,
        heartbeatTimeoutMs,
        isLocal,
        scheduledTimestampMs: scheduledAt,
        scheduleToCloseTimeoutMs: scheduleToCloseMs,
        startToCloseTimeoutMs: startToCloseMs,
        taskQueue: found.queue,
        workflowExecution: { runId: execution.runId, workflowId: execution.workflowId },
        workflowNamespace: 'default',
        workflowType: execution.workflowType,
      },
      log: config.logger,
      sleep: (ms) => cancellableSleep(msFromDuration(ms), [attemptController.signal]),
    }

    try {
      const result = await Promise.race([
        // Activities run outside the workflow context, like on a real worker.
        workflowStorage.exit(() =>
          activityStorage.run(activityCtx, () =>
            runWithPropagated(execution.reqContext, () =>
              Promise.resolve().then(() => found.fn(...toPayload(args))),
            ),
          ),
        ),
        timeoutPromise,
      ])
      const payload = toPayload(result)
      execution.recordEvents(0, payload)
      return payload
    } catch (err) {
      if (outerSignals.some((s) => s.aborted)) {
        throw new ActivityFailure(
          'Activity cancelled',
          activityType,
          activityId,
          'CANCEL_REQUESTED',
          new CancelledFailure(),
        )
      }
      lastFailure =
        err instanceof TimeoutFailure || err instanceof ApplicationFailure
          ? err
          : ApplicationFailure.fromError(err)
      const exhausted = attempt >= maxAttempts
      const outOfTime =
        scheduleToCloseMs !== undefined && Date.now() - scheduledAt >= scheduleToCloseMs
      if (exhausted || outOfTime || isNonRetryable(lastFailure, retry.nonRetryableErrorTypes)) {
        config.logger.warn(
          `[workflow-engine] activity ${activityType} failed after ${attempt} attempt(s): ${lastFailure.message}`,
        )
        throw new ActivityFailure(
          'Activity task failed',
          activityType,
          activityId,
          exhausted ? 'MAXIMUM_ATTEMPTS_REACHED' : 'NON_RETRYABLE_FAILURE',
          lastFailure,
        )
      }
      const delay = Math.min(initialMs * coefficient ** (attempt - 1), maxIntervalMs)
      config.logger.warn(
        `[workflow-engine] activity ${activityType} attempt ${attempt} failed, retrying in ${delay}ms: ${lastFailure.message}`,
      )
      release()
      try {
        await cancellableSleep(delay, outerSignals)
      } catch {
        // Cancelled during backoff: the next loop iteration throws ActivityFailure.
      }
    } finally {
      release()
      for (const t of timers) clearTimeout(t)
      for (const s of outerSignals) s.removeEventListener('abort', onOuterAbort)
      queueMicrotask(() => execution.notify())
    }
  }
}

// ---------- handler delivery (signals / queries / updates) ----------

function inExecution<T>(execution: Execution, fn: () => T): T {
  return workflowStorage.run({ execution, scope: execution.rootScope }, () =>
    runWithPropagated(execution.reqContext, fn),
  )
}

function trackHandler(execution: Execution, result: unknown): void {
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    ;(result as Promise<unknown>)
      .catch((err: unknown) =>
        config.logger.error(
          `[workflow-engine] signal handler failed in ${execution.workflowType}: ${String(err)}`,
        ),
      )
      .finally(() => execution.notify())
  }
}

export function deliverSignal(execution: Execution, name: string, rawArgs: unknown[]): void {
  if (!execution.isRunning) {
    throw new WorkflowNotFoundError(
      `Workflow execution already completed: ${execution.workflowId}`,
      execution.workflowId,
      execution.runId,
    )
  }
  const args = toPayload(rawArgs)
  execution.recordEvents(1, args)
  const handler = execution.signalHandlers.get(name)
  if (!handler) {
    const queue = execution.pendingSignals.get(name) ?? []
    queue.push(args)
    execution.pendingSignals.set(name, queue)
    return
  }
  const result = inExecution(execution, () => handler(...args))
  trackHandler(execution, result)
  execution.notify()
}

export function flushPendingSignals(execution: Execution, name: string): void {
  const queued = execution.pendingSignals.get(name)
  const handler = execution.signalHandlers.get(name)
  if (!queued?.length || !handler) return
  execution.pendingSignals.delete(name)
  for (const args of queued) trackHandler(execution, handler(...args))
  execution.notify()
}

export function runQuery(execution: Execution, name: string, args: unknown[]): unknown {
  const handler = execution.queryHandlers.get(name)
  if (!handler) throw new QueryNotRegisteredError(name)
  return toPayload(inExecution(execution, () => handler(...toPayload(args))))
}

const UPDATE_HANDLER_WAIT_MS = 10_000

export async function runUpdate(
  execution: Execution,
  name: string,
  rawArgs: unknown[],
): Promise<unknown> {
  if (!execution.isRunning) {
    throw new WorkflowUpdateFailedError(
      'Workflow execution is not running',
      new ApplicationFailure('Workflow execution is not running', 'NotRunning', true),
    )
  }
  let entry = execution.updateHandlers.get(name)
  if (!entry) {
    // Updates that race handler registration wait briefly, then reject like an unknown update.
    await new Promise<void>((resolve) => {
      const waiters = execution.pendingUpdates.get(name) ?? []
      waiters.push(resolve)
      execution.pendingUpdates.set(name, waiters)
      setTimeout(resolve, UPDATE_HANDLER_WAIT_MS).unref?.()
    })
    entry = execution.updateHandlers.get(name)
    if (!entry) {
      throw new WorkflowUpdateFailedError(
        `Update "${name}" is not registered`,
        new ApplicationFailure(`Update "${name}" is not registered`, 'UpdateNotRegistered', true),
      )
    }
  }
  const args = toPayload(rawArgs)
  execution.recordEvents(2, args)
  const { handler, validator } = entry
  try {
    if (validator) inExecution(execution, () => validator(...args))
    const result = await inExecution(execution, () => handler(...args))
    return toPayload(result)
  } catch (err) {
    const failure = err instanceof ApplicationFailure ? err : ApplicationFailure.fromError(err)
    throw new WorkflowUpdateFailedError('Workflow update failed', failure)
  } finally {
    execution.notify()
  }
}

export function flushPendingUpdates(execution: Execution, name: string): void {
  const waiters = execution.pendingUpdates.get(name)
  if (!waiters) return
  execution.pendingUpdates.delete(name)
  for (const resolve of waiters) resolve()
}

// ---------- child workflows ----------

export interface ChildHandleState {
  execution: Execution
}

export async function awaitChildResult(child: Execution): Promise<unknown> {
  try {
    return await awaitResult(child)
  } catch (err) {
    const cause = err instanceof WorkflowFailedError ? err.cause : (err as Error)
    throw new ChildWorkflowFailure(
      { runId: child.runId, workflowId: child.workflowId },
      child.workflowType,
      cause,
    )
  }
}
