/**
 * Typed wrappers for built-in Object methods.
 * Use these when you need the return type to reflect the actual key/value types
 * of a known object shape, rather than the default string / unknown widening.
 */

/**
 * Define a closed set of string literals and get back a list, a Set, and a
 * type-safe predicate - all derived from a single source of truth.
 *
 * @example
 * const Status = defineLiterals(['active', 'failed', 'completed'])
 * type Status = typeof Status.type  // 'active' | 'failed' | 'completed'
 * Status.list   // ['active', 'failed', 'completed']
 * Status.set    // Set<'active' | 'failed' | 'completed'>
 * Status.is(x)  // x is 'active' | 'failed' | 'completed'
 */
export function defineLiterals<T extends string>(
  values: T[],
): { is: (x: unknown) => x is T; list: T[]; set: Set<T>; type: T } {
  const set = new Set(values)
  return {
    list: values,
    set,
    is: (x): x is T => set.has(x as T),
    type: undefined as unknown as T,
  }
}

/**
 * Like defineLiterals, but takes a key map (Record<K, true>) instead of a rest arg list.
 * Passing the type parameter enforces key completeness at the call site.
 *
 * @example
 * // Infer literals from the object keys:
 * const Fields = defineLiteralsFromKeyMap({ phase: true, status: true })
 *
 * // Enforce that ALL keys of a union are present (compile error if any are missing):
 * const Fields = defineLiteralsFromKeyMap<SessionChangedOverlayFieldKey>({
 *   phase: true,
 *   status: true,
 *   // ... TS errors if any key from the union is missing or extra
 * })
 * type Fields = typeof Fields.type
 */
export function defineLiteralsFromKeyMap<K extends string>(
  record: Readonly<Record<K, unknown>>,
): { is: (x: unknown) => x is K; list: K[]; set: Set<K>; type: K } {
  return defineLiterals(typedKeys(record))
}

export const typedEntries = Object.entries as <T extends object>(obj: T) => [keyof T, T[keyof T]][]
export const typedKeys = Object.keys as <T extends object>(obj: T) => (keyof T)[]
export const typedValues = Object.values as <T extends object>(obj: T) => T[keyof T][]
