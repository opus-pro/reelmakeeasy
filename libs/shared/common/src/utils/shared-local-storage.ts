/**
 * Reactive localStorage singleton.
 *
 * One global `storage` event listener is shared across all keys and subscribers.
 * The listener is bound on the first subscription and released when the last one unsubscribes.
 *
 * Motivations:
 * 1) `storage` does not fire in the same tab that performs the write - same-tab writes are
 *    fanned out manually via `_emit`.
 * 2) One listener for all keys avoids N separate `addEventListener` calls.
 * 3) Per-key cache avoids repeated `localStorage.getItem` calls while subscribers are active.
 */
export class SharedLocalStorage {
  private static _instance: null | SharedLocalStorage = null

  // Per-key value cache. Only populated while at least one subscriber is active.
  private readonly _cache = new Map<string, null | string>()

  // Total number of active subscriptions across all keys.
  private _listenerCount = 0

  // Per-key subscriber sets.
  private readonly _listeners = new Map<string, Set<(value: null | string) => void>>()

  private _storageHandler: ((event: StorageEvent) => void) | undefined

  // Private constructor - use getInstance().
  private constructor() {
    // ignore
  }

  static getInstance(): SharedLocalStorage {
    if (!SharedLocalStorage._instance) {
      SharedLocalStorage._instance = new SharedLocalStorage()
    }
    return SharedLocalStorage._instance
  }

  /**
   * Read the current value for `key`.
   * While subscribed, reads from the in-memory cache; otherwise falls back to `getItem`.
   */
  get(key: string): null | string {
    if (this._storageHandler) {
      // Snapshot lazily on first access while bound, so newly-listened keys are cached.
      if (!this._cache.has(key)) {
        this._cache.set(key, localStorage.getItem(key))
      }
      return this._cache.get(key) ?? null
    }
    return localStorage.getItem(key)
  }

  /**
   * Subscribe to changes for `key`. Returns an unsubscribe function.
   * The global storage listener is bound on the first subscription and released on the last.
   */
  listen(key: string, callback: (value: null | string) => void): () => void {
    let callbacks = this._listeners.get(key)
    if (!callbacks) {
      callbacks = new Set()
      this._listeners.set(key, callbacks)
    }

    if (!callbacks.has(callback)) {
      callbacks.add(callback)
      this._listenerCount++
    }

    if (!this._storageHandler) {
      // Bind first, then snapshot - same ordering rationale as SharedLocalStorageValue.
      this._bind()
    } else if (!this._cache.has(key)) {
      // Already bound but this key is new - snapshot it now.
      this._cache.set(key, localStorage.getItem(key))
    }

    return () => {
      if (!callbacks.has(callback)) {
        return
      }
      callbacks.delete(callback)
      this._listenerCount--
      if (this._listenerCount === 0) {
        this._unbind()
      }
    }
  }

  /**
   * Remove `key` from localStorage and notify same-tab subscribers.
   */
  remove(key: string): void {
    if (this._storageHandler) {
      // Skip if already absent (null means not present).
      if (this._cache.has(key) && this._cache.get(key) === null) {
        return
      }
      localStorage.removeItem(key)
      this._emit(key, null)
    } else {
      localStorage.removeItem(key)
    }
  }

  /**
   * Write `value` for `key` and notify same-tab subscribers immediately.
   */
  set(key: string, value: string): void {
    if (this._storageHandler) {
      if (this._cache.get(key) === value) {
        return
      }
      localStorage.setItem(key, value)
      this._emit(key, value)
    } else {
      localStorage.setItem(key, value)
    }
  }

  private _bind() {
    this._storageHandler = (event) => {
      if (event.storageArea !== localStorage) {
        return
      }
      if (event.key === null) {
        // `localStorage.clear()` - propagate null to all cached keys.
        for (const key of this._cache.keys()) {
          this._emit(key, null)
        }
      } else {
        // `storage` already carries `newValue`; use it directly to avoid extra `getItem`.
        this._emit(event.key, event.newValue)
      }
    }
    window.addEventListener('storage', this._storageHandler)
    // Snapshot all currently-listened keys after attaching the listener.
    // This minimises the race window where another tab writes between read and registration.
    for (const key of this._listeners.keys()) {
      if (!this._cache.has(key)) {
        this._cache.set(key, localStorage.getItem(key))
      }
    }
  }

  /**
   * Update cache and fan out to all subscribers for `key`.
   * Used for both same-tab writes and cross-tab `storage` events.
   */
  private _emit(key: string, value: null | string) {
    this._cache.set(key, value)
    const callbacks = this._listeners.get(key)
    if (!callbacks) {
      return
    }
    for (const callback of callbacks) {
      callback(value)
    }
  }

  private _unbind() {
    if (!this._storageHandler) {
      return
    }
    window.removeEventListener('storage', this._storageHandler)
    this._storageHandler = undefined
    this._cache.clear()
  }
}
