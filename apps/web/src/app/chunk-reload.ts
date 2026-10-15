const RELOADED_AT_KEY = 'chunk-error-reloaded-at'
const RELOAD_WINDOW_MS = 30_000

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [^\s]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(error.message)
}

// A stale hashed chunk 404s until the browser re-fetches HTML that references
// the current deployment, so a full reload recovers. The sessionStorage window
// prevents a reload loop when the reload itself fails the same way -- if the
// guard can't be persisted (getItem or setItem throws), a reload can't be
// bounded, so we skip it rather than risk looping forever.
export function reloadOnChunkError(error: Error): boolean {
  if (!isChunkLoadError(error)) {
    return false
  }
  let lastReloadedAt = 0
  try {
    lastReloadedAt = Number(sessionStorage.getItem(RELOADED_AT_KEY)) || 0
  } catch {
    return false
  }
  // Only a finite, non-future timestamp can throttle: a corrupt "Infinity" or
  // ahead-of-clock value would otherwise suppress recovery indefinitely.
  const now = Date.now()
  if (
    Number.isFinite(lastReloadedAt) &&
    lastReloadedAt <= now &&
    now - lastReloadedAt < RELOAD_WINDOW_MS
  ) {
    return false
  }
  try {
    sessionStorage.setItem(RELOADED_AT_KEY, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
