import type { ActivityOptions, Duration, RetryPolicy } from '@reelmakeeasy/workflow-engine/common'
import * as workflow from '@reelmakeeasy/workflow-engine/workflow'
import type { ParentClosePolicy } from '@reelmakeeasy/workflow-engine/workflow'

import { getChildWorkflowID } from './naming'
import { buildCompatibleTaskRequest, parseResponse } from './req'
import type {
  BaseJobContext,
  CompatibleTaskRequest,
  CompatibleTaskResponse,
  ReqContext,
} from './types'

const METADATA_TYPE = Symbol('metadata:workflow:type')
const METADATA_OPTIONS = Symbol('metadata:workflow:options')

const metadataStore = new WeakMap<object, Map<string | symbol | undefined, Map<symbol, unknown>>>()

function getMetadata<T>(key: symbol, target: object, propertyKey?: string | symbol): T | undefined {
  return metadataStore.get(target)?.get(propertyKey)?.get(key) as T | undefined
}

function setMetadata(key: symbol, value: unknown, target: object, propertyKey?: string | symbol) {
  let targetStore = metadataStore.get(target)
  if (!targetStore) {
    targetStore = new Map()
    metadataStore.set(target, targetStore)
  }
  let propertyStore = targetStore.get(propertyKey)
  if (!propertyStore) {
    propertyStore = new Map()
    targetStore.set(propertyKey, propertyStore)
  }
  propertyStore.set(key, value)
}

/** Marks a service method as an activity and records its default options. */
export function DefineActivity(options?: ActivityOptions) {
  const defaultOptions: ActivityOptions = {
    heartbeatTimeout: '30 seconds',
    scheduleToCloseTimeout: '1 day',
    startToCloseTimeout: '10 minutes',
    ...options,
  }
  return function (_target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    setMetadata(METADATA_TYPE, 'Activity', descriptor.value, propertyKey)
    setMetadata(METADATA_OPTIONS, defaultOptions, descriptor.value, propertyKey)
  }
}

export function DefineWorkflow(_options?: Record<string, never>) {
  return function (_target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    setMetadata(METADATA_TYPE, 'Workflow', descriptor.value, propertyKey)
  }
}

export function parseCompatibleRequest<Payload extends object, Context extends BaseJobContext>(
  obj: CompatibleTaskRequest<Payload, Context>,
): {
  context: Context
  payload: Payload
  wrapResponse: <R extends object>(response: R) => CompatibleTaskResponse<R>
} {
  if (
    typeof obj === 'object' &&
    !!obj &&
    'context' in obj &&
    ('payload' in obj || Object.keys(obj).length === 1)
  ) {
    return { context: obj.context, payload: obj.payload, wrapResponse: (r) => ({ data: r }) }
  }
  return {
    context: obj as unknown as Context,
    payload: obj as Payload,
    wrapResponse: (r) => r,
  }
}

export type TaskQueueOptions = {
  name: string
}

/**
 * A group of workflows (PascalCase methods) and activities (camelCase methods)
 * served from one task queue. Workflows call siblings through `execute`, which
 * schedules an activity or starts a child workflow depending on the method.
 */
export abstract class AbstractService<Context extends BaseJobContext = BaseJobContext> {
  public abstract taskQueueOptions: TaskQueueOptions

  public workflowNameMap: Record<string, string> = {}

  private context?: Context

  protected get logger() {
    return workflow.log
  }

  protected get currentContext(): Context {
    if (!this.context) {
      throw new Error('Context not found, make sure to call under TaskRequest format')
    }
    return this.context
  }

  public static bindWorkflow<P extends AbstractService, K extends keyof P & string>(
    this: SPClass<P>,
    method: K,
  ): P[K] {
    const wrapped = async (params: CompatibleTaskRequest<object, BaseJobContext>) => {
      const { payload, context, wrapResponse } = parseCompatibleRequest(params)
      const service = new this()
      if (context) service.setContext(context)
      const fn = service[method] as unknown as (p: object) => Promise<object>
      return wrapResponse(await fn.call(service, payload))
    }
    return wrapped as P[K]
  }

  public getRequestCtx(): ReqContext | undefined {
    return this.context?.requestContext
  }

  public getTaskQueue(_ctx?: Partial<Context>, taskQueue?: string): string {
    return taskQueue || this.taskQueueOptions.name
  }

  public setContext(context: Context): void {
    this.context = context
  }

  protected deepCopyOptionCtx<C extends SPClass, M extends SPMethod<C>>(
    options: SPOption<C, M>,
  ): SPOption<C, M> {
    const context = options.context ? { ...options.context } : undefined
    return { ...options, context }
  }

  protected async execute<C extends SPClass, M extends SPMethod<C>>(
    options: SPOption<C, M>,
  ): Promise<SPResponse<C, M>> {
    const { result } = await this.startExecution(options)
    return result
  }

  protected executeFromInstance<C extends SPClass, M extends SPMethod<C>>(
    method: keyof this & string,
    payload: unknown,
  ): Promise<SPResponse<C, M>> {
    return this.execute({
      service: this.constructor as C,
      method: method as M,
      payload: payload as SPOption<C, M>['payload'],
      context: this.context as unknown as SPOption<C, M>['context'],
    })
  }

