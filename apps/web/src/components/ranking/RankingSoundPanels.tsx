'use client'

import {
  DEFAULT_RANKING_SOUNDS,
  DEFAULT_RANKING_TRANSITION,
  hasOwnSlideText,
  RANKING_TRANSITION_MAX_SEC,
  RANKING_TRANSITION_MIN_SEC,
  RANKING_TRANSITION_TEXT_MAX,
  slideTextOf,
  transitionText,
  withSlideText,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingSounds, RankingTransition } from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { previewSound } from './sound-player'

const SECTION = 'flex flex-col gap-2.5'
const HEADING = 'text-xs font-semibold text-secondary'
const INPUT =
  'rounded-xs border-0 bg-white/[0.06] px-2.5 py-1 text-[13px] text-primary placeholder:text-white/40 focus:bg-white/10 focus:ring-1 focus:ring-white/30 focus:outline-none'

/**
 * One slide's text: the template's until changed; Reset puts it back. Typing goes into a draft
 * that is kept on Enter or when the box loses focus (Escape drops it): the slide's text is
 * trimmed where it is drawn, so saving every keystroke would eat the space just typed.
 */
function SlideText({
  focused,
  onChange,
  own,
  rank,
  shown,
  template,
}: {
  focused: boolean
  onChange: (text: null | string) => void
  own: boolean
  rank: number
  shown: string
  template: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<null | string>(null)
  // The slide on the (paused) preview: bring its row into view inside the editor's own scroll
  // box, never by scrolling the page (below lg the page scrolls, and the preview would leave).
  useEffect(() => {
    const row = ref.current
    const panel = row?.closest<HTMLElement>('[role="tabpanel"]')
    if (!focused || !row || !panel || panel.scrollHeight <= panel.clientHeight) return
    const r = row.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    if (r.top < p.top) panel.scrollTop += r.top - p.top
    else if (r.bottom > p.bottom) panel.scrollTop += r.bottom - p.bottom
  }, [focused])
  const keep = () => {
    if (draft === null) return
    const text = slideTextOf(draft)
    // Typing the template's own words back makes it follow the template again.
    if (text !== shown) onChange(text === template ? null : text)
    setDraft(null)
  }
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xs pr-1 text-xs',
        focused && 'bg-white/[0.04] ring-1 ring-[#00b2f8]/60 ring-inset',
      )}
    >
      <span className="w-20 shrink-0 pl-1 text-secondary">Before #{rank}</span>
      <input
        aria-label={`Text of the slide before #${rank}`}
        className={cn(INPUT, 'min-w-0 flex-1', !own && draft === null && 'text-white/60')}
        maxLength={RANKING_TRANSITION_TEXT_MAX}
        onBlur={keep}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter that picks an input method's candidate isn't "done".
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter') keep()
          if (e.key === 'Escape') setDraft(null)
        }}
        placeholder="(blank slide)"
        ref={ref}
        value={draft ?? shown}
      />
      {own ? (
        <button
          className="shrink-0 rounded-xxs px-1.5 py-0.5 text-[11px] text-secondary hover:bg-white/[0.06] hover:text-primary"
          onClick={() => {
            setDraft(null)
            onChange(null)
          }}
          title="Show the same text as every slide"
          type="button"
        >
          Reset
        </button>
      ) : (
        <span className="w-[42px] shrink-0 text-center text-[11px] text-white/30">template</span>
      )}
    </div>
  )
}

/** A sound from the library (favourites first, as the library sorts them), with a play button. */
export function SoundPicker({
  label,
  onChange,
  sounds,
  value,
}: {
  label: string
  onChange: (id: null | string) => void
  sounds: LibrarySound[]
  value: null | string
}) {
  const chosen = sounds.find((s) => s.id === value)
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-secondary">
      <span className="w-24">{label}</span>
      <select
        className={cn(INPUT, 'min-w-0 flex-1 pr-8')}
        onChange={(e) => onChange(e.target.value || null)}
        value={chosen ? chosen.id : ''}
      >
        <option value="">None</option>
        {sounds.map((s) => (
          <option key={s.id} value={s.id}>
            {s.favorite ? '★ ' : ''}
            {s.name} · {s.durationSec.toFixed(1)} s
          </option>
        ))}
      </select>
      <button
        aria-label={`Play ${label}`}
        className="rounded-md bg-white/10 px-2 py-1 text-primary hover:bg-white/20 disabled:opacity-30"
        disabled={!chosen}
        onClick={(e) => {
          e.preventDefault()
          if (chosen) previewSound(chosen)
        }}
        type="button"
      >
        ▶
      </button>
    </label>
  )
}

