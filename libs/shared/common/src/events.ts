/**
 * Typed event key - a symbol that carries its args type via phantom generic.
 * Similar to Vue's InjectionKey pattern.
 *
 * Usage:
 *   const onReady = createEventKey<[sessionId: string]>('ready')
 *   emitter.on(onReady, (sessionId) => {})   // sessionId: string
 *   emitter.emit(onReady, 'abc-123')          // type-checked
 */
export type EventKey<TArgs extends readonly unknown[] = readonly unknown[]> = symbol & {
  args?: TArgs
}

export function createEventKey<TArgs extends readonly unknown[] = []>(
  description?: string,
): EventKey<TArgs> {
  return Symbol(description) as EventKey<TArgs>
}

/**
 * Callback type for a specific event.
 *
 * Usage:
 *   type ResizeHandler = EventListener<[width: number, height: number]>
 */
export type EventListener<TArgs extends readonly unknown[]> = (...args: TArgs) => void

// Internal listener type: (...args: never) => void is a supertype of all EventListener<T>
// because function params are contravariant and never extends every T.
type AnyListener = (...args: never) => void

/**
 * Subscriber-facing interface - no emit. Pass this to consumers that should
 * only be able to listen, not publish.
 *
 * Usage:
 *   function usePanel(emitter: IEventsListener<PanelEvents>) { ... }
 */
export interface IEvents<TEventMap extends Record<string, readonly unknown[]>>
  extends IEventsListener<TEventMap> {
  emit<K extends keyof TEventMap>(name: K, ...args: TEventMap[K]): void
  emit<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, ...args: TArgs): void
}

export interface IEventsListener<TEventMap extends Record<string, readonly unknown[]>> {
  count(name: EventKey<readonly unknown[]> | keyof TEventMap): number
  /** off(name, listener) - remove a specific listener */
  off<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): void

  off<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, listener: EventListener<TArgs>): void
  /** off(name) - remove all listeners for an event */
  off<K extends keyof TEventMap>(name: K): void
  off(name: EventKey<readonly unknown[]>): void
  /** off() - remove all listeners for all events */
  off(): void
  on<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): void

  on<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, listener: EventListener<TArgs>): void
  /** Register a listener and return a dispose function. */
  subscribe<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): () => void

  subscribe<TArgs extends readonly unknown[]>(
    name: EventKey<TArgs>,
    listener: EventListener<TArgs>,
  ): () => void
}

export class Events<TEventMap extends Record<string, readonly unknown[]> = Record<string, never>>
  implements IEvents<TEventMap>
{
  private readonly _map = new Map<string | symbol, Set<AnyListener>>()

  count(name: EventKey<readonly unknown[]> | keyof TEventMap): number {
    return this._map.get(name as string | symbol)?.size ?? 0
  }

  emit<K extends keyof TEventMap>(name: K, ...args: TEventMap[K]): void
  emit<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, ...args: TArgs): void
  emit(name: string | symbol, ...args: readonly unknown[]): void {
    const set = this._map.get(name)
    if (!set?.size) {
      return
    }
    for (const fn of Array.from(set)) {
      fn(...(args as never))
    }
  }

  off<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): void
  off<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, listener: EventListener<TArgs>): void
  off<K extends keyof TEventMap>(name: K): void
  off(name: EventKey<readonly unknown[]>): void
  off(): void
  off(name?: string | symbol, listener?: AnyListener): void {
    if (name === undefined) {
      this._map.clear()
    } else if (listener === undefined) {
      this._map.delete(name)
    } else {
      this._map.get(name)?.delete(listener)
    }
  }

  on<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): void
  on<TArgs extends readonly unknown[]>(name: EventKey<TArgs>, listener: EventListener<TArgs>): void
  on(name: string | symbol, listener: AnyListener): void {
    this._add(name, listener)
  }

  subscribe<K extends keyof TEventMap>(name: K, listener: EventListener<TEventMap[K]>): () => void
  subscribe<TArgs extends readonly unknown[]>(
    name: EventKey<TArgs>,
    listener: EventListener<TArgs>,
  ): () => void
  subscribe(name: string | symbol, listener: AnyListener): () => void {
    this._add(name, listener)
    return () => this._map.get(name)?.delete(listener)
  }

  private _add(name: string | symbol, listener: AnyListener): void {
    let set = this._map.get(name)
    if (!set) {
      set = new Set()
      this._map.set(name, set)
    }
    set.add(listener)
  }
}
