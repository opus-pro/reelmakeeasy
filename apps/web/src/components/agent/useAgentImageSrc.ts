'use client'

import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

/** The URL that serves an image Codex made in this session (`entry.src` is its path on
 *  disk); undefined while there is no path yet. */
export function useAgentImageSrc(sessionId: string, path: string | undefined): string | undefined {
  const apiOrigin = useAtomValue(apiOriginAtom)
  return useMemo(() => {
    if (!path) return undefined
    return new URL(
      `/api/agent/sessions/${sessionId}/image?path=${encodeURIComponent(path)}`,
      apiOrigin,
    ).toString()
  }, [apiOrigin, path, sessionId])
}
