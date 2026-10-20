'use client'

import type { RankingProjectSummary } from '@shared/types/api/ranking'
import { Button, cn } from '@shared/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useRankingApi } from './ranking-api'
import { RankingStudio } from './RankingStudio'
import { SoundLibraryPanel } from './SoundLibraryPanel'
import { useSoundLibrary } from './useSoundLibrary'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The Ranking page: your rankings and your sound library, or the studio for the one in `?id=`. */
export function RankingHome() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get('id')
  const tab = params.get('tab') === 'sounds' ? 'sounds' : 'rankings'
  const open = useCallback(
    (next: null | string) => router.push(next ? `${pathname}?id=${encodeURIComponent(next)}` : pathname),
    [pathname, router],
  )
  const openLibrary = useCallback(() => router.push(`${pathname}?tab=sounds`), [pathname, router])
  if (id) return <RankingStudio id={id} key={id} onBack={() => open(null)} onOpenLibrary={openLibrary} />
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-6">
      <div className="flex gap-1 rounded-lg border border-white/10 p-0.5 self-start" role="tablist">
        {(
          [
            ['rankings', 'Rankings'],
            ['sounds', 'Sound library'],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-selected={tab === key}
            className={cn(
              'rounded-md px-3 py-1 text-sm',
              tab === key ? 'bg-white/15 text-primary' : 'text-secondary hover:text-primary',
            )}
            key={key}
            onClick={() => router.push(key === 'sounds' ? `${pathname}?tab=sounds` : pathname)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'sounds' ? <SoundLibraryTab /> : <RankingList onOpen={open} />}
    </div>
  )
}

function SoundLibraryTab() {
  const library = useSoundLibrary()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-primary">Sound library</h1>
        <p className="max-w-[560px] text-sm text-secondary">
          Your sound effects and short music, kept on this computer. Star the ones you use most: they stay on top here
          and in the studio’s sound pickers.
        </p>
      </div>
      <SoundLibraryPanel library={library} />
    </div>
  )
}

function RankingList({ onOpen }: { onOpen: (id: string) => void }) {
  const api = useRankingApi()
  const [items, setItems] = useState<null | RankingProjectSummary[]>(null)
  const [error, setError] = useState<null | string>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api
      .list()
      .then(setItems)
      .catch((e: unknown) => setError(errorText(e)))
  }, [api])

  const create = async () => {
    setCreating(true)
    try {
      onOpen((await api.create()).id)
    } catch (e) {
      setError(errorText(e))
      setCreating(false)
    }
  }

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-primary">Ranking Builder</h1>
          <p className="max-w-[560px] text-sm text-secondary">
            Make a ranking short: a title with coloured keywords, ranks 1 to N, and one clip per rank. Each label is
            revealed as its clip plays, in countdown, top-first or blind order. Export a 1080×1920 MP4.
          </p>
        </div>
        <Button disabled={creating} onClick={() => void create()}>
          {creating ? 'Creating…' : 'New ranking'}
        </Button>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      {items === null && !error && <p className="text-sm text-secondary">Loading…</p>}
      {items?.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-secondary">
          No rankings yet. Start one, add five funny clips, and label them.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {items?.map((item) => (
          <button
            className="flex flex-col gap-1 rounded-xl border border-white/10 bg-fill-secondary/40 p-4 text-left hover:border-white/30"
            key={item.id}
            onClick={() => onOpen(item.id)}
            type="button"
          >
            <span className="truncate text-sm font-semibold text-primary">{item.name}</span>
            <span className="text-xs text-secondary">
              {item.itemCount} ranks · {new Date(item.updatedAt).toLocaleString()}
              {item.lastRenderUrl ? ' · exported' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
