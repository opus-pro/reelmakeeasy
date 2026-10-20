'use client'

import { drawRankingOverlay, drawRankingTransition } from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingProblems,
  rankingTimeline,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject, RankingRenderStatus } from '@shared/types/api/ranking'
import { Button } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { useSignedUpload } from '@/hooks/useSignedUpload'

import { type RankingApi, useRankingApi } from './ranking-api'
import { loadRankingFonts, STUDIO_RANKING_FONTS } from './ranking-fonts'
import { RankingEditor } from './RankingEditor'
import { RankingPreview } from './RankingPreview'
import { useSoundLibrary } from './useSoundLibrary'

/** Edits are saved this long after the last change. */
const SAVE_DELAY_MS = 600
const POLL_MS = 1000

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The Ranking Builder studio: the editor on the left, the live 9:16 preview on the right, and
 * Export, which draws each segment's overlay here (the browser has the font and colour emoji)
 * and has the API cut, overlay and join the clips into one MP4.
 */
export function RankingStudio({
  id,
  onBack,
  onOpenLibrary,
}: {
  id: string
  onBack: () => void
  onOpenLibrary: () => void
}) {
  const api = useRankingApi()
  const library = useSoundLibrary()
  const sounds = library.sounds ?? []
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [project, setProject] = useState<null | RankingProject>(null)
  const [error, setError] = useState<null | string>(null)
  const [saving, setSaving] = useState<'error' | 'saved' | 'saving'>('saved')
  const [focusRank, setFocusRank] = useState<null | number>(1)
  const [fontsReady, setFontsReady] = useState(false)
  const [uploading, setUploading] = useState<ReadonlySet<string>>(() => new Set())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { uploadFile } = useSignedUpload({ module: 'media-temp' })

  useEffect(() => {
    let live = true
    api
      .get(id)
      .then((p) => live && setProject(p))
      .catch((e: unknown) => live && setError(errorText(e)))
    return () => {
      live = false
    }
  }, [api, id])

  useEffect(() => {
    void loadRankingFonts(apiOrigin).then(setFontsReady)
  }, [apiOrigin])

  const change = useCallback(
    (next: RankingProject) => {
      setProject(next)
      setSaving('saving')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const { items, name, reveal, sounds: chosen, style, title, transition } = next
        api
          .update(id, {
            items,
            name,
            reveal,
            ...(chosen ? { sounds: chosen } : {}),
            style,
            title,
            ...(transition ? { transition } : {}),
          })
          .then(() => setSaving('saved'))
          .catch((e: unknown) => {
            setSaving('error')
            setError(errorText(e))
          })
      }, SAVE_DELAY_MS)
    },
    [api, id],
  )

  const uploadClip = useCallback(
    async (itemId: string, file: File) => {
      setUploading((s) => new Set(s).add(itemId))
      setError(null)
      try {
        const { fileUri } = await uploadFile(file, { tempScope: 'ranking' })
        const saved = await api.setClip(id, itemId, fileUri, file.name)
        const clip = saved.items.find((i) => i.id === itemId)?.clip ?? null
        // Only the clip comes from the server: text typed meanwhile stays.
        setProject((p) => (p ? { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, clip } : i)) } : p))
        const rank = saved.items.find((i) => i.id === itemId)?.rank
        if (rank) setFocusRank(rank)
      } catch (e) {
        setError(errorText(e))
      } finally {
        setUploading((s) => {
          const next = new Set(s)
          next.delete(itemId)
          return next
        })
      }
    },
    [api, id, uploadFile],
  )

  if (error && !project) return <p className="p-6 text-sm text-amber-400">{error}</p>
  if (!project) return <p className="p-6 text-sm text-secondary">Loading…</p>
  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <button className="text-sm text-secondary hover:text-primary" onClick={onBack} type="button">
          ← All rankings
        </button>
        <input
          aria-label="Ranking name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-primary hover:border-white/10 focus:border-white/30 focus:outline-none"
          maxLength={80}
          onChange={(e) => change({ ...project, name: e.target.value })}
          value={project.name}
        />
        <span className="text-xs text-secondary">
          {saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Not saved' : 'Saved'}
        </span>
      </header>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 lg:max-w-[560px]">
          <RankingEditor
            focusRank={focusRank}
            onChange={change}
            onFocusRank={setFocusRank}
            onOpenLibrary={onOpenLibrary}
            onUploadClip={uploadClip}
            project={project}
            sounds={sounds}
            uploading={uploading}
          />
        </div>
        <div className="flex flex-col items-center gap-4 lg:sticky lg:top-6">
          <RankingPreview focusRank={focusRank} fontsReady={fontsReady} project={project} sounds={sounds} />
          <ExportPanel api={api} project={project} saving={saving === 'saving'} />
        </div>
      </div>
    </div>
  )
}

/** Each timeline part's picture as a PNG (data URL), drawn exactly as the preview draws it: a
 *  clip's overlay, or a transition slide. */
function drawOverlays(project: RankingProject): { bandHeight: number; overlays: string[] } {
  const canvas = document.createElement('canvas')
  canvas.width = RANKING_WIDTH
  canvas.height = RANKING_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't draw the overlay.")
  let bandHeight = 0
  const overlays = rankingTimeline(project).map((part) => {
    if (part.kind === 'transition') drawRankingTransition(ctx, project, part.nextRank, STUDIO_RANKING_FONTS)
    else bandHeight = drawRankingOverlay(ctx, project, part.segment.revealed, { fonts: STUDIO_RANKING_FONTS }).bandHeight
    return canvas.toDataURL('image/png')
  })
  return { bandHeight, overlays }
}

function ExportPanel({ api, project, saving }: { api: RankingApi; project: RankingProject; saving: boolean }) {
  const [status, setStatus] = useState<null | RankingRenderStatus>(null)
  const [error, setError] = useState<null | string>(null)
  const problems = rankingProblems(project)

  useEffect(() => {
    if (status?.state !== 'rendering') return undefined
    const timer = setTimeout(() => {
      api
        .renderStatus(status.renderId)
        .then(setStatus)
        .catch((e: unknown) => setError(errorText(e)))
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [api, status])

  const exportNow = async () => {
    setError(null)
    try {
      await document.fonts.ready
      const { bandHeight, overlays } = drawOverlays(project)
      setStatus(await api.render(project.id, bandHeight, overlays))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const rendering = status?.state === 'rendering'
  return (
    <div className="flex w-full max-w-[430px] flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/40 p-3">
      <div className="flex items-center gap-3">
        <Button disabled={!!problems.length || rendering || saving} onClick={() => void exportNow()} size="sm">
          {rendering ? `Rendering… ${Math.round((status?.progress ?? 0) * 100)}%` : 'Export MP4'}
        </Button>
        {status?.state === 'done' && status.videoUrl && (
          <a className="text-sm text-primary underline underline-offset-2" download href={status.videoUrl}>
            Download
          </a>
        )}
      </div>
      {problems.length > 0 && <p className="text-xs text-secondary">{problems.join(' ')}</p>}
      {status?.state === 'failed' && <p className="text-xs text-amber-400">{status.error}</p>}
      {error && <p className="text-xs text-amber-400">{error}</p>}
      {status?.state === 'done' && status.videoUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- the user's own render
        <video className="max-h-[50vh] w-auto self-center rounded-lg" controls src={status.videoUrl} />
      )}
    </div>
  )
}
