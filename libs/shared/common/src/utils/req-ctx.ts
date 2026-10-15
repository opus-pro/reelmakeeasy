import { AsyncLocalStorage } from 'node:async_hooks'

import { ReqContext } from '@shared/types/api/req-ctx'

import { getTraceInfo } from '../tracer/index'

const storage = new AsyncLocalStorage<ReqContext>()

export function getReqContext(): ReqContext {
  return { login_id: '', org_id: '', user_id: '', ...storage.getStore(), tracer: getTraceInfo() }
}

/**
 * Check if we're currently in a request context
 */
export function hasContext(): boolean {
  return storage.getStore() !== undefined
}

/**
 * Run a function within a request context
 */
export function runWithContext<T>(context: Partial<ReqContext>, callback: () => T): T {
  const prevContext = getReqContext()
  const newCtx = { ...prevContext, ...context }
  return storage.run(newCtx, callback)
}
