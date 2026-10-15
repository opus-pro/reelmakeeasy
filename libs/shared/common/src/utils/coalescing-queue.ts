import { Logger } from './logger'

const nsLogger = Logger.get('CoalescingQueue')

/**
 * Queue that coalesces rapid async calls:
 * - If idle, execute immediately
 * - If a call is in-flight, buffer ONE trailing execution
 * - Multiple pushes during in-flight collapse into a single trailing call
 *
 * push() returns a Promise that resolves when the actual execution completes.
 * Callers whose requests were coalesced share the same trailing Promise,
 * resolved in FIFO order (A, B, C - not C, B, A).
 */
export class CoalescingQueue<T = void> {
  onDrain?: () => void

  get isRunning() {
    return this.running !== null
  }

  private pendingFn: (() => Promise<T>) | null = null
  private pendingWaiters: { reject: (e: unknown) => void; resolve: (v: T) => void }[] = []
  private running: null | Promise<T> = null

  push(fn: () => Promise<T>): Promise<T> {
    if (!this.running) {
      return this.run(fn)
    }

    // Always keep the latest fn; accumulate waiters in push order
    this.pendingFn = fn
    return new Promise<T>((resolve, reject) => {
      this.pendingWaiters.push({ resolve, reject })
    })
  }

  private async run(fn: () => Promise<T>): Promise<T> {
    const promise = fn()
    this.running = promise
    try {
      return await promise
    } finally {
      this.running = null
      if (this.pendingFn) {
        const nextFn = this.pendingFn
        const waiters = this.pendingWaiters
        this.pendingFn = null
        this.pendingWaiters = []
        this.run(nextFn).then(
          (v) => waiters.forEach((w) => w.resolve(v)),
          (e) => waiters.forEach((w) => w.reject(e)),
        )
      } else {
        queueMicrotask(() => {
          try {
            this.onDrain?.()
          } catch (error) {
            nsLogger.error('error occurred on drain event', error)
          }
        })
      }
    }
  }
}
