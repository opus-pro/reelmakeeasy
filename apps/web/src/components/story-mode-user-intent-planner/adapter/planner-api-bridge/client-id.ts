const uipClientIdCache = new Map<string, string>()

export function clearUipClientIdCacheForTests(): void {
  uipClientIdCache.clear()
}

export function getUipClientId(sessionId: string): string {
  const cached = uipClientIdCache.get(sessionId)
  if (cached) {
    return cached
  }

  if (typeof window === 'undefined') {
    const ssrClientId = `ssr-${sessionId}`
    uipClientIdCache.set(sessionId, ssrClientId)
    return ssrClientId
  }
  const key = `uip:client-id:${sessionId}`
  const existing = window.sessionStorage.getItem(key)
  if (existing) {
    uipClientIdCache.set(sessionId, existing)
    return existing
  }
  const generated = crypto.randomUUID()
  window.sessionStorage.setItem(key, generated)
  uipClientIdCache.set(sessionId, generated)
  return generated
}
