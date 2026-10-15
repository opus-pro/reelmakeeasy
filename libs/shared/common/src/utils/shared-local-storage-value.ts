import { SharedLocalStorage } from './shared-local-storage'

/**
 * Thin wrapper around `SharedLocalStorage` that binds a fixed key.
 * Prefer `SharedLocalStorage.getInstance()` directly when multiple keys are needed.
 */
export class SharedLocalStorageValue {
  private readonly _storage = SharedLocalStorage.getInstance()

  constructor(readonly key: string) {}

  get(): null | string {
    return this._storage.get(this.key)
  }

  listen(callback: (newValue: null | string) => void): () => void {
    return this._storage.listen(this.key, callback)
  }

  remove(): void {
    this._storage.remove(this.key)
  }

  set(value: string): void {
    this._storage.set(this.key, value)
  }
}
