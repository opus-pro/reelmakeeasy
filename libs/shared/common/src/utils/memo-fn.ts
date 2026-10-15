import { isThenable } from './promise'

/**
 * Shared memoized-lookup closure used by both the Map- and WeakMap-backed
 * factories below. The backing store only needs the has/get/set surface, so
 * the same logic serves either variant.
 *
 * Lookups and writes both go through the normalized key: using the raw key for
 * the has/get check while storing under mapKey(key) would miss the cache (and
 * leak an entry) on every call whenever mapKey is not the identity fn.
 */
interface MemoStore<V> {
  get(key: unknown): undefined | V
  has(key: unknown): boolean
  set(key: unknown, value: V): unknown
}

function buildMemoLookup<K, V, S extends MemoStore<V>>(
  store: S,
  factory: (key: K, store: S) => V,
  mapKey: (key: K) => unknown,
): (key: K) => V {
  return (key: K) => {
    const k = mapKey(key)
    if (store.has(k)) {
      return store.get(k) as V
    }
    const item = factory(key, store)
    store.set(k, item)
    return item
  }
}

/**
 * Creates a memoized lookup function backed by a Map.
 *
 * The factory `get` is called at most once per unique key; subsequent calls
 * with the same key return the cached value. An optional `mapKey` normalizer
 * controls what counts as "the same key" (defaults to identity).
 *
 * The returned function exposes `.map` for direct cache inspection.
 *
 * @example
 * const getPool = createMapFn((id: string) => new Pool(id))
 * getPool('a') === getPool('a') // true - same instance returned
 */
export function createMapFn<K, V>(
  get: (key: K, map: Map<unknown, V>) => V,
  mapKey?: (key: K) => unknown,
): ((key: K) => V) & { map: Map<unknown, V> }
export function createMapFn<F extends Function>(get: F): F & { map: Map<unknown, unknown> }
export function createMapFn<K, V>(
  get: (key: K, map: Map<unknown, V>) => V,
  mapKey: (key: K) => unknown = (x) => x,
): ((key: K) => V) & { map: Map<unknown, V> } {
  const map = new Map<unknown, V>()
  return Object.assign(buildMemoLookup<K, V, Map<unknown, V>>(map, get, mapKey), { map })
}

/**
 * Wraps an async function with WeakMap-backed Promise memo.
 *
 * - Pending or resolved: the same Promise is returned for the same key object.
 * - Rejected: the entry is removed so the next call retries.
 *
 * Keys must be objects (WeakMap constraint), so GC can reclaim entries when
 * the key object is no longer referenced elsewhere.
 *
 * @example
 * const getAudioMetadataMemo = createWeakMapMemoAsyncFn(getAudioMetadata)
 * // Concurrent calls with the same File share one in-flight request
 * const [a, b] = await Promise.all([getAudioMetadataMemo(file), getAudioMetadataMemo(file)])
 */
export function createWeakMapMemoAsyncFn<K extends object, R>(
  get: (key: K) => PromiseLike<R> | R,
): (key: K) => Promise<R> {
  const map = new WeakMap<K, Promise<R>>()
  // Hoisted out of the per-lookup path so it is allocated once per memoizer
  // instead of on every cache miss. Awaits the value and evicts the entry on
  // rejection so the next call retries.
  const trackRejection = async (p: PromiseLike<R>, key: K): Promise<R> => {
    try {
      return await p
    } catch (err: unknown) {
      map.delete(key)
      throw err
    }
  }
  const fn = (key: K): Promise<R> => {
    const cached = map.get(key)
    if (cached) {
      return cached
    }
    // No try/catch here: if fn(key) throws synchronously, cache.set is never
    // reached, so the failed call is naturally excluded from the cache.
    const p = get(key)
    let promise: Promise<R>
    if (isThenable(p)) {
      promise = trackRejection(p, key)
    } else {
      promise = Promise.resolve(p)
    }
    map.set(key, promise)

    return promise
  }
  fn.map = map
  return fn
}

/**
 * Lazy variant of createWeakMapMemoAsyncFn.
 *
 * Returns the memo wrapper for a given async function, creating it only on
 * first use. The wrapper itself is cached by the function reference, so the
 * same fn always gets the same WeakMap cache without requiring a module-level
 * const.
 *
 * @example
 * // No global initialization - cache created on first call
 * const result = await getWeakMapMemoAsyncFn(getAudioMetadata)(file)
 */
export const getWeakMapMemoAsyncFn = createWeakMapFn(createWeakMapMemoAsyncFn)

/**
 * Same as createMapFn but backed by a WeakMap, so keys are held weakly and
 * eligible for GC when no other references exist.
 *
 * Use this when keys are objects whose lifetime should not be extended by the
 * cache itself (e.g. jotai store instances, React context values).
 *
 * @example
 * const getAtom = createWeakMapFn((store: JotaiStore) => atom(...))
 * getAtom(store) === getAtom(store) // true - same atom per store
 */
export function createWeakMapFn<K extends object, V>(
  get: (key: K, map: WeakMap<object, V>) => V,
  mapKey?: (key: K) => object,
): ((key: K) => V) & { map: WeakMap<object, V> }
export function createWeakMapFn<F extends Function>(get: F): F & { map: WeakMap<object, unknown> }
export function createWeakMapFn<K extends object, V>(
  get: (key: K, map: WeakMap<object, V>) => V,
  mapKey: (key: K) => object = (x) => x,
): ((key: K) => V) & { map: WeakMap<object, V> } {
  const map = new WeakMap<object, V>()
  return Object.assign(buildMemoLookup<K, V, WeakMap<object, V>>(map, get, mapKey), { map })
}
