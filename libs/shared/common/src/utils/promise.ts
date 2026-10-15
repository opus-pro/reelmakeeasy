/**
 * Returns true if the value has a `.then` method, indicating it is thenable
 * (Promise-like). Useful as a type guard when distinguishing sync values from
 * Promises or other thenables.
 *
 * @example
 * const result = maybeAsync()
 * if (isThenable(result)) {
 *   result.then(handleValue)
 * } else {
 *   handleValue(result)
 * }
 */
export function isThenable<T>(value: unknown): value is PromiseLike<T> {
  return value != null && typeof (value as PromiseLike<T>).then === 'function'
}

/**
 * Creates a deferred Promise whose resolve/reject handles are exposed for
 * external control. Useful when you need to resolve a Promise from outside
 * the async operation that created it.
 *
 * @example
 * const { promise, resolve, reject } = createDeferred<string>()
 * socket.on('message', resolve)
 * socket.on('error', reject)
 * const result = await promise
 */
export function createDeferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: PromiseLike<T> | T) => void
} {
  let resolve: (value: PromiseLike<T> | T) => void = () => void 0
  let reject: (reason?: unknown) => void = () => void 0

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve: resolve ?? (() => void 0), reject: reject ?? (() => void 0) }
}
