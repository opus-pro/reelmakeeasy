'use client'

import { missingTemplateSounds } from '@reelmakeeasy/common/ranking/ranking-template'
import type { RankingTemplate, RankingTemplateSound } from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { Button } from '@shared/ui'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useRankingApi } from './ranking-api'
import { SoundPicker } from './RankingSoundPanels'
import { useSoundLibrary } from './useSoundLibrary'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const REVEAL_LABEL: Record<RankingTemplate['reveal'], string> = {
  countdown: 'countdown',
  countup: 'top first',
  custom: 'custom order',
  shuffle: 'blind (shuffled, #1 last)',
}

/**
 * Saved ranking styles: the patterns the agent learned from reference Shorts (or saved by
 * hand). Each shows its pacing, title look, labels, stickers and sound plan; a sound the
 * library lacks says what to download, and can be linked once it's added.
 */
export function StylesPanel() {
  const api = useRankingApi()
  const library = useSoundLibrary()
  const [styles, setStyles] = useState<null | RankingTemplate[]>(null)
  const [error, setError] = useState<null | string>(null)

  useEffect(() => {
    api
      .styles()
      .then(setStyles)
      .catch((e: unknown) => setError(errorText(e)))
  }, [api])

  const save = async (style: RankingTemplate, sounds: RankingTemplate['sounds']) => {
    setStyles((list) => list?.map((s) => (s.id === style.id ? { ...s, sounds } : s)) ?? null)
    try {
      const saved = await api.updateStyle(style.id, { sounds })
      setStyles((list) => list?.map((s) => (s.id === saved.id ? saved : s)) ?? null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const remove = async (style: RankingTemplate) => {
    if (!window.confirm(`Delete the style "${style.name}"? Rankings that used it keep their look.`)) return
    try {
      await api.deleteStyle(style.id)
      setStyles((list) => list?.filter((s) => s.id !== style.id) ?? null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-primary">Styles</h1>
        <p className="max-w-[600px] text-sm text-secondary">
          Patterns to make rankings from: paste a YouTube Short in a{' '}
          <Link className="text-accent-green hover:underline" href="/agent">
            Ranking chat
          </Link>{' '}
          and the agent saves its timing, title look, labels and sound plan here. Apply one from the studio, or ask the
          agent to build with it.
        </p>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
      {styles === null && !error && <p className="text-sm text-secondary">Loading…</p>}
      {styles?.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-secondary">
          No styles yet.
        </p>
      )}
      {styles?.map((style) => (
        <StyleCard
          key={style.id}
          onRemove={() => void remove(style)}
          onSounds={(sounds) => void save(style, sounds)}
          sounds={library.sounds ?? []}
          style={style}
        />
      ))}
    </div>
  )
}

function StyleCard({
  onRemove,
  onSounds,
  sounds,
  style,
}: {
  onRemove: () => void
  onSounds: (sounds: RankingTemplate['sounds']) => void
  sounds: LibrarySound[]
  style: RankingTemplate
}) {
  const missing = missingTemplateSounds(style)
  const plan = style.sounds
  const slot = (label: string, sound: RankingTemplateSound, set: (next: RankingTemplateSound) => void) => (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 p-2" key={label + sound.description}>
      <p className="text-xs text-primary">
        {sound.description}
        {!sound.soundId && <span className="ml-2 text-amber-400">not in your library: download one</span>}
      </p>
      <SoundPicker label={label} onChange={(soundId) => set({ ...sound, soundId })} sounds={sounds} value={sound.soundId} />
    </div>
  )
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-fill-secondary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-primary">{style.name}</h2>
          <p className="text-xs text-secondary">
            {style.rankCount} ranks · about {style.perRankSec} s each · {REVEAL_LABEL[style.reveal]}
            {style.source && (
              <>
                {' · from '}
                <a className="text-accent-green hover:underline" href={style.source.url} rel="noreferrer" target="_blank">
                  {style.source.title ?? 'the reference'}
                </a>
              </>
            )}
          </p>
        </div>
        <Button onClick={onRemove} size="sm" variant="secondary">
          Delete
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-1.5 rounded-md px-3 py-2 text-sm font-extrabold" style={{ background: style.title.band }}>
        {style.title.lines.map((line, i) => (
          <span className="flex gap-1.5" key={i}>
            {line.map((word, j) => (
              <span key={j} style={{ color: word.color }}>
                {word.text}
              </span>
            ))}
          </span>
        ))}
      </div>
      {style.notes && <p className="text-sm whitespace-pre-line text-secondary">{style.notes}</p>}
      <div className="grid gap-1 text-xs text-secondary sm:grid-cols-2">
        {style.labels.tone && (
          <p>
            <span className="text-primary">Labels:</span> {style.labels.tone}
            {style.labels.examples.length > 0 && ` (${style.labels.examples.join(', ')})`}
          </p>
        )}
        {style.stickers.habit && (
          <p>
            <span className="text-primary">Stickers:</span> {style.stickers.habit}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wide text-secondary uppercase">
          Sound plan{missing.length > 0 && ` · ${missing.length} to download`}
        </p>
        {plan.onAction.map((sound, i) =>
          slot('On the action', sound, (next) =>
            onSounds({ ...plan, onAction: plan.onAction.map((s, j) => (j === i ? next : s)) }),
          ),
        )}
        {plan.reveal && slot('On each rank', plan.reveal, (next) => onSounds({ ...plan, reveal: next }))}
        {plan.transition && slot('Transition', plan.transition, (next) => onSounds({ ...plan, transition: next }))}
        {plan.music && slot('Music', plan.music, (next) => onSounds({ ...plan, music: next }))}
        {!plan.onAction.length && !plan.reveal && !plan.transition && !plan.music && (
          <p className="text-xs text-secondary">No sounds in this style.</p>
        )}
      </div>
    </section>
  )
}
