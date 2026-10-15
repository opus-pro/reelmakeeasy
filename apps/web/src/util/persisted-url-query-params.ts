const STORAGE_KEY = 'ao:persisted-url-query-params'

const PERSISTED_KEYS = [
  'via',
  'utm_source',
  'utm_campaign',
  'utm_medium',
  'utm_content',
  'utm_term',
] as const

type PersistedUrlQueryParams = Partial<Record<(typeof PERSISTED_KEYS)[number], string>>

export function buildQueryStringFromSearchParams(searchParams: URLSearchParams): string {
  const filtered: Array<[string, string]> = []
  for (const key of PERSISTED_KEYS) {
    const value = searchParams.get(key)
    if (value) {
      filtered.push([key, value])
    }
  }

  if (!filtered.length) {
    return ''
  }

  return `?${new URLSearchParams(filtered).toString()}`
}

export function capturePersistedUrlQueryParams(): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return
  }

  const fromUrl = readFromUrl()
  if (!Object.keys(fromUrl).length) {
    return
  }

  const stored = readFromStorage()
  const merged = { ...stored, ...fromUrl }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // Ignore storage errors
  }
}

export function getPersistedUrlQueryParams(): PersistedUrlQueryParams | undefined {
  const stored = readFromStorage()
  return Object.keys(stored).length ? stored : undefined
}

function readFromStorage(): PersistedUrlQueryParams {
  if (typeof sessionStorage === 'undefined') {
    return {}
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    return JSON.parse(raw) as PersistedUrlQueryParams
  } catch {
    return {}
  }
}

function readFromUrl(): PersistedUrlQueryParams {
  if (typeof window === 'undefined') {
    return {}
  }
  const params = new URLSearchParams(window.location.search)
  const fromUrl: PersistedUrlQueryParams = {}
  for (const key of PERSISTED_KEYS) {
    const value = params.get(key)
    if (value) {
      fromUrl[key] = value
    }
  }
  return fromUrl
}
