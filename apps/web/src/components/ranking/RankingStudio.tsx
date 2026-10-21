'use client'

import { isMovingSticker } from '@reelmakeeasy/common/ranking/ranking-motion'
import {
  drawRankingOverlay,
  drawRankingTransition,
  drawSticker,
  projectFonts,
  type StickerImage,
} from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingAdvice,
  rankingProblems,
  rankingTimeline,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { applyRankingTemplate } from '@reelmakeeasy/common/ranking/ranking-template'
import type {
  RankingProject,
  RankingRenderStatus,
  RankingSticker,
  RankingTemplate,
} from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { agentChatUrl } from '@/components/agent/start-easy'
import { Sparkle } from '@/components/icons/core'
import { useSignedUpload } from '@/hooks/useSignedUpload'

import { type RankingApi, useRankingApi } from './ranking-api'
import { loadRankingFonts, STUDIO_RANKING_FONTS } from './ranking-fonts'
import { RankingEditor, type RankingEditorTab } from './RankingEditor'
import { type RankFocusRequest, RankingPreview } from './RankingPreview'
import { loadStickerImage } from './sticker-images'
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
  // A rank picked in the editor (or one whose clip just arrived): the preview jumps to it.
  const [focusRequest, setFocusRequest] = useState<null | RankFocusRequest>(null)
  const pickRank = useCallback((rank: null | number) => {
    setFocusRank(rank)
    if (rank !== null) setFocusRequest((r) => ({ nonce: (r?.nonce ?? 0) + 1, rank }))
  }, [])
  const [fontsReady, setFontsReady] = useState(false)
  const [tab, setTab] = useState<RankingEditorTab>('ranks')
  const [selectedSticker, setSelectedSticker] = useState<null | string>(null)
  const [ask, setAsk] = useState('')
  const askRef = useRef<HTMLInputElement>(null)
  const exporter = useExport(api, project)
  // "/" puts the cursor in the ask bar (unless the user is typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')
      if (e.key !== '/' || typing || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      askRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
        const { items, name, reveal, sounds: chosen, stickers, style, title, transition } = next
        api
          .update(id, {
            items,
            name,
            reveal,
            ...(chosen ? { sounds: chosen } : {}),
            stickers: stickers ?? [],
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
        setProject((p) =>
          p ? { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, clip } : i)) } : p,
        )
        const rank = saved.items.find((i) => i.id === itemId)?.rank
        if (rank) pickRank(rank)
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
    [api, id, pickRank, uploadFile],
  )

  const uploadStickerImage = useCallback(
    async (file: File): Promise<null | string> => {
      setError(null)
      try {
        const { fileUri } = await uploadFile(file, { tempScope: 'ranking' })
        return (await api.addStickerImage(id, fileUri, file.name)).imageUrl
      } catch (e) {
        setError(errorText(e))
        return null
      }
    },
    [api, id, uploadFile],
  )

  if (error && !project) return <p className="p-6 pt-20 text-sm text-amber-400">{error}</p>
  if (!project) return <p className="p-6 pt-20 text-sm text-secondary md:pt-6">Loading…</p>
  const editSticker = (stickerId: string, patch: Partial<RankingSticker>) =>
    change({
      ...project,
      stickers: (project.stickers ?? []).map((s) => (s.id === stickerId ? { ...s, ...patch } : s)),
    })
  return (
    <div className="flex min-h-dvh w-full flex-col pt-14 md:pt-0 lg:h-dvh lg:min-h-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.08] px-4 py-2.5 lg:h-14 lg:flex-nowrap lg:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-1 lg:w-[430px] lg:flex-none">
          <button
            className="flex h-8 shrink-0 items-center gap-1 rounded-xs px-2 text-xs text-secondary hover:bg-white/[0.06] hover:text-primary"
            onClick={onBack}
            type="button"
          >
            ← All rankings
          </button>
          <input
            aria-label="Ranking name"
            className="h-8 min-w-0 flex-1 truncate rounded-xs border-0 bg-transparent px-2 py-0 text-[15px] font-semibold text-primary hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none"
            maxLength={80}
            onChange={(e) => change({ ...project, name: e.target.value })}
            value={project.name}
          />
          <span
            className={cn(
              'shrink-0 text-xs',
              saving === 'error' ? 'text-amber-400' : 'text-white/40',
            )}
          >
            {saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Not saved' : 'Saved'}
          </span>
        </div>
        <AskAgent api={api} inputRef={askRef} onText={setAsk} project={project} text={ask} />
        <div className="flex shrink-0 items-center gap-2 lg:ml-0">
          <StylePicker
            onApply={(template) =>
              change({ ...project, ...applyRankingTemplate(project, template) })
            }
          />
          <ExportButton exporter={exporter} saving={saving === 'saving'} />
        </div>
      </header>
      {error && <p className="px-4 pt-2 text-sm text-amber-400">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col items-center gap-2 bg-[#131313] px-4 pt-4 pb-3 lg:overflow-hidden">
          <RankingPreview
            dockWidth="860px"
            focusRequest={focusRequest}
            fontsReady={fontsReady}
            onEditSticker={editSticker}
            onRankOnScreen={setFocusRank}
            onRemoveSticker={(stickerId) => {
              change({
                ...project,
                stickers: (project.stickers ?? []).filter((s) => s.id !== stickerId),
              })
              setSelectedSticker(null)
            }}
            onSelectSticker={(stickerId) => {
              setSelectedSticker(stickerId)
              // Picking one on the preview opens it in Effects.
              if (stickerId) setTab('effects')
            }}
            project={project}
            selectedSticker={selectedSticker}
            sounds={sounds}
            stageHeight="max(360px, calc(100dvh - 56px - 140px))"
          />
          <ExportNotes exporter={exporter} />
        </section>
        <aside className="flex min-h-[480px] flex-col border-white/[0.08] bg-panel lg:min-h-0 lg:border-l">
          <RankingEditor
            focusRank={focusRank}
            onChange={change}
            onFocusRank={pickRank}
            onOpenLibrary={onOpenLibrary}
            onSelectSticker={setSelectedSticker}
            onTab={setTab}
            onTryAsk={(example) => {
              setAsk(example)
              askRef.current?.focus()
            }}
            onUploadClip={uploadClip}
            onUploadStickerImage={uploadStickerImage}
            project={project}
            selectedSticker={selectedSticker}
            sounds={sounds}
            tab={tab}
            uploading={uploading}
          />
        </aside>
      </div>
    </div>
  )
}

/** Each timeline part's picture as a PNG (data URL), drawn exactly as the preview draws it: a
 *  clip's overlay, or a transition slide. */
export async function drawOverlays(
  project: RankingProject,
): Promise<{ bandHeight: number; overlays: string[]; stickers: Record<string, string> }> {
  // Every sticker picture loaded first: the export waits for them.
  const images = new Map(
    (
      await Promise.all(
        (project.stickers ?? []).flatMap((s) =>
          s.kind === 'image' && s.imageUrl
            ? [loadStickerImage(s.imageUrl).then((img) => [s.imageUrl as string, img] as const)]
            : [],
        ),
      )
    ).flatMap(([url, img]) => (img ? [[url, img] as const] : [])),
  )
  const canvas = document.createElement('canvas')
  canvas.width = RANKING_WIDTH
  canvas.height = RANKING_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't draw the overlay.")
  let bandHeight = 0
  const overlays = rankingTimeline(project).map((part) => {
    if (part.kind === 'transition')
      drawRankingTransition(ctx, project, part.nextRank, STUDIO_RANKING_FONTS)
    else
      bandHeight = drawRankingOverlay(ctx, project, part.segment.revealed, {
        fonts: STUDIO_RANKING_FONTS,
        images,
        // Moving stickers are animated by the render itself, from their own pictures below.
        moving: 'skip',
        rank: part.segment.item.rank,
      }).bandHeight
    return canvas.toDataURL('image/png')
  })
  const stickers: Record<string, string> = {}
  for (const sticker of (project.stickers ?? []).filter(isMovingSticker)) {
    const png = stickerPicture(ctx, project, sticker, images)
    if (png) stickers[sticker.id] = png
  }
  return { bandHeight, overlays, stickers }
}

/**
 * A moving sticker on its own, at rest, as a PNG centred on its anchor (so the render can scale
 * and move it around that point): drawn on the full frame, then cut to the smallest box around
 * the anchor that holds it. Undefined when it draws nothing.
 */
function stickerPicture(
  ctx: CanvasRenderingContext2D,
  project: RankingProject,
  sticker: RankingSticker,
  images: ReadonlyMap<string, StickerImage>,
): string | undefined {
  ctx.clearRect(0, 0, RANKING_WIDTH, RANKING_HEIGHT)
  drawSticker(
    ctx,
    sticker,
    project.style.outlineColor,
    projectFonts(project, STUDIO_RANKING_FONTS),
    images,
  )
  const { data } = ctx.getImageData(0, 0, RANKING_WIDTH, RANKING_HEIGHT)
  const cx = Math.round(sticker.x * RANKING_WIDTH)
  const cy = Math.round(sticker.y * RANKING_HEIGHT)
  let halfW = 0
  let halfH = 0
  for (let y = 0; y < RANKING_HEIGHT; y++)
    for (let x = 0; x < RANKING_WIDTH; x++) {
      if (!data[(y * RANKING_WIDTH + x) * 4 + 3]) continue
      halfW = Math.max(halfW, Math.abs(x - cx) + 2)
      halfH = Math.max(halfH, Math.abs(y - cy) + 2)
    }
  if (!halfW || !halfH) return undefined
  const cut = document.createElement('canvas')
  cut.width = halfW * 2
  cut.height = halfH * 2
  cut
    .getContext('2d')
    ?.drawImage(
      ctx.canvas,
      cx - halfW,
      cy - halfH,
      halfW * 2,
      halfH * 2,
      0,
      0,
      halfW * 2,
      halfH * 2,
    )
  return cut.toDataURL('image/png')
}

/** "Apply style": gives the ranking a saved style's look and sounds (then autosaves). */
type Exporter = ReturnType<typeof useExport>

function StylePicker({ onApply }: { onApply: (template: RankingTemplate) => void }) {
  const api = useRankingApi()
  const [styles, setStyles] = useState<RankingTemplate[]>([])
  useEffect(() => {
    api
      .styles()
      .then(setStyles)
      .catch(() => setStyles([]))
  }, [api])
  if (!styles.length) return null
  return (
    <select
      aria-label="Apply a style"
      className="h-8 w-[136px] rounded-xs border-0 bg-white/[0.06] py-0 pr-8 pl-2.5 text-[13px] font-medium text-primary hover:bg-white/10 focus:ring-1 focus:ring-white/30"
      onChange={(e) => {
        const template = styles.find((s) => s.id === e.target.value)
        e.target.value = ''
        if (template) onApply(template)
      }}
      value=""
    >
      <option value="">Apply style…</option>
      {styles.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}

/** The export: what still stops it, the render's progress, and the finished video. */
function useExport(api: RankingApi, project: null | RankingProject) {
  const [status, setStatus] = useState<null | RankingRenderStatus>(null)
  const [error, setError] = useState<null | string>(null)

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
    if (!project) return
    setError(null)
    try {
      await document.fonts.ready
      const { bandHeight, overlays, stickers } = await drawOverlays(project)
      setStatus(await api.render(project.id, bandHeight, overlays, stickers))
    } catch (e) {
      setError(errorText(e))
    }
  }

  return {
    advice: project ? rankingAdvice(project) : [],
    error,
    exportNow,
    problems: project ? rankingProblems(project) : [],
    status,
  }
}

/** "Export MP4": the render, its progress, then "Download". */
function ExportButton({ exporter, saving }: { exporter: Exporter; saving: boolean }) {
  const { exportNow, problems, status } = exporter
  if (status?.state === 'done' && status.videoUrl)
    return (
      <span className="flex items-center gap-1.5">
        <a
          className="flex h-8 items-center rounded-xs bg-white px-3 text-[13px] font-medium text-[#111] hover:bg-white/85"
          download
          href={status.videoUrl}
        >
          Download MP4
        </a>
        <button
          className="h-8 rounded-xs px-2 text-xs text-secondary hover:bg-white/[0.06] hover:text-primary"
          onClick={() => void exportNow()}
          title="Export again"
          type="button"
        >
          Again
        </button>
      </span>
    )
  const rendering = status?.state === 'rendering'
  return (
    <button
      className="flex h-8 items-center gap-1.5 rounded-xs bg-white px-3 text-[13px] font-medium text-[#111] hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={!!problems.length || rendering || saving}
      onClick={() => void exportNow()}
      title={problems.join(' ') || 'Render a 1080×1920 MP4'}
      type="button"
    >
      {rendering ? `Exporting ${Math.round((status.progress ?? 0) * 100)}%` : 'Export MP4'}
    </button>
  )
}

/** Under the preview: what still stops the export, tips, and a failed export's reason. */
function ExportNotes({ exporter }: { exporter: Exporter }) {
  const { advice, error, problems, status } = exporter
  if (!problems.length && !advice.length && !error && status?.state !== 'failed') return null
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-1 text-xs">
      {problems.length > 0 && <p className="text-secondary">Before export: {problems.join(' ')}</p>}
      {advice.map((tip) => (
        <p className="text-amber-300/80" key={tip}>
          Tip: {tip}
        </p>
      ))}
      {status?.state === 'failed' && <p className="text-amber-400">{status.error}</p>}
      {error && <p className="text-amber-400">{error}</p>}
    </div>
  )
}

/**
 * "Ask the agent": what the user types opens a Ranking chat on this ranking with it as the first
 * message, and the agent does it there (with nothing typed, the chat asks what to do next).
 */
function AskAgent({
  api,
  inputRef,
  onText,
  project,
  text,
}: {
  api: RankingApi
  inputRef: React.RefObject<HTMLInputElement | null>
  onText: (text: string) => void
  project: RankingProject
  text: string
}) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const ask = () => {
    if (opening) return
    setOpening(true)
    setError(null)
    api
      .openChat(project.id, project.name, text)
      .then((sessionId) => router.push(agentChatUrl(sessionId)))
      .catch((e: unknown) => {
        setError(errorText(e))
        setOpening(false)
      })
  }
  return (
    <form
      className="order-last flex h-9 w-full items-center gap-2 rounded-sm bg-white/[0.06] pr-1 pl-3 ring-1 ring-white/[0.12] ring-inset focus-within:bg-white/[0.08] focus-within:shadow-[0_0_0_3px_rgba(190,247,55,0.12)] focus-within:ring-white/40 lg:order-none lg:mx-auto lg:max-w-[460px] lg:flex-1"
      onSubmit={(e) => {
        e.preventDefault()
        ask()
      }}
      title={error ?? 'Press / to ask'}
    >
      <Sparkle className="size-4 shrink-0 text-accent-green" />
      <input
        aria-label="Ask the agent"
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-primary placeholder:text-secondary focus:ring-0 focus:outline-none"
        disabled={opening}
        maxLength={2000}
        onChange={(e) => onText(e.target.value)}
        placeholder="Tell the agent what to change: “add a boom when the dog falls on #2”"
        ref={inputRef}
        value={text}
      />
      {error && <span className="shrink-0 text-xs text-amber-400">Couldn't open the chat</span>}
      <button
        aria-label={text.trim() ? 'Ask the agent' : 'Open the chat'}
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white text-[#111] hover:bg-white/85 disabled:opacity-40"
        disabled={opening}
        type="submit"
      >
        {opening ? (
          <span className="size-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
        ) : (
          <span aria-hidden className="text-sm leading-none font-bold">
            ↑
          </span>
        )}
      </button>
    </form>
  )
}
