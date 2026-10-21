'use client'

import type { RankingProject } from '@shared/types/api/ranking'
import { useAtomValue } from 'jotai'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { useRankingApi } from '@/components/ranking/ranking-api'
import { loadRankingFonts } from '@/components/ranking/ranking-fonts'
import { RankingPreview } from '@/components/ranking/RankingPreview'
import { useSoundLibrary } from '@/components/ranking/useSoundLibrary'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A Ranking chat's right panel: the ranking the agent is building, as the studio previews it
 * (reloaded after every change the agent makes), its latest export, and the studio link.
 * Before the agent has a ranking: what to do first.
 */
export function RankingChatPanel({
  rankingId,
  version,
}: {
  rankingId: null | string
  version: number
}) {
  const api = useRankingApi()
  const library = useSoundLibrary()
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [project, setProject] = useState<null | RankingProject>(null)
  const [videoUrl, setVideoUrl] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    void loadRankingFonts(apiOrigin).then(setFontsReady)
  }, [apiOrigin])

  useEffect(() => {
    if (!rankingId) return
    let live = true
    Promise.all([api.get(rankingId), api.list()])
      .then(([p, list]) => {
        if (!live) return
        setProject(p)
        setVideoUrl(list.find((r) => r.id === rankingId)?.lastRenderUrl ?? null)
        setError(null)
      })
      .catch((e: unknown) => live && setError(errorText(e)))
    return () => {
      live = false
    }
  }, [api, rankingId, version])

  if (!rankingId || (!project && !error))
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-semibold text-primary">Your ranking shows here</p>
        <ul className="flex max-w-sm flex-col gap-2 text-left text-sm text-secondary">
          <li>
            🔗 Paste a YouTube Short to copy its style: timing, title look, labels and sounds.
          </li>
          <li>
            🎬 Attach your clips or photos (the paperclip), one per rank, or ask for AI-made clips.
          </li>
          <li>🔊 Drop sound files into the chat: the agent adds them to your sound library.</li>
        </ul>
        <div className="flex gap-3 text-xs">
          <Link className="text-accent-green hover:underline" href="/ranking?tab=sounds">
            Sound library
          </Link>
          <Link className="text-accent-green hover:underline" href="/ranking?tab=styles">
            Saved styles
          </Link>
        </div>
      </div>
    )

  return (
    <div className="flex size-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-primary">{project?.name ?? 'Ranking'}</p>
        <Link
          className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs text-primary hover:bg-white/10"
          href={`/ranking?id=${encodeURIComponent(rankingId)}`}
        >
          Open in studio
        </Link>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      {project && (
        <div className="mx-auto w-full max-w-[320px]">
          <RankingPreview fontsReady={fontsReady} project={project} sounds={library.sounds ?? []} />
        </div>
      )}
      {videoUrl && (
        <div className="mx-auto flex w-full max-w-[320px] flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-wide text-secondary uppercase">
            Latest export
          </p>
          <video
            className="w-full rounded-lg bg-black"
            controls
            key={videoUrl}
            playsInline
            src={videoUrl}
          />
          <a className="text-xs text-accent-green hover:underline" download href={videoUrl}>
            Download MP4
          </a>
        </div>
      )}
    </div>
  )
}
