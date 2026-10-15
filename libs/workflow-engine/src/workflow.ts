import { randomUUID } from 'node:crypto'

import {
  type ActivityOptions,
  CancelledFailure,
  type Duration,
  type LocalActivityOptions,
  msFromDuration,
  ParentClosePolicy,
  type UntypedActivities,
  type Workflow,
  type WorkflowIdConflictPolicy,
  type WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type WorkflowResultType,
} from './common'
import {
  awaitChildResult,
  cancellableSleep,
  cancelRun,
  ContinueAsNew,
  currentWorkflowContext,
  deliverSignal,
  engineLogger,
  type Execution,
  findRun,
  flushPendingSignals,
  flushPendingUpdates,
  runActivity,
  Scope,
  startWorkflow,
  workflowStorage,
} from './engine'

export {
  ActivityFailure,
  type ActivityOptions,
  ApplicationFailure,
  CancelledFailure,
  ChildWorkflowFailure,
  type Duration,
  isCancellation,
  ParentClosePolicy,
  rootCause,
  TimeoutFailure,
  type Workflow,
  WorkflowFailure,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from './common'

// ---------- definitions ----------

export interface QueryDefinition<
  Ret = unknown,
  Args extends unknown[] = [],
  Name extends string = string,
> {
  __args?: Args
  __ret?: Ret
  name: Name
  type: 'query'
}
export interface SignalDefinition<Args extends unknown[] = [], Name extends string = string> {
  __args?: Args
  name: Name
  type: 'signal'
}
export interface UpdateDefinition<
  Ret = unknown,
  Args extends unknown[] = [],
  Name extends string = string,
> {
  __args?: Args
  __ret?: Ret
  name: Name
  type: 'update'
}

type AnyDefinition =
  | QueryDefinition<unknown, never[]>
  | SignalDefinition<never[]>
  | UpdateDefinition<unknown, never[]>

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handler arity follows the definition
type AnyHandler = (...args: any[]) => any

export function defineQuery<
  Ret = unknown,
  Args extends unknown[] = [],
  Name extends string = string,
>(name: Name): QueryDefinition<Ret, Args, Name> {
  return { name, type: 'query' }
}

export function defineSignal<Args extends unknown[] = [], Name extends string = string>(
  name: Name,
): SignalDefinition<Args, Name> {
  return { name, type: 'signal' }
}

export function defineUpdate<
  Ret = unknown,
  Args extends unknown[] = [],
  Name extends string = string,
>(name: Name): UpdateDefinition<Ret, Args, Name> {
  return { name, type: 'update' }
}

export function setHandler(
  def: AnyDefinition | { name: string; type: 'query' | 'signal' | 'update' },
  handler: AnyHandler | undefined,
  options?: { description?: string; validator?: AnyHandler },
): void {
  const { execution } = currentWorkflowContext()
  if (def.type === 'signal') {
    if (handler) {
      execution.signalHandlers.set(def.name, handler)
      flushPendingSignals(execution, def.name)
    } else execution.signalHandlers.delete(def.name)
  } else if (def.type === 'query') {
    if (handler) execution.queryHandlers.set(def.name, handler)
    else execution.queryHandlers.delete(def.name)
  } else if (handler) {
    execution.updateHandlers.set(def.name, { handler, validator: options?.validator })
    flushPendingUpdates(execution, def.name)
  } else execution.updateHandlers.delete(def.name)
}

// ---------- info / misc ----------

export interface WorkflowInfo {
  attempt: number
  continueAsNewSuggested: boolean
  continuedFromExecutionRunId?: string
  firstExecutionRunId: string
  historyLength: number
  historySize: number
  memo?: Record<string, unknown>
  namespace: string
  parent?: { namespace: string; runId: string; workflowId: string }
  runId: string
  runStartTime: Date
  searchAttributes: Record<string, unknown>
  startTime: Date
  taskQueue: string
  unsafe: { isReplaying: boolean; now: () => number }
  workflowId: string
  workflowType: string
}

export function inWorkflowContext(): boolean {
  return workflowStorage.getStore() !== undefined
}

export function workflowInfo(): WorkflowInfo {
  return infoOf(currentWorkflowContext().execution)
}

function infoOf(execution: Execution): WorkflowInfo {
  return {
    attempt: 1,
    continueAsNewSuggested: execution.continueAsNewSuggested,
    continuedFromExecutionRunId: execution.continuedFromRunId,
    firstExecutionRunId: execution.firstRunId,
    historyLength: execution.historyLength,
    historySize: execution.historySize,
    memo: execution.memo,
    namespace: 'default',
    parent: execution.parent && { namespace: 'default', ...execution.parent },
    runId: execution.runId,
    runStartTime: execution.startTime,
    searchAttributes: execution.searchAttributes ?? {},
    startTime: execution.startTime,
    taskQueue: execution.taskQueue,
    unsafe: { isReplaying: false, now: () => Date.now() },
    workflowId: execution.workflowId,
    workflowType: execution.workflowType,
  }
}

/**
 * Per-run state that would otherwise sit in module variables. In-process runs
 * share modules, so such state lives here instead, scoped to the current run.
 */
export function getRunLocal<T>(key: unknown): T | undefined {
  return currentWorkflowContext().execution.locals.get(key) as T | undefined
}

export function setRunLocal(key: unknown, value: unknown): void {
  currentWorkflowContext().execution.locals.set(key, value)
}

export function uuid4(): string {
  return randomUUID()
}

function logWith(level: 'debug' | 'error' | 'info' | 'trace' | 'warn') {
  return (message: string, attrs?: Record<string, unknown>) => {
    const ctx = workflowStorage.getStore()
    const meta = ctx
      ? { workflowId: ctx.execution.workflowId, workflowType: ctx.execution.workflowType, ...attrs }
      : attrs
    engineLogger()[level](message, meta)
  }
}

export const log = {
  debug: logWith('debug'),
  error: logWith('error'),
  info: logWith('info'),
  trace: logWith('trace'),
  warn: logWith('warn'),
}

// ---------- sinks ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sinks = Record<string, Record<string, (...args: any[]) => void>>

const LOG_LEVELS = new Set(['debug', 'error', 'fatal', 'info', 'trace', 'warn'])

/**
 * Sinks forward to the engine logger. `logger` sink calls log their arguments
 * (the first one is a trace id in this codebase); anything else is a no-op.
 */
export function proxySinks<T extends Sinks>(): T {
  return new Proxy({} as T, {
    get(_, sinkName) {
      return new Proxy(
        {},
        {
          get(__, fnName) {
            return (...args: unknown[]) => {
              if (sinkName !== 'logger' || typeof fnName !== 'string' || !LOG_LEVELS.has(fnName))
                return
              const [first, ...rest] = args
              const parts = typeof first === 'string' && typeof rest[0] === 'string' ? rest : args
              const level = fnName === 'fatal' ? 'error' : (fnName as 'info')
              logWith(level)(parts.map(String).join(' '))
            }
          },
        },
      )
    },
  })
}

// ---------- timers / conditions ----------

export function condition(fn: () => boolean, timeout: Duration): Promise<boolean>

export function condition(fn: () => boolean): Promise<void>
export function condition(fn: () => boolean, timeout?: Duration): Promise<boolean | void> {
  const { execution, scope } = currentWorkflowContext()
  const hasTimeout = timeout !== undefined
  if (fn()) return Promise.resolve(hasTimeout ? true : undefined)

  return new Promise<boolean | void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const signals = [scope.signal, execution.terminateSignal]
    const cleanup = () => {
      execution.removeWaiter(waiter)
      if (timer) clearTimeout(timer)
      for (const s of signals) s.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new CancelledFailure())
    }
    const waiter = {
      check() {
        let ok = false
        try {
          ok = fn()
        } catch (err) {
          cleanup()
          reject(err)
          return
        }
        if (ok) {
          cleanup()
          resolve(hasTimeout ? true : undefined)
        }
      },
    }
    for (const s of signals) {
      if (s.aborted) return onAbort()
      s.addEventListener('abort', onAbort, { once: true })
    }
    execution.addWaiter(waiter)
    if (hasTimeout) {
      execution.recordEvents(2)
      timer = setTimeout(() => {
        cleanup()
        resolve(false)
      }, msFromDuration(timeout))
    }
  })
}
export async function sleep(duration: Duration): Promise<void> {
  const { execution, scope } = currentWorkflowContext()
  execution.recordEvents(2)
  try {
    await cancellableSleep(msFromDuration(duration), [scope.signal, execution.terminateSignal])
  } finally {
    execution.notify()
  }
}

