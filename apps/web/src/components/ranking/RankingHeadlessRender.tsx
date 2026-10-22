'use client'

import { useAtomValue } from 'jotai'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import { useRankingApi } from './ranking-api'
import { loadRankingFonts } from './ranking-fonts'
import { drawOverlays } from './RankingStudio'

/**
 * Draws a ranking's overlays (fonts and pictures loaded first) and starts its render, then marks
 * the page with the result for the headless browser that opened it: `data-render-id` on success,
 * `data-render-error` otherwise.
 */
export function RankingHeadlessRender() {
  const id = useSearchParams().get('id')
  const api = useRankingApi()
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [result, setResult] = useState<{ error?: string; renderId?: string }>({})

  // One render per page: an effect that runs twice (React's development check) shares the first
  // start, rather than asking again and reporting "already rendering".
  const started = useRef<null | Promise<{ error?: string; renderId?: string }>>(null)

  useEffect(() => {
    if (!id) return
    let live = true
    started.current ??= (async () => {
      try {
        const project = await api.get(id)
        await loadRankingFonts(apiOrigin)
        await document.fonts.ready
        const { bandHeight, overlays, stickers } = await drawOverlays(project)
        const status = await api.render(id, bandHeight, overlays, stickers)
        return { renderId: status.renderId }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })()
    void started.current.then((next) => live && setResult(next))
    return () => {
      live = false
    }
  }, [api, apiOrigin, id])

  return (
    <p data-render-error={result.error} data-render-id={result.renderId} id="ranking-render">
      {result.renderId
        ? `Rendering ${result.renderId}`
        : result.error
          ? `Failed: ${result.error}`
          : 'Drawing…'}
    </p>
  )
}