  protected async genericWorkflow<const T extends readonly SPCallSpec[]>(
    calls: T,
    options?: GenericWorkflowBatchOptions,
  ): Promise<{ [K in keyof T]: SPCallResult<T[K]> }>
  protected async genericWorkflow<const T extends readonly SPCallSpec[]>(
    calls: T,
    options: GenericWorkflowBatchOptions & { settle: true },
  ): Promise<{ [K in keyof T]: SPCallSettledResult<T[K]> }>
  protected async genericWorkflow<const T extends readonly SPCallSpec[]>(
    calls: T,
    options?: GenericWorkflowBatchOptions,
  ): Promise<
    { [K in keyof T]: SPCallResult<T[K]> } | { [K in keyof T]: SPCallSettledResult<T[K]> }
  > {
    const settle = options?.settle === true
    const maxConcurrency = Math.max(1, Math.floor(options?.maxConcurrency ?? calls.length))
    const allResults: unknown[] = []
    for (let i = 0; i < calls.length; i += maxConcurrency) {
      const batch = calls.slice(i, i + maxConcurrency)
      const running: Promise<unknown>[] = []
      for (const call of batch) {
        running.push((await this.startExecution(call as SPOption<SPClass, SPMethod<SPClass>>)).result)
      }
      allResults.push(...(settle ? await Promise.allSettled(running) : await Promise.all(running)))
    }
    return allResults as { [K in keyof T]: SPCallResult<T[K]> }
  }

  protected async genericWorkflowMap<const T extends Record<string, SPCallSpec>>(
    calls: T,
    options?: GenericWorkflowBatchOptions,
  ): Promise<{ [K in keyof T]: SPCallResult<T[K]> }> {
    const entries = Object.entries(calls) as [keyof T, T[keyof T]][]
    const results = await this.genericWorkflow(
      entries.map(([, v]) => v) as unknown as readonly SPCallSpec[],
      options,
    )
    const mapped = {} as Record<keyof T, unknown>
    for (const [index, [key]] of entries.entries()) mapped[key] = results[index]
    return mapped as { [K in keyof T]: SPCallResult<T[K]> }
  }

  protected async startChildWorkflow<C extends SPClass, M extends SPMethod<C>>(
    options: SPOption<C, M>,
  ): Promise<workflow.ChildWorkflowHandle<SPWorkflow<C, M>>> {
    const service = new options.service()
    options = this.deepCopyOptionCtx(options)
    if (options.context) options.context.requestContext = this.getRequestCtx()
    return workflow.startChild<SPWorkflow<C, M>>(options.method, {
      args: [buildCompatibleTaskRequest(options)],
      parentClosePolicy: options.options?.parentClosePolicy,
      taskQueue: service.getTaskQueue(undefined, options.options?.taskQueue),
      workflowId: options.options?.workflowId || getChildWorkflowID(options.method),
    })
  }

  private async startExecution<C extends SPClass, M extends SPMethod<C>>(
    options: SPOption<C, M>,
  ): Promise<{ result: Promise<SPResponse<C, M>> }> {
    const service = new options.service()
    const method = service[options.method as keyof typeof service] as unknown as object
    const type = getMetadata<'Activity' | 'Workflow'>(METADATA_TYPE, method, options.method)

    if (type === 'Activity') {
      options = this.deepCopyOptionCtx(options)
      if (options.context) options.context.requestContext = this.getRequestCtx()
      const activityOptions = getMetadata<ActivityOptions>(METADATA_OPTIONS, method, options.method) ?? {}
      const result = workflow
        .scheduleActivity<SPResponse<C, M>>(options.method, [buildCompatibleTaskRequest(options)], {
          ...activityOptions,
          taskQueue: service.getTaskQueue(undefined, activityOptions.taskQueue),
        })
        .then((r) => parseResponse<SPResponse<C, M>>(r))
      return { result }
    }

    const result = this.startChildWorkflow(options)
      .then((handle) => handle.result())
      .then((r) => parseResponse<SPResponse<C, M>>(r))
    return { result }
  }
}

type WorkflowMethod<T> = T extends (
  params: infer _P extends object,
) => Promise<infer _ extends number | object | string | void>
  ? T
  : never

export type SPClass<P extends AbstractService = AbstractService> = new () => P

export type SPMethod<C extends SPClass> = keyof InstanceType<C> & string

export type SPOption<C extends SPClass, M extends SPMethod<C>> = {
  context?: InstanceType<C> extends AbstractService<infer Context> ? Context : never
  method: M
  options?: Partial<{
    parentClosePolicy: ParentClosePolicy
    retry: Pick<
      RetryPolicy,
      | 'backoffCoefficient'
      | 'initialInterval'
      | 'maximumAttempts'
      | 'maximumInterval'
      | 'nonRetryableErrorTypes'
    >
    taskQueue: string
    workflowExecutionTimeout: Duration
    workflowId: string
    workflowRunTimeout: Duration
  }>
  payload: CompatibleTaskRequest<
    Parameters<WorkflowMethod<InstanceType<C>[M]>>[0],
    InstanceType<C> extends AbstractService<infer Context> ? Context : never
  >
  service: C
}

export type SPResponse<C extends SPClass, M extends SPMethod<C>> = Awaited<
  ReturnType<WorkflowMethod<InstanceType<C>[M]>>
>

export type GenericWorkflowBatchOptions = Partial<{
  maxConcurrency: number
  settle: boolean
}>

export type SPCallSpec<C extends SPClass = SPClass, M extends SPMethod<C> = SPMethod<C>> = SPOption<
  C,
  M
>

export type SPCallResult<T extends SPCallSpec> =
  T extends SPCallSpec<infer C, infer M> ? SPResponse<C, M> : never

export type SPCallSettledResult<T extends SPCallSpec> = PromiseSettledResult<SPCallResult<T>>

export type SPWorkflow<C extends SPClass, M extends SPMethod<C>> = (
  arg: SPOption<C, M>['payload'],
) => Promise<SPResponse<C, M>>