// ---------- cancellation scopes ----------

export class CancellationScope {
  private readonly scope: Scope
  private readonly timeoutMs?: number

  constructor(options?: { cancellable?: boolean; parent?: CancellationScope; timeout?: Duration }) {
    const parent = options?.parent?.scope ?? workflowStorage.getStore()?.scope
    this.scope = new Scope(parent, options?.cancellable ?? true)
    this.timeoutMs = options?.timeout === undefined ? undefined : msFromDuration(options.timeout)
  }

  static current(): CancellationScope {
    const ctx = currentWorkflowContext()
    const wrapper = Object.create(CancellationScope.prototype) as CancellationScope
    ;(wrapper as unknown as { scope: Scope }).scope = ctx.scope
    return wrapper
  }

  static cancellable<T>(fn: () => Promise<T>): Promise<T> {
    return new CancellationScope({ cancellable: true }).run(fn)
  }

  static nonCancellable<T>(fn: () => Promise<T>): Promise<T> {
    return new CancellationScope({ cancellable: false }).run(fn)
  }

  static withTimeout<T>(timeout: Duration, fn: () => Promise<T>): Promise<T> {
    return new CancellationScope({ cancellable: true, timeout }).run(fn)
  }

  get cancelRequested(): Promise<never> {
    return this.scope.cancelRequested
  }

  get consideredCancelled(): boolean {
    return this.scope.consideredCancelled
  }

