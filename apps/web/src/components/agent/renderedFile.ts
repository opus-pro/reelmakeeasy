'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the stored file at `url` is there: a HEAD answering 2xx. The project status
 * keeps naming the delivered file even when it is gone (moved or deleted), so this asks
 * the file itself. A request that fails outright counts as present (nothing is known).
 */
export async function renderedFileExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: 'no-store', method: 'HEAD' })
    return response.ok
  } catch {
    return true
  }
}

/** `renderedFileExists` for `url`, re-checked when it changes; null while checking. */
export function useRenderedFileExists(url: null | string): boolean | null {
  const [state, setState] = useState<null | { exists: boolean; url: string }>(null)
  useEffect(() => {
    if (!url) return undefined
    let cancelled = false
    void renderedFileExists(url).then((exists) => {
      if (!cancelled) setState({ exists, url })
    })
    return () => {
      cancelled = true
    }
  }, [url])
  return state && state.url === url ? state.exists : null
}
