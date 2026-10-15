import { reloadPage } from '@/util/hard-navigation'

const RELOADED_AT_KEY = 'cross-origin-isolation-reloaded-at'
const RELOAD_WINDOW_MS = 30_000

// SharedArrayBuffer only exists in a cross-origin isolated document, and isolation
// is fixed by the COOP/COEP headers of the document load. A soft navigation into
// the editor keeps the non-isolated document it started from, so only a real
// document load of the editor route can recover. The sessionStorage window bounds
// that retry -- if the guard can't be persisted (getItem or setItem throws), a
// reload can't be bounded, so we skip it rather than risk looping forever.
// Observing isolation clears the sentinel so a later non-isolated entry can
// recover; a reload that fails to isolate never clears it, keeping the bound.
export function ensureCrossOriginIsolated(): boolean {
  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(RELOADED_AT_KEY)
    } catch {
      // Only costs the next automatic retry, so never let it throw.
    }
    return true
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
  reloadPage()
  return false
}
