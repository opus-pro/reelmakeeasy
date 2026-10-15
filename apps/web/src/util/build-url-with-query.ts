type QueryRecord = Readonly<Record<string, null | string | undefined>>
type QuerySource = QueryRecord | SearchParamsLike
type SearchParamsLike = {
  forEach: (callback: (value: string, key: string) => void) => void
}

// Builds a query string (e.g. "?key=val&other=val") from a record.
// If baseQuery is provided, keys from query override baseQuery.
// Returns an empty string when there are no query params.
export function buildQuery(query?: null | QueryRecord, baseQuery?: QuerySource): string {
  const params = createParams(baseQuery)

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return
      }
      params.set(key, value)
    })
  }

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function buildUrlWithQuery(pathname: string, query: QueryRecord): string {
  return `${pathname}${buildQuery(query)}`
}

function createParams(source?: QuerySource): URLSearchParams {
  const params = new URLSearchParams()

  if (!source) {
    return params
  }

  if (isSearchParamsLike(source)) {
    source.forEach((value: string, key: string) => {
      params.set(key, value)
    })
    return params
  }

  Object.entries(source).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return
    }
    params.set(key, value)
  })

  return params
}

function isSearchParamsLike(source: QuerySource): source is SearchParamsLike {
  return typeof source === 'object' && source !== null && 'forEach' in source
}
