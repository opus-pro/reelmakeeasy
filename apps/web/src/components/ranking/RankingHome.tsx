'use client'

import type { RankingProjectSummary } from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useStartAgentSession } from '@/components/agent/useStartAgentSession'
import { Edit, Sparkle } from '@/components/icons/core'

import { useRankingApi } from './ranking-api'
import { RankingStudio } from './RankingStudio'
import { SoundLibraryPanel } from './SoundLibraryPanel'
import { StylesPanel } from './StylesPanel'
import { useSoundLibrary } from './useSoundLibrary'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Topics to start from, one click away (a click fills the box; it doesn't start). */
const IDEAS = ['Funniest dog fails', 'Guiltiest cats', 'Worst parking jobs']

type Tab = 'rankings' | 'sounds' | 'styles'

/**
 * The Ranking page: making one with the agent (or by hand), then your rankings, styles and sound
 * library; or the studio for the one in `?id=`.
 */
export function RankingHome() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get('id')
  const asked = params.get('tab')
  const tab: Tab = asked === 'sounds' || asked === 'styles' ? asked : 'rankings'
  const open = useCallback(
    (next: null | string) =>
      router.push(next ? `${pathname}?id=${encodeURIComponent(next)}` : pathname),
    [pathname, router],
  )
  const openLibrary = useCallback(() => router.push(`${pathname}?tab=sounds`), [pathname, router])
  const api = useRankingApi()
  const library = useSoundLibrary()
  const [rankings, setRankings] = useState<null | RankingProjectSummary[]>(null)
  const [styleCount, setStyleCount] = useState<null | number>(null)
  const [error, setError] = useState<null | string>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (id) return
    api
      .list()
      .then(setRankings)
      .catch((e: unknown) => setError(errorText(e)))
    api
      .styles()
      .then((styles) => setStyleCount(styles.length))
      .catch(() => setStyleCount(null))
  }, [api, id])

  const createBlank = async () => {
    setCreating(true)
    try {
      open((await api.create()).id)
    } catch (e) {
      setError(errorText(e))
      setCreating(false)
    }
  }

  if (id)
    return <RankingStudio id={id} key={id} onBack={() => open(null)} onOpenLibrary={openLibrary} />
  const tabs: [Tab, string, null | number | undefined][] = [
    ['rankings', 'Rankings', rankings?.length],
    ['styles', 'Styles', styleCount],
    ['sounds', 'Sound library', library.sounds?.length],
  ]
  return (
    <div className="w-full px-4 pt-20 pb-10 md:px-12 md:pt-10">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-primary">Ranking Builder</h1>
        <p className="mt-1.5 text-sm text-secondary">
          Countdown shorts: a title band, ranks 1 to N, one clip per rank and a meme sound on every
          action.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1.7fr_1fr]">
          <AgentCard />
          <div className="flex flex-col gap-4 rounded-lg bg-white/[0.04] p-5 ring-1 ring-white/[0.08] ring-inset">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-white/[0.08] text-secondary">
                <Edit className="size-[18px]" />
              </span>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-primary">Open the editor</span>
                  <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                    Advanced
                  </span>
                </span>
                <span className="text-[13px] text-secondary">
                  Build it by hand: clips, trims, sounds and effects.
                </span>
              </div>
            </div>
            <button
              className="mt-auto flex h-8 w-fit items-center gap-1.5 rounded-xs bg-white/[0.06] px-3 text-[13px] font-medium text-primary hover:bg-white/10 disabled:opacity-50"
              disabled={creating}
              onClick={() => void createBlank()}
              type="button"
            >
              {creating ? 'Creating…' : '+ New blank ranking'}
            </button>
          </div>
        </div>

        <div className="mt-9 flex gap-6 border-b border-white/[0.08]" role="tablist">
          {tabs.map(([key, label, count]) => (
            <button
              aria-selected={tab === key}
              className={cn(
                'relative flex h-11 items-center gap-1.5 text-[13px] font-medium',
                tab === key ? 'text-primary' : 'text-secondary hover:text-primary',
              )}
              key={key}
              onClick={() => router.push(key === 'rankings' ? pathname : `${pathname}?tab=${key}`)}
              role="tab"
              type="button"
            >
              {label}
              {typeof count === 'number' && (
                <span className="text-[11px] text-white/40">{count}</span>
              )}
              {tab === key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white" />}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === 'sounds' ? (
            <SoundLibraryTab />
          ) : tab === 'styles' ? (
            <StylesPanel />
          ) : (
            <RankingGrid
              creating={creating}
              error={error}
              items={rankings}
              onBlank={() => void createBlank()}
              onOpen={open}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * "Make one with the agent": what it's about, then Start opens a guided (Easy) Ranking chat that
 * already has it, so the agent makes the ranking and goes on to the next question.
 */
function AgentCard() {
  // The chat opens with a full page load: /agent is cross-origin isolated.
  const agent = useStartAgentSession({ hard: true })
  const [topic, setTopic] = useState('')
  const start = () => void agent.start(undefined, { mode: 'ranking_easy', request: topic })
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-accent-green/[0.045] p-5 ring-1 ring-accent-green/30 ring-inset">
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-accent-green/15 text-accent-green">
          <Sparkle className="size-[19px]" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold text-primary">Make one with the agent</span>
            <span className="flex h-[18px] items-center rounded bg-accent-green/15 px-1.5 text-[10px] font-semibold text-accent-green">
              Recommended
            </span>
          </span>
          <span className="text-[13px] text-secondary">
            Easy · Answer a few quick questions, get a finished ranking short.
          </span>
        </div>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
      >
        <input
          aria-label="What's it about?"
          className="h-10 min-w-0 flex-1 rounded-sm border-0 bg-black/25 px-3 py-0 text-sm text-primary ring-1 ring-white/10 ring-inset placeholder:text-white/40 focus:ring-white/30 focus:outline-none"
          maxLength={200}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What's it about? e.g. Funniest dog fails"
          value={topic}
        />
        <button
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-sm bg-white px-4 text-sm font-medium text-[#111] hover:bg-white/85 disabled:opacity-60"
          disabled={agent.starting}
          type="submit"
        >
          {agent.starting ? 'Opening…' : 'Start →'}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-white/40">Ideas</span>
        {IDEAS.map((idea) => (
          <button
            className="flex h-[26px] items-center rounded-full px-2.5 text-xs text-secondary ring-1 ring-white/[0.12] ring-inset hover:text-primary hover:ring-white/30"
            key={idea}
            onClick={() => setTopic(idea)}
            type="button"
          >
            {idea}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Your rankings as cards, newest first; an empty state that points at the agent. */
function RankingGrid({
  creating,
  error,
  items,
  onBlank,
  onOpen,
}: {
  creating: boolean
  error: null | string
  items: null | RankingProjectSummary[]
  onBlank: () => void
  onOpen: (id: string) => void
}) {
  if (error) return <p className="text-sm text-amber-400">{error}</p>
  if (items === null) return <p className="text-sm text-secondary">Loading…</p>
  if (!items.length)
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/[0.14] px-6 text-center">
        <div className="flex -space-x-3">
          <Thumb className="-rotate-6" />
          <Thumb className="z-10" />
          <Thumb className="rotate-6" />
        </div>
        <p className="text-[15px] font-semibold text-primary">No rankings yet</p>
        <p className="max-w-sm text-[13px] text-secondary">
          Your first one takes about five minutes with the agent: type a topic above and press
          Start.
        </p>
        <button
          className="h-8 rounded-xs px-3 text-[13px] text-secondary hover:bg-white/[0.06] hover:text-primary disabled:opacity-50"
          disabled={creating}
          onClick={onBlank}
          type="button"
        >
          + Or start a blank one in the editor
        </button>
      </div>
    )
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <button
          className="grid grid-cols-[54px_1fr] gap-3.5 rounded-xl bg-white/[0.04] p-3 text-left ring-1 ring-white/[0.08] ring-inset transition-colors hover:bg-white/[0.08]"
          key={item.id}
          onClick={() => onOpen(item.id)}
          type="button"
        >
          <Thumb />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="line-clamp-2 text-sm font-semibold text-primary">{item.name}</span>
            <span className="text-xs text-white/40">
              {item.itemCount} ranks · edited {ago(item.updatedAt)}
            </span>
            <span className="mt-auto">
              {item.lastRenderUrl ? (
                <span className="inline-flex h-[18px] items-center rounded bg-accent-green/15 px-1.5 text-[10px] font-semibold text-accent-green">
                  ✓ Exported
                </span>
              ) : (
                <span className="inline-flex h-[18px] items-center rounded bg-white/[0.08] px-1.5 text-[10px] font-semibold text-secondary">
                  Draft
                </span>
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** A ranking short in miniature: the title band, then the ranks down the left. */
function Thumb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-24 w-[54px] shrink-0 flex-col overflow-hidden rounded-[6px] bg-[repeating-linear-gradient(135deg,#2a2a2a_0_4px,#232323_4px_8px)] ring-1 ring-white/10',
        className,
      )}
    >
      <span className="flex h-5 flex-col items-center justify-center gap-[3px] bg-black">
        <span className="flex gap-0.5">
          <span className="h-[3px] w-3 rounded-full bg-white" />
          <span className="h-[3px] w-3 rounded-full bg-[#ff4b3e]" />
        </span>
        <span className="h-[3px] w-6 rounded-full bg-white" />
      </span>
      <span className="flex flex-1 flex-col justify-around p-1">
        {['#ffd23f', '#ff9a1f', '#ff4b3e', '#ffffff', '#ffffff'].map((color, i) => (
          <span className="flex items-center gap-0.5" key={`${color}-${i}`}>
            <span className="text-[6px] leading-none font-black" style={{ color }}>
              {i + 1}
            </span>
            <span className="h-[3px] w-6 rounded-full bg-white/80" />
          </span>
        ))}
      </span>
    </span>
  )
}

/** "2 hr. ago", "yesterday", or the date. */
function ago(iso: string): string {
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.round(minutes)} min. ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)} hr. ago`
  if (hours < 48) return 'yesterday'
  return new Date(iso).toLocaleDateString()
}

function SoundLibraryTab() {
  const library = useSoundLibrary()
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[560px] text-sm text-secondary">
        Your sound effects and short music, kept on this computer. Star the ones you use most: they
        stay on top here and in the studio’s sound pickers. Missing one? Get it free from Pixabay
        sound effects, the YouTube Audio Library or Freesound, then add it here, or drop it into an
        agent chat.
      </p>
      <SoundLibraryPanel library={library} />
    </div>
  )
}