  cancel(): void {
    this.scope.cancel()
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const { execution } = currentWorkflowContext()
    let timer: NodeJS.Timeout | undefined
    if (this.timeoutMs !== undefined) timer = setTimeout(() => this.scope.cancel(), this.timeoutMs)
    return workflowStorage
      .run({ execution, scope: this.scope }, fn)
      .finally(() => timer && clearTimeout(timer))
  }
}

// ---------- activities ----------

type ActivityInterfaceFor<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

export function proxyActivities<A = UntypedActivities>(
  options: ActivityOptions,
): ActivityInterfaceFor<A> {
  return new Proxy({} as ActivityInterfaceFor<A>, {
    get(_, name) {
      if (typeof name !== 'string') return undefined
      return (...args: unknown[]) => runActivity(currentWorkflowContext(), name, args, options)
    },
  })
}

export function proxyLocalActivities<A = UntypedActivities>(
  options: LocalActivityOptions,
): ActivityInterfaceFor<A> {
  return new Proxy({} as ActivityInterfaceFor<A>, {
    get(_, name) {
      if (typeof name !== 'string') return undefined
      return (...args: unknown[]) =>
        runActivity(currentWorkflowContext(), name, args, options, true)
    },
  })
}

export function scheduleActivity<R>(
  activityType: string,
  args: unknown[],
  options: ActivityOptions,
): Promise<R> {
  return runActivity(currentWorkflowContext(), activityType, args, options) as Promise<R>
}

export function scheduleLocalActivity<R>(
  activityType: string,
  args: unknown[],
  options: LocalActivityOptions,
): Promise<R> {
  return runActivity(currentWorkflowContext(), activityType, args, options, true) as Promise<R>
}

// ---------- child / external workflows ----------

export interface ChildWorkflowHandle<W extends Workflow = Workflow> {
  firstExecutionRunId: string
  result(): Promise<WorkflowResultType<W>>
  signal<Args extends unknown[]>(def: SignalDefinition<Args> | string, ...args: Args): Promise<void>
  workflowId: string
}

export interface ChildWorkflowOptions {
  args?: unknown[]
  cancellationType?: unknown
  memo?: Record<string, unknown>
  parentClosePolicy?: ParentClosePolicy
  retry?: unknown
  searchAttributes?: Record<string, unknown>
  taskQueue?: string
  workflowExecutionTimeout?: Duration
  workflowId?: string
  workflowIdConflictPolicy?: WorkflowIdConflictPolicy
  workflowIdReusePolicy?: WorkflowIdReusePolicy
  workflowRunTimeout?: Duration
}

export interface ExternalWorkflowHandle {
  cancel(): Promise<void>
  runId?: string
  signal<Args extends unknown[]>(def: SignalDefinition<Args> | string, ...args: Args): Promise<void>
  workflowId: string
}

export async function executeChild<W extends Workflow = Workflow>(
  workflowTypeOrFn: string | W,
  options: ChildWorkflowOptions = {},
): Promise<WorkflowResultType<W>> {
  const handle = await startChild<W>(workflowTypeOrFn, options)
  return handle.result()
}

export function getExternalWorkflowHandle(
  workflowId: string,
  runId?: string,
): ExternalWorkflowHandle {
  const resolve = () => {
    const run = findRun(workflowId, runId)
    if (!run)
      throw new WorkflowNotFoundError(`Workflow not found: ${workflowId}`, workflowId, runId)
    return run as Execution
  }
  return {
    cancel: async () => cancelRun(resolve()),
    runId,
    signal: async (def, ...args) =>
      deliverSignal(resolve(), typeof def === 'string' ? def : def.name, args),
    workflowId,
  }
}

export async function startChild<W extends Workflow = Workflow>(
  workflowTypeOrFn: string | W,
  options: ChildWorkflowOptions = {},
): Promise<ChildWorkflowHandle<W>> {
  const ctx = currentWorkflowContext()
  const child = startWorkflow(
    workflowTypeName(workflowTypeOrFn),
    {
      args: options.args,
      memo: options.memo,
      searchAttributes: options.searchAttributes,
      taskQueue: options.taskQueue ?? ctx.execution.taskQueue,
      workflowId: options.workflowId ?? uuid4(),
      workflowIdConflictPolicy: options.workflowIdConflictPolicy,
      workflowIdReusePolicy: options.workflowIdReusePolicy,
    },
    {
      parent: ctx.execution,
      policy: options.parentClosePolicy ?? ParentClosePolicy.TERMINATE,
      scope: ctx.scope,
    },
  )
  return {
    firstExecutionRunId: child.firstRunId,
    result: async () => {
      try {
        return (await awaitChildResult(child)) as WorkflowResultType<W>
      } finally {
        ctx.execution.notify()
      }
    },
    signal: async (def, ...args) => {
      deliverSignal(child, typeof def === 'string' ? def : def.name, args)
    },
    workflowId: child.workflowId,
  }
}

function workflowTypeName(workflowTypeOrFn: string | Workflow): string {
  return typeof workflowTypeOrFn === 'string' ? workflowTypeOrFn : workflowTypeOrFn.name
}

// ---------- continue-as-new ----------

export async function continueAsNew<W extends Workflow = Workflow>(
  ...args: Parameters<W>
): Promise<never> {
  throw new ContinueAsNew(args)
}
