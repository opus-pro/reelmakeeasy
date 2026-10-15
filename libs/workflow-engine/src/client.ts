import {
  ApplicationFailure,
  type Workflow,
  type WorkflowIdConflictPolicy,
  type WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type WorkflowResultType,
} from './common'
import {
  allRuns,
  awaitResult,
  cancelRun,
  deliverSignal,
  type Execution,
  type ExecutionStatus,
  findRun,
  latestRun,
  runQuery,
  runUpdate,
  startWorkflow,
  terminateRun,
} from './engine'

export {
  type Workflow,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
  WorkflowUpdateRPCTimeoutOrCancelledError,
} from './common'

type NamedDefinition = string | { name: string }
const nameOf = (def: NamedDefinition) => (typeof def === 'string' ? def : def.name)

export interface WorkflowStartOptions {
  args?: unknown[]
  memo?: Record<string, unknown>
  retry?: unknown
  searchAttributes?: Record<string, unknown>
  taskQueue: string
  workflowExecutionTimeout?: number | string
  workflowId: string
  workflowIdConflictPolicy?: WorkflowIdConflictPolicy
  workflowIdReusePolicy?: WorkflowIdReusePolicy
  workflowRunTimeout?: number | string
}

export interface WorkflowSignalWithStartOptions extends WorkflowStartOptions {
  signal: NamedDefinition
  signalArgs?: unknown[]
}

export interface WorkflowExecutionDescription {
  closeTime?: Date
  executionTime: Date
  historyLength: number
  memo?: Record<string, unknown>
  parentExecution?: { runId: string; workflowId: string }
  runId: string
  searchAttributes: Record<string, unknown>
  startTime: Date
  status: { code: number; name: ExecutionStatus }
  taskQueue: string
  type: string
  workflowId: string
}

const STATUS_CODES: Record<ExecutionStatus, number> = {
  CANCELLED: 4,
  COMPLETED: 2,
  CONTINUED_AS_NEW: 6,
  FAILED: 3,
  RUNNING: 1,
  TERMINATED: 5,
  TIMED_OUT: 7,
}

function describeRun(run: Execution): WorkflowExecutionDescription {
  return {
    closeTime: run.closeTime,
    executionTime: run.startTime,
    historyLength: run.historyLength,
    memo: run.memo,
    parentExecution: run.parent,
    runId: run.runId,
    searchAttributes: run.searchAttributes ?? {},
    startTime: run.startTime,
    status: { code: STATUS_CODES[run.status], name: run.status },
    taskQueue: run.taskQueue,
    type: run.workflowType,
    workflowId: run.workflowId,
  }
}

export class WorkflowHandle<W extends Workflow = Workflow> {
  constructor(
    public readonly workflowId: string,
    public readonly runId?: string,
    public readonly firstExecutionRunId?: string,
  ) {}

  private resolve(): Execution {
    const run = findRun(this.workflowId, this.runId)
    if (!run) {
      throw new WorkflowNotFoundError(
        `Workflow not found: ${this.workflowId}`,
        this.workflowId,
        this.runId,
      )
    }
    return run
  }

  /** Targets the latest run unless a run id was pinned, following continue-as-new. */
  private resolveActive(): Execution {
    let run = this.resolve()
    while (!this.runId && run.nextRun) run = run.nextRun
    return run
  }

  async cancel(): Promise<void> {
    cancelRun(this.resolveActive())
  }

  async describe(): Promise<WorkflowExecutionDescription> {
    return describeRun(this.resolveActive())
  }

  async executeUpdate<Ret = unknown>(
    def: NamedDefinition,
    options?: { args?: unknown[]; updateId?: string },
  ): Promise<Ret> {
    return (await runUpdate(this.resolveActive(), nameOf(def), options?.args ?? [])) as Ret
  }

  async query<Ret = unknown>(def: NamedDefinition, ...args: unknown[]): Promise<Ret> {
    return runQuery(this.resolveActive(), nameOf(def), args) as Ret
  }

  async result(): Promise<WorkflowResultType<W>> {
    return (await awaitResult(this.resolve(), !this.runId)) as WorkflowResultType<W>
  }

