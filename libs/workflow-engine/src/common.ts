/**
 * Shared types, failures and enums for the in-process workflow engine.
 *
 * The API mirrors the subset of the Temporal TypeScript SDK the codebase was
 * written against, so workflow and activity code reads the same, but nothing
 * here talks to a Temporal server: workflows run as async functions in the
 * current Node process.
 */

export type Duration = number | string

const UNIT_MS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
}

/** Parses `5000`, `'5s'`, `'10 minutes'` or `'1.5h'` into milliseconds. */
export function msFromDuration(duration: Duration): number {
  if (typeof duration === 'number') return duration
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(duration)
  if (!match) throw new TypeError(`Invalid duration: ${duration}`)
  const unit = (match[2] || 'ms').toLowerCase()
  const factor = UNIT_MS[unit]
  if (factor === undefined) throw new TypeError(`Invalid duration unit: ${duration}`)
  return Number(match[1]) * factor
}

export function msOptionalFromDuration(duration?: Duration): number | undefined {
  return duration === undefined ? undefined : msFromDuration(duration)
}

export interface RetryPolicy {
  backoffCoefficient?: number
  initialInterval?: Duration
  maximumAttempts?: number
  maximumInterval?: Duration
  nonRetryableErrorTypes?: string[]
}

export interface ActivityOptions {
  activityId?: string
  cancellationType?: unknown
  heartbeatTimeout?: Duration
  priority?: unknown
  retry?: RetryPolicy
  scheduleToCloseTimeout?: Duration
  scheduleToStartTimeout?: Duration
  startToCloseTimeout?: Duration
  summary?: string
  taskQueue?: string
}

export type LocalActivityOptions = ActivityOptions & { localRetryThreshold?: Duration }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the SDK's untyped shape
export type UntypedActivities = Record<string, (...args: any[]) => Promise<any>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- workflow functions take any args
export type Workflow = (...args: any[]) => Promise<any>

export type WorkflowResultType<W extends Workflow> = Awaited<ReturnType<W>>

export type WithWorkflowArgs<W extends Workflow, T> = T &
  (Parameters<W> extends [] ? { args?: [] } : { args: Parameters<W> })