/** The short's sounds: one that plays on every reveal, and a music bed under everything. */
export function SoundsPanel({
  onChange,
  onOpenLibrary,
  sounds,
  value,
}: {
  onChange: (sounds: RankingSounds) => void
  onOpenLibrary: () => void
  sounds: LibrarySound[]
  value: RankingSounds | undefined
}) {
  const v = value ?? DEFAULT_RANKING_SOUNDS
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between">
        <span className={HEADING}>Sound</span>
        <button
          className="text-xs text-secondary underline hover:text-primary"
          onClick={onOpenLibrary}
          type="button"
        >
          Sound library
        </button>
      </div>
      {sounds.length === 0 && (
        <p className="text-xs text-secondary">
          Upload sound effects and music to your sound library to use them here.
        </p>
      )}
      <SoundPicker
        label="On each reveal"
        onChange={(reveal) => onChange({ ...v, reveal })}
        sounds={sounds}
        value={v.reveal}
      />
      <SoundPicker
        label="Background"
        onChange={(music) => onChange({ ...v, music })}
        sounds={sounds}
        value={v.music}
      />
      {v.music && (
        <label className="flex items-center gap-2 text-xs text-secondary">
          <span className="w-24">Music level</span>
          <input
            className="flex-1"
            max={100}
            min={0}
            onChange={(e) => onChange({ ...v, musicVolume: Number(e.target.value) / 100 })}
            type="range"
            value={Math.round(v.musicVolume * 100)}
          />
          <span className="w-10 text-right tabular-nums">{Math.round(v.musicVolume * 100)}%</span>
        </label>
      )}
    </section>
  )
}

/**
 * The slide between ranks: on or off, its text (one template for every slide, and any slide's
 * own), colours, length and sound.
 */
export function TransitionPanel({
  focusSlide,
  onChange,
  slides,
  sounds,
  value,
}: {
  /** The slide to bring into view (its row is outlined): the rank it leads into. */
  focusSlide?: null | number
  onChange: (transition: RankingTransition) => void
  /** The slides in play order, by the rank each leads into. */
  slides: number[]
  sounds: LibrarySound[]
  value: RankingTransition | undefined
}) {
  const v = value ?? DEFAULT_RANKING_TRANSITION
  return (
    <section className={SECTION}>
      <label className="flex items-center justify-between">
        <span className={HEADING}>Slide between ranks</span>
        <input
          aria-label="Show a slide between ranks"
          checked={v.enabled}
          onChange={(e) => onChange({ ...v, enabled: e.target.checked })}
          type="checkbox"
        />
      </label>
      {v.enabled && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-xs text-secondary">
            <span className="w-20">Every slide</span>
            <input
              className={cn(INPUT, 'min-w-0 flex-1')}
              maxLength={RANKING_TRANSITION_TEXT_MAX}
              onChange={(e) => onChange({ ...v, text: e.target.value })}
              placeholder="Number {rank}…"
              value={v.text}
            />
          </label>
          <p className="pl-[88px] text-xs text-white/40">
            {'{rank}'} becomes the next rank’s number. Change any one slide below, or click it on
            the preview.
          </p>
          {slides.length > 0 && (
            <div className="flex flex-col gap-1">
              {slides.map((rank) => (
                <SlideText
                  focused={focusSlide === rank}
                  key={rank}
                  onChange={(text) => onChange(withSlideText(v, rank, text))}
                  own={hasOwnSlideText(v, rank)}
                  rank={rank}
                  shown={transitionText(v, rank)}
                  template={transitionText(withSlideText(v, rank, null), rank)}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-xs text-secondary">
            <label className="flex items-center gap-1.5">
              <input
                className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
                onChange={(e) => onChange({ ...v, background: e.target.value })}
                type="color"
                value={v.background}
              />
              Background
            </label>
            <label className="flex items-center gap-1.5">
              <input
                className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
                onChange={(e) => onChange({ ...v, textColor: e.target.value })}
                type="color"
                value={v.textColor}
              />
              Text
            </label>
            <label className="flex items-center gap-1.5">
              Length
              <input
                className="w-24"
                max={RANKING_TRANSITION_MAX_SEC}
                min={RANKING_TRANSITION_MIN_SEC}
                onChange={(e) => onChange({ ...v, durationSec: Number(e.target.value) })}
                step={0.1}
                type="range"
                value={v.durationSec}
              />
              <span className="tabular-nums">{v.durationSec.toFixed(1)} s</span>
            </label>
          </div>
          <SoundPicker
            label="Sound"
            onChange={(sound) => onChange({ ...v, sound })}
            sounds={sounds}
            value={v.sound}
          />
        </>
      )}
    </section>
  )
}
