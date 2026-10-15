type StoredEntry = { at: number; value: unknown }

type UrlTransferKeyBucket = Map<string, unknown>

// In-memory transfer registry scoped by query key, then transfer id.
const urlTransferRegistry = new Map<string, UrlTransferKeyBucket>()

// sessionStorage mirror of the registry. Production is a static export, so a
// stale client's router.push can fall back to a full-document navigation
// (e.g. right after a deploy). That reload wipes this module's Map while the
// transfer token survives in the URL, so the destination page used to open
// with the token but no payload. The mirror is tab-scoped and lets
// the fresh document recover the payload.
const STORAGE_KEY_PREFIX = 'ao:url-transfer:'
// Entries put but never consumed (abandoned navigations) are swept on the
// next put once they exceed this age.
const STORAGE_TTL_MS = 30 * 60 * 1000

export function clearUrlTransferRegistryForTest() {
  urlTransferRegistry.clear()
  const storage = getSessionStorage()
  if (!storage) {
    return
  }
  listStoredKeys(storage).forEach((storageKey) => {
    removeStorageItem(storageKey)
  })
}

export function consumeUrlTransferEntry<T>(key: string, id: string): null | T {
  if (!id) {
    return null
  }

  const bucket = urlTransferRegistry.get(key)
  // Transfers are one-time: consume and delete immediately.
  if (bucket?.has(id)) {
    const value = bucket.get(id)

    bucket.delete(id)
    if (bucket.size === 0) {
      urlTransferRegistry.delete(key)
    }
    removeStorageItem(buildStorageKey(key, id))

    return value as T
  }

  // The in-memory entry is gone when a full-document navigation happened
  // between put and consume; fall back to the sessionStorage mirror.
  return takeStoredValue<T>(key, id)
}

export function putUrlTransferEntry(key: string, value: unknown): string {
  const id = createTransferId()
  let bucket = urlTransferRegistry.get(key)
  if (!bucket) {
    urlTransferRegistry.set(key, (bucket = new Map()))
  }
  bucket.set(id, value)
  urlTransferRegistry.set(key, bucket)
  pruneExpiredStoredEntries()
  writeStoredValue(key, id, value)
  return id
}

function buildStorageKey(key: string, id: string): string {
  return `${STORAGE_KEY_PREFIX}${key}:${id}`
}

function createTransferId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getSessionStorage(): null | Storage {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null
    }
    return window.sessionStorage
  } catch {
    // Accessing sessionStorage throws when storage is disabled.
    return null
  }
}

function listStoredKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const storageKey = storage.key(i)
    if (storageKey?.startsWith(STORAGE_KEY_PREFIX)) {
      keys.push(storageKey)
    }
  }
  return keys
}

function parseStoredEntry(raw: null | string): null | StoredEntry {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as StoredEntry).at !== 'number') {
      return null
    }
    return parsed as StoredEntry
  } catch {
    return null
  }
}

function pruneExpiredStoredEntries() {
  const storage = getSessionStorage()
  if (!storage) {
    return
  }
  try {
    const now = Date.now()
    listStoredKeys(storage).forEach((storageKey) => {
      const entry = parseStoredEntry(storage.getItem(storageKey))
      if (!entry || now - entry.at > STORAGE_TTL_MS) {
        storage.removeItem(storageKey)
      }
    })
  } catch {
    // Best-effort sweep; storage failures must not break transfers.
  }
}

function removeStorageItem(storageKey: string) {
  const storage = getSessionStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(storageKey)
  } catch {
    // Ignore storage errors.
  }
}

function takeStoredValue<T>(key: string, id: string): null | T {
  const storage = getSessionStorage()
  if (!storage) {
    return null
  }
  try {
    const storageKey = buildStorageKey(key, id)
    const entry = parseStoredEntry(storage.getItem(storageKey))
    if (!entry) {
      return null
    }
    storage.removeItem(storageKey)
    return entry.value as T
  } catch {
    return null
  }
}

function writeStoredValue(key: string, id: string, value: unknown) {
  const storage = getSessionStorage()
  if (!storage) {
    return
  }
  try {
    const entry: StoredEntry = { at: Date.now(), value }
    storage.setItem(buildStorageKey(key, id), JSON.stringify(entry))
  } catch {
    // Non-serializable payloads or quota errors degrade to in-memory-only
    // transfers (the pre-mirror behavior).
  }
}
