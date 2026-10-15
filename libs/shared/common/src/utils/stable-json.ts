/** Deterministic JSON stringification with recursively sorted keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (v as Record<string, unknown>)[k]
          return sorted
        }, {})
    }
    return v
  })
}
