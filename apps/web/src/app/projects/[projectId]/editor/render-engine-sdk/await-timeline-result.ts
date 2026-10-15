import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

// Shared one-shot bridge for the handle-based timeline extractors
// (extractCurrentImageByTimeline / extractCoverImageByTimeline / fetchCurrentLayoutInfo).
// Their engine calls are fire-and-forget: the result comes back later as a single pubSub
// event. `subscribe` attaches the listener (filtering to this module) and returns an
// unsubscribe fn; it calls `resolve` once with the mapped result -- copying any wasm-heap
// buffer first, since the view is reused on the next emit. `trigger` invokes the engine
// call after the listener is attached. Abortable; on abort or a synchronous engine error
// the promise rejects and the listener is detached. One-shot and REQUIRES serialization:
// these events carry no request id, so a concurrent call on the same engine could resolve
// with the wrong result. Pass a signal to bound the wait -- the wasm emits nothing when the
// timeline/track is empty or not running, which would otherwise leave the promise pending.
export function awaitTimelineResult<T>(
  subscribe: (resolve: (value: T) => void) => () => void,
  trigger: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const cleanup = () => {
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }
    const settle = (value: T) => {
      cleanup()
      resolve(value)
    }
    const unsubscribe = subscribe(settle)
    signal?.addEventListener('abort', onAbort)
    try {
      trigger()
    } catch (error) {
      cleanup()
      reject(ensureError(error))
    }
  })
}