  async signal(def: NamedDefinition, ...args: unknown[]): Promise<void> {
    deliverSignal(this.resolveActive(), nameOf(def), args)
  }

  async terminate(reason?: string): Promise<void> {
    terminateRun(this.resolveActive(), reason)
  }
}

export type WorkflowHandleWithFirstExecutionRunId<W extends Workflow = Workflow> =
  WorkflowHandle<W> & {
    firstExecutionRunId: string
  }

function workflowTypeName(workflowTypeOrFn: string | Workflow): string {
  return typeof workflowTypeOrFn === 'string' ? workflowTypeOrFn : workflowTypeOrFn.name
}

/**
 * Minimal visibility query support: `Field='value'` clauses joined by AND over
 * ExecutionStatus, TaskQueue, WorkflowType and WorkflowId.
 */
function matchesQuery(run: Execution, query?: string): boolean {
  if (!query?.trim()) return true
  const clauses = query.split(/\s+AND\s+/i)
  return clauses.every((clause) => {
    const m = /^\s*(\w+)\s*=\s*['"]([^'"]*)['"]\s*$/.exec(clause)
    if (!m)
      throw new ApplicationFailure(`Unsupported visibility query: ${query}`, 'InvalidQuery', true)
    const [, field, value] = m
    switch (field) {
      case 'ExecutionStatus':
        return run.status.toLowerCase() === value!.toLowerCase().replace(/\s/g, '_')
      case 'TaskQueue':
        return run.taskQueue === value
      case 'WorkflowId':
        return run.workflowId === value
      case 'WorkflowType':
        return run.workflowType === value
      default:
        throw new ApplicationFailure(`Unsupported visibility field: ${field}`, 'InvalidQuery', true)
    }
  })
}

export class WorkflowClient {
  async count(query?: string): Promise<{ count: number }> {
    return { count: allRuns().filter((r) => matchesQuery(r, query)).length }
  }

  async execute<W extends Workflow>(
    workflowTypeOrFn: string | W,
    options: WorkflowStartOptions,
  ): Promise<WorkflowResultType<W>> {
    const handle = await this.start<W>(workflowTypeOrFn, options)
    return handle.result()
  }

  getHandle<W extends Workflow = Workflow>(
    workflowId: string,
    runId?: string,
    options?: { firstExecutionRunId?: string },
  ): WorkflowHandle<W> {
    return new WorkflowHandle<W>(workflowId, runId, options?.firstExecutionRunId)
  }

  async *list(options?: { query?: string }): AsyncIterable<WorkflowExecutionDescription> {
    for (const run of allRuns()) {
      if (matchesQuery(run, options?.query)) yield describeRun(run)
    }
  }

  async signalWithStart<W extends Workflow>(
    workflowTypeOrFn: string | W,
    options: WorkflowSignalWithStartOptions,
  ): Promise<WorkflowHandleWithFirstExecutionRunId<W>> {
    const running = latestRun(options.workflowId)
    const run =
      running?.isRunning === true
        ? running
        : startWorkflow(workflowTypeName(workflowTypeOrFn), options)
    deliverSignal(run, nameOf(options.signal), options.signalArgs ?? [])
    return Object.assign(new WorkflowHandle<W>(run.workflowId, undefined, run.firstRunId), {
      firstExecutionRunId: run.firstRunId,
    })
  }

  async start<W extends Workflow>(
    workflowTypeOrFn: string | W,
    options: WorkflowStartOptions,
  ): Promise<WorkflowHandleWithFirstExecutionRunId<W>> {
    const run = startWorkflow(workflowTypeName(workflowTypeOrFn), options)
    return Object.assign(new WorkflowHandle<W>(run.workflowId, undefined, run.firstRunId), {
      firstExecutionRunId: run.firstRunId,
    })
  }
}

/** The engine is in-process, so there is nothing to connect to. */
export class Connection {
  /** Calls are in-process, so deadlines never apply. */
  async withDeadline<T>(_deadline: Date | number, fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}

export class Client {
  public readonly connection = new Connection()
  public readonly workflow = new WorkflowClient()
}
