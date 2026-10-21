'use client'

import type { RankingProjectSummary } from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useStartAgentSession } from '@/components/agent/useStartAgentSession'
import { ClipsVertical, Edit, Sparkle } from '@/components/icons/core'

import { useRankingApi } from './ranking-api'
import { RankingStudio } from './RankingStudio'
import { SoundLibraryPanel } from './SoundLibraryPanel'
import { StylesPanel } from './StylesPanel'
import { useSoundLibrary } from './useSoundLibrary'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The Ranking page: your rankings and your sound library, or the studio for the one in `?id=`. */
export function RankingHome() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get('id')
  const asked = params.get('tab')
  const tab = asked === 'sounds' || asked === 'styles' ? asked : 'rankings'
  const open = useCallback(
    (next: null | string) =>
      router.push(next ? `${pathname}?id=${encodeURIComponent(next)}` : pathname),
    [pathname, router],
  )
  const openLibrary = useCallback(() => router.push(`${pathname}?tab=sounds`), [pathname, router])
  if (id)
    return <RankingStudio id={id} key={id} onBack={() => open(null)} onOpenLibrary={openLibrary} />
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-6">
      <div className="flex gap-1 rounded-lg border border-white/10 p-0.5 self-start" role="tablist">
        {(
          [
            ['rankings', 'Rankings'],
            ['styles', 'Styles'],
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
            onClick={() => router.push(key === 'rankings' ? pathname : `${pathname}?tab=${key}`)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'sounds' ? (
        <SoundLibraryTab />
      ) : tab === 'styles' ? (
        <StylesPanel />
      ) : (
        <RankingList onOpen={open} />
      )}
    </div>
  )
}

function RankingList({ onOpen }: { onOpen: (id: string) => void }) {
  const api = useRankingApi()
  const [items, setItems] = useState<null | RankingProjectSummary[]>(null)
  const [error, setError] = useState<null | string>(null)
  const [creating, setCreating] = useState(false)
  // The chat opens with Ranking's Easy chosen (a full page load: /agent is cross-origin isolated).
  const agent = useStartAgentSession({ hard: true })

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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-primary">Ranking Builder</h1>
        <p className="max-w-[560px] text-sm text-secondary">
          Ranking shorts: a title, ranks counting down, one clip per rank and a meme sound on every
          action.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[3fr_2fr]">
        <button
          className="group flex flex-col gap-3 rounded-2xl border border-accent-green/30 bg-gradient-to-br from-accent-green/10 to-transparent p-5 text-left transition-colors hover:border-accent-green/60 disabled:opacity-60"
          disabled={agent.starting}
          onClick={() => void agent.start(undefined, { mode: 'ranking_easy' })}
          type="button"
        >
          <span className="flex items-center gap-2">
            <Sparkle className="size-5 text-accent-green" />
            <span className="text-base font-semibold text-primary">
              {agent.starting ? 'Opening the chat…' : 'Make one with the agent'}
            </span>
            <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
              Recommended
            </span>
          </span>
          <span className="text-sm text-secondary">
            Answer a few quick questions: a Short to copy, your sounds, how many ranks, your photos
            or AI clips. You get a finished ranking short.
          </span>
          <span className="text-xs font-medium text-accent-green group-hover:underline">
            Start (Easy) →
          </span>
        </button>
        <button
          className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-fill-secondary/40 p-5 text-left transition-colors hover:border-white/30 disabled:opacity-60"
          disabled={creating}
          onClick={() => void create()}
          type="button"
        >
          <span className="flex items-center gap-2">
            <Edit className="size-5 text-secondary" />
            <span className="text-base font-semibold text-primary">
              {creating ? 'Creating…' : 'Build it in the editor'}
            </span>
          </span>
          <span className="text-sm text-secondary">
            Advanced: place every clip, label, sound and sticker yourself. The agent can still help
            any time.
          </span>
        </button>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      {items === null && !error && <p className="text-sm text-secondary">Loading…</p>}
      {items?.length ? (
        <h2 className="text-sm font-semibold text-secondary">Your rankings</h2>
      ) : null}
      {items?.length === 0 && (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-secondary">
          <ClipsVertical className="size-4" />
          No rankings yet. The agent makes your first one in a few minutes.
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

function SoundLibraryTab() {
  const library = useSoundLibrary()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-primary">Sound library</h1>
        <p className="max-w-[560px] text-sm text-secondary">
          Your sound effects and short music, kept on this computer. Star the ones you use most:
          they stay on top here and in the studio’s sound pickers.
        </p>
      </div>
      <SoundLibraryPanel library={library} />
    </div>
  )
}
