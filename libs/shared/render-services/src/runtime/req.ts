import type { SPClass, SPMethod, SPOption } from './abstract'
import type { TaskResponse } from './types'

/**
 * Build a compatible payload for task request.
 */
export function buildCompatibleTaskRequest<C extends SPClass, M extends SPMethod<C>>(
  options: SPOption<C, M>,
): SPOption<C, M>['payload'] {
  return options.context?.runId
    ? { payload: options.payload, context: options.context }
    : options.payload
}

/**
 * Compatible with raw payload.
 * If the response is a valid TaskResponse object, it will return the data.
 * If not, it will return the payload as is.
 *
 * We can remove this logic after ALL clients are updated to use TaskRequest format.
 */
export function parseResponse<T extends object>(obj: T | TaskResponse<T>): T {
  if (typeof obj === 'object' && !!obj && 'data' in obj) {
    return obj.data
  }
  return obj as T
}
