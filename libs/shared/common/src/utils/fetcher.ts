export type FetcherData<T> = FetcherPendingData<T> | FetcherRejectedData<T> | FetcherResolvedData<T>

export type FetcherPendingData<T = unknown> = {
  readonly error?: unknown
  readonly state: 'pending'
  readonly value?: T
}

export type FetcherRejectedData<T = unknown> = {
  readonly error: unknown
  readonly state: 'rejected'
  readonly value?: T
}

export type FetcherResolvedData<T = unknown> = {
  readonly error?: unknown
  readonly state: 'resolved'
  readonly value: T
}

import { isThenable } from './promise'

/**
 * Minimal read side shared by Fetcher and RetriableFetcher: a current-state
 * snapshot, a change subscription, and a promise view. Consumers (e.g. the
 * Jotai adapter) should depend on this interface rather than the concrete
 * class, so a retriable source can stand in wherever a one-shot Fetcher is
 * accepted.
 */
export interface IFetcher<T> {
  readonly data: FetcherData<T>
  onDataChange(listener: (data: FetcherData<T>) => void): () => void
  toPromise(): Promise<T>
}

function noop() {
  // ignore
}

/**
 * One-shot async data wrapper with pub/sub.
 *
 * Wraps a fn that returns T or Promise<T>. Notifies listeners once when the
 * promise settles, then clears the listener set. Sync results are available
 * immediately via `data` with no listeners needed.
 */
export class Fetcher<T> implements IFetcher<T> {
  /**
   * Snapshot read only.
   *
   * Reading `fetcher.data` directly is non-reactive and won't be tracked by
   * Jotai atoms. Inside atom read functions, prefer
   * `get(getFetcherAtom(store, fetcher))` to subscribe to updates.
   */
  get data(): FetcherData<T> {
    return this._data
  }
  private _data: FetcherData<T>
  private _listeners?: Set<(data: FetcherData<T>) => void>

  constructor(fn: () => PromiseLike<T> | T, defaultValue?: T) {
    this._data = { state: 'pending', value: defaultValue }
    try {
      const p = fn()
      if (isThenable(p)) {
        this._listeners = new Set()
        p.then(
          (value) => {
            this._data = { state: 'resolved', value }
            this._notify()
            this._listeners = undefined
          },
          (error) => {
            this._data = { state: 'rejected', error }
            this._notify()
            this._listeners = undefined
          },
        )
      } else {
        this._data = { state: 'resolved', value: p }
      }
    } catch (error) {
      this._data = { state: 'rejected', error }
    }
  }

  onDataChange(listener: (data: FetcherData<T>) => void): () => void {
    const listeners = this._listeners
    if (!listeners) {
      return noop
    }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  toPromise(): Promise<T> {
    const d = this._data
    if (d.state === 'resolved') {
      return Promise.resolve(d.value)
    }
    if (d.state === 'rejected') {
      return Promise.reject(d.error)
    }
    return new Promise<T>((resolve, reject) => {
      this.onDataChange((data) => {
        if (data.state === 'resolved') {
          resolve(data.value)
        } else if (data.state === 'rejected') {
          reject(data.error)
        }
      })
    })
  }

  private _notify() {
    const listeners = this._listeners
    if (!listeners) {
      return
    }
    const data = this._data
    for (const fn of listeners) {
      fn(data)
    }
  }
}

/**
 * Async data wrapper like Fetcher, but re-runnable. Holds onto fn so retry()
 * can run it again, and keeps its listener set across settles (Fetcher drops
 * its own once settled) so subscribers keep receiving updates over many rounds.
 * The instance reference is stable across retries, so a Jotai atom keyed on it
 * is never torn down.
 */
export class RetriableFetcher<T> implements IFetcher<T> {
  get data(): FetcherData<T> {
    return this._data
  }
  private _data: FetcherData<T> = { state: 'pending' }
  // Bumped on each run so a stale round that settles late cannot overwrite the
  // state of a newer round.
  private epoch = 0

  // Same lightweight pub/sub as Fetcher, but NOT cleared on settle: retry()
  // reuses it to notify across multiple rounds.
  private readonly listeners = new Set<(data: FetcherData<T>) => void>()

  constructor(private readonly fn: () => PromiseLike<T> | T) {
    this.run()
  }

  onDataChange(listener: (data: FetcherData<T>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Re-runs fn. A rejected round always re-runs; a resolved round re-runs only
   * when `force` is true (otherwise the successful result is kept). Ignored while
   * pending so a run already in flight is never duplicated.
   */
  retry(force = false): void {
    const { state } = this._data
    if (state === 'pending' || (state === 'resolved' && !force)) {
      return
    }
    this.run()
  }

  toPromise(): Promise<T> {
    const d = this._data
    if (d.state === 'resolved') {
      return Promise.resolve(d.value)
    }
    if (d.state === 'rejected') {
      return Promise.reject(d.error)
    }
    return new Promise<T>((resolve, reject) => {
      const off = this.onDataChange((data) => {
        if (data.state === 'resolved') {
          off()
          resolve(data.value)
        } else if (data.state === 'rejected') {
          off()
          reject(data.error)
        }
      })
    })
  }

  private _set(data: FetcherData<T>): void {
    this._data = data
    for (const fn of Array.from(this.listeners)) {
      fn(data)
    }
  }

  private run(): void {
    const e = ++this.epoch
    try {
      const p = this.fn()
      if (isThenable(p)) {
        this._set({ state: 'pending' })
        p.then(
          (value) => {
            if (e === this.epoch) {
              this._set({ state: 'resolved', value })
            }
          },
          (error) => {
            if (e === this.epoch) {
              this._set({ state: 'rejected', error })
            }
          },
        )
      } else {
        // Sync fast path, same as Fetcher: resolve now, no microtask hop.
        this._set({ state: 'resolved', value: p })
      }
    } catch (error) {
      // fn threw synchronously.
      this._set({ state: 'rejected', error })
    }
  }
}
