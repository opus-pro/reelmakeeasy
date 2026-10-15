import { AsyncLocalStorage } from 'node:async_hooks'

import { isEval } from '../utils/env'

import type { SharedJobContext } from './type'
import { SharedJobContextSchema } from './type'

export type { PipelineContextEntry, SharedJobContext, SharedSceneJobContext } from './type'
export {
  PipelineContextEntrySchema,
  SharedJobContextSchema,
  SharedSceneJobContextSchema,
} from './type'

class InternalJobContext {
  private static readonly storage = new AsyncLocalStorage<SharedJobContext>()

  /**
   * Get a key from the job context.
   * @param key - The key to get.
   * @param defaultValue - The default value to return if the key is not found.
   * @returns The value of the key.
   * @throws JobContextKeyNotFoundError if the key is not found and no default value is provided.
   */
  public getByKey<K extends keyof SharedJobContext>(key: K): NonNullable<SharedJobContext[K]>
  public getByKey<K extends keyof SharedJobContext, D>(
    key: K,
    defaultValue: D,
  ): D | NonNullable<SharedJobContext[K]>
  public getByKey<K extends keyof SharedJobContext, D>(
    key: K,
    defaultValue?: D,
  ): D | NonNullable<SharedJobContext[K]> {
    const value = this.getOrCreateStore()[key]
    if (value === null || value === undefined) {
      if (defaultValue !== undefined) {
        return defaultValue
      }
      throw new JobContextKeyNotFoundError(key)
    }
    return value as NonNullable<SharedJobContext[K]>
  }
  /**
   * pass {} as default value to avoid throwing error outside of JobContext.run()
   */
  public getFullContext(defaultValues?: SharedJobContext): SharedJobContext {
    return { ...this.getOrCreateStore(defaultValues) }
  }
  /** this will inherit the parent context */
  public run<T>(ctx: SharedJobContext, callback: () => T): T {
    const picked = this.pickValidValues(ctx)
    const store = { ...this.getOrCreateStore(picked), ...picked }
    return InternalJobContext.storage.run(store, callback)
  }

  private getOrCreateStore(ctx?: SharedJobContext): SharedJobContext {
    const store = InternalJobContext.storage.getStore()
    if (!store && !ctx) {
      throw new JobContextNotFoundError()
    }
    return store || { ...ctx }
  }
  private pickValidValues(ctx: SharedJobContext): SharedJobContext {
    const keys = Object.keys(SharedJobContextSchema.shape) as (keyof SharedJobContext)[]
    const entries = Object.entries(ctx).filter(([key]) =>
      keys.includes(key as keyof SharedJobContext),
    )
    return Object.fromEntries(entries) as SharedJobContext
  }

  /**
   * Note: Direct mutation of the context is intentionally not supported.
   *
   * If you need to update context for subsequent code, use nested `run()` calls:
   * @example
   * ```ts
   * JobContext.run({ projectId: 'initial' }, () => {
   *   // projectId is 'initial' here
   *
   *   JobContext.run({ projectId: 'updated' }, () => {
   *     // projectId is now 'updated' for all code in this callback
   *     // Parent context values are inherited automatically
   *   })
   * })
   * ```
   *
   * This design ensures:
   * - Predictable context isolation across async boundaries
   * - No race conditions in concurrent scenarios
   * - Clear scope boundaries for context changes
   */
}

export const JobContext = new InternalJobContext()

export class JobContextKeyNotFoundError extends Error {
  public override readonly name = 'JobContextKeyNotFoundError'
  constructor(key: string) {
    const message = `No job context key found: "${key}". You should pass this key to JobContext.run({ ${key}: value }, ...)`
    super(message)
    this.message = message
  }
}

export class JobContextNotFoundError extends Error {
  public override readonly message =
    'No job context found, you should wrap the code in JobContext.run({ ...ctx }, () => {})'
  public override readonly name = 'JobContextNotFoundError'
}

export function getIsEvalMode(): boolean | null {
  try {
    const evalMode = JobContext.getByKey('evalMode', null) as boolean | null
    if (evalMode === null) {
      return isEval()
    }
    return evalMode
  } catch {
    // JobContextNotFoundError or JobContextKeyNotFoundError
    // This is expected when not running inside JobContext.run()
    return null
  }
}

/**
 * Get the eval sandbox ID from JobContext if present.
 *
 * Used by eval framework to ensure consistent local cache paths across:
 * - ProjectHydrator.hydrateAssetFile()
 * - getAbsolutePath() in utils.ts
 * - getProjectTemplatesSpec()
 *
 * @returns The sandbox ID if found in JobContext, null otherwise (e.g., not in eval context or local testing)
 */
export function getEvalSandboxId(): null | string {
  try {
    const sandboxId = JobContext.getByKey('sandboxId', null) as null | string
    return sandboxId && sandboxId.trim() !== '' ? sandboxId : null
  } catch {
    // JobContextNotFoundError or JobContextKeyNotFoundError
    // This is expected when not running inside JobContext.run()
    return null
  }
}