export type Headers = Record<string, unknown>

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  trace(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

export enum WorkflowIdReusePolicy {
  ALLOW_DUPLICATE = 'ALLOW_DUPLICATE',
  ALLOW_DUPLICATE_FAILED_ONLY = 'ALLOW_DUPLICATE_FAILED_ONLY',
  REJECT_DUPLICATE = 'REJECT_DUPLICATE',
  TERMINATE_IF_RUNNING = 'TERMINATE_IF_RUNNING',
}

export enum WorkflowIdConflictPolicy {
  FAIL = 'FAIL',
  TERMINATE_EXISTING = 'TERMINATE_EXISTING',
  USE_EXISTING = 'USE_EXISTING',
}

export enum ParentClosePolicy {
  ABANDON = 'ABANDON',
  REQUEST_CANCEL = 'REQUEST_CANCEL',
  TERMINATE = 'TERMINATE',
}

// ---------- failures ----------

export class WorkflowFailure extends Error {
  public override readonly cause?: Error

  constructor(message?: string, cause?: Error) {
    super(message ?? '')
    this.cause = cause
    this.name = new.target.name
  }
}

export class ApplicationFailure extends WorkflowFailure {
  public readonly details?: unknown[]
  public readonly nonRetryable: boolean
  public readonly type?: string

  constructor(
    message?: string,
    type?: string,
    nonRetryable = false,
    details?: unknown[],
    cause?: Error,
  ) {
    super(message, cause)
    this.type = type
    this.nonRetryable = nonRetryable
    this.details = details
  }

  static create(options: {
    cause?: Error
    details?: unknown[]
    message?: string
    nonRetryable?: boolean
    type?: string
  }): ApplicationFailure {
    return new ApplicationFailure(
      options.message,
      options.type,
      options.nonRetryable ?? false,
      options.details,
      options.cause,
    )
  }

  static fromError(error: unknown, options?: { nonRetryable?: boolean; type?: string }) {
    if (error instanceof ApplicationFailure) return error
    const err = error instanceof Error ? error : new Error(String(error))
    const failure = new ApplicationFailure(
      err.message,
      options?.type ?? err.name,
      options?.nonRetryable ?? false,
      undefined,
      err,
    )
    failure.stack = err.stack
    return failure
  }

  static nonRetryable(message?: string, type?: string, ...details: unknown[]) {
    return new ApplicationFailure(message, type ?? 'Error', true, details)
  }

  static retryable(message?: string, type?: string, ...details: unknown[]) {
    return new ApplicationFailure(message, type ?? 'Error', false, details)
  }
}

export class CancelledFailure extends WorkflowFailure {
  constructor(message = 'Cancelled', cause?: Error) {
    super(message, cause)
  }
}

export class TerminatedFailure extends WorkflowFailure {
  constructor(message = 'Terminated', cause?: Error) {
    super(message, cause)
  }
}

export type TimeoutType = 'HEARTBEAT' | 'SCHEDULE_TO_CLOSE' | 'SCHEDULE_TO_START' | 'START_TO_CLOSE'

export class TimeoutFailure extends WorkflowFailure {
  constructor(
    message: string,
    public readonly timeoutType: TimeoutType,
    public readonly lastHeartbeatDetails?: unknown,
  ) {
    super(message)
  }
}

export class ActivityFailure extends WorkflowFailure {
  constructor(
    message: string,
    public readonly activityType: string,
    public readonly activityId: string,
    public readonly retryState: string,
    cause?: Error,
  ) {
    super(message, cause)
  }
}

export class ChildWorkflowFailure extends WorkflowFailure {
  constructor(
    public readonly execution: { runId: string; workflowId: string },
    public readonly workflowType: string,
    cause?: Error,
  ) {
    super('Child Workflow execution failed', cause)
  }
}

export class WorkflowFailedError extends Error {
  constructor(
    message: string,
    public override readonly cause: Error | undefined,
    public readonly retryState = 'NON_RETRYABLE_FAILURE',
  ) {
    super(message)
    this.name = 'WorkflowFailedError'
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly runId?: string,
  ) {
    super(message)
    this.name = 'WorkflowNotFoundError'
  }
}

export class WorkflowExecutionAlreadyStartedError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly workflowType: string,
  ) {
    super(message)
    this.name = 'WorkflowExecutionAlreadyStartedError'
  }
}

export class WorkflowUpdateFailedError extends Error {
  constructor(
    message: string,
    public override readonly cause: Error | undefined,
  ) {
    super(message)
    this.name = 'WorkflowUpdateFailedError'
  }
}

export class WorkflowUpdateRPCTimeoutOrCancelledError extends Error {
  constructor(message = 'Workflow update call timed out or was cancelled') {
    super(message)
    this.name = 'WorkflowUpdateRPCTimeoutOrCancelledError'
  }
}

export class QueryNotRegisteredError extends Error {
  constructor(queryType: string) {
    super(`Query "${queryType}" is not registered`)
    this.name = 'QueryNotRegisteredError'
  }
}

export class IllegalStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalStateError'
  }
}

/** Walks `.cause` to the innermost failure's message. */
export function rootCause(err: unknown): string | undefined {
  let current: unknown = err
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  return current instanceof Error ? current.message : undefined
}

export function isCancellation(err: unknown): boolean {
  if (err instanceof CancelledFailure) return true
  if (err instanceof ActivityFailure || err instanceof ChildWorkflowFailure) {
    return err.cause instanceof CancelledFailure
  }
  return false
}

/** Round-trips a value through JSON, the way the SDK's payload converter would. */
export function toPayload<T>(value: T): T {
  if (value === undefined || value === null) return value
  if (value instanceof Uint8Array) return value
  return JSON.parse(JSON.stringify(value)) as T
}
