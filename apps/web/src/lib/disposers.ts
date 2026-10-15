export class Disposers {
  private readonly _disposers = new Map<unknown, () => void>()

  add(fn: () => void): void
  add(key: unknown, fn: () => void): void
  add(...args: [fn: () => void] | [key: unknown, fn: () => void]): void {
    const key = args[0]
    const fn = (args.length <= 1 ? key : args[1]) as () => void
    if (typeof fn !== 'function') {
      throw new Error('Must register function')
    }
    if (this._disposers.has(key)) {
      throw new Error('key duplicated')
    }
    this._disposers.set(key, fn)
  }

  clear(): void {
    while (this._disposers.size > 0) {
      const batch = Array.from(this._disposers.keys())
      for (const key of batch) {
        const dispose = this._disposers.get(key)
        if (!dispose) {
          continue
        }
        this._disposers.delete(key)
        dispose()
      }
    }
  }

  dispose(key: unknown): void {
    const dispose = this._disposers.get(key)
    if (!dispose) {
      return
    }
    this._disposers.delete(key)
    dispose()
  }

  has(key: unknown): boolean {
    return this._disposers.has(key)
  }

  override(key: unknown, fn: () => void): void {
    if (typeof fn !== 'function') {
      throw new Error('Must register function')
    }
    const dispose = this._disposers.get(key)
    this._disposers.set(key, fn)
    if (dispose) {
      dispose()
    }
  }

  remove(key: unknown): void {
    this._disposers.delete(key)
  }
}
