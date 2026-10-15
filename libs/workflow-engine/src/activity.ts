import { IllegalStateError } from './common'
import { type ActivityContextValue, type ActivityInfo, activityStorage } from './engine'

export { ApplicationFailure, CancelledFailure } from './common'
export type { ActivityInfo } from './engine'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging -- instance shape of Context
export interface Context extends ActivityContextValue {}

/** The running activity's context, mirroring the SDK's `Context.current()`. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Context {
  static current(): Context {
    const ctx = activityStorage.getStore()
    if (!ctx) throw new IllegalStateError('Activity context not initialized')
    return ctx as Context
  }
}

export function activityInfo(): ActivityInfo {
  return Context.current().info
}

export function heartbeat(details?: unknown): void {
  Context.current().heartbeat(details)
}

export function sleep(ms: number | string): Promise<void> {
  return Context.current().sleep(ms)
}

export function cancelled(): Promise<never> {
  return Context.current().cancelled
}
