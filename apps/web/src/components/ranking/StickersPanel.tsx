'use client'

import {
  animationOf,
  STICKER_LOOPS,
  STICKER_OUTS,
} from '@reelmakeeasy/common/ranking/ranking-motion'
import {
  RANKING_STICKER_TEXT_MAX,
  RANKING_STICKERS_MAX,
  rankingItemId,
  rankingTimeline,
} from '@reelmakeeasy/common/ranking/ranking-project'
import {
  RANKING_FONT_FACES,
  RANKING_FONT_IDS,
  rankingFontFamily,
} from '@reelmakeeasy/common/ranking/ranking-type'
import type {
  RankingFontId,
  RankingProject,
  RankingSticker,
  RankingStickerAnimation,
} from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

const SUBHEAD = 'flex h-5 items-center justify-between text-xs font-semibold text-secondary'
const INPUT =
  'h-8 rounded-xs border-0 bg-white/[0.06] px-2.5 py-0 text-[13px] text-primary placeholder:text-white/40 focus:bg-white/10 focus:ring-1 focus:ring-white/30 focus:outline-none'
/** The studio's Montserrat (the labels' font), as the presets show it. */
const LABEL_FAMILY = '"RME Ranking", "Arial Black", sans-serif'

/** Emoji the trend uses most, one click away. */
const QUICK_EMOJI = ['😂', '💀', '😳', '🔥', '😱', '🤯', '👀', '😭', '🗿', '💯']

/** Captions the trend uses, each in its own look, one click away. */
const PRESETS: Pick<RankingSticker, 'color' | 'font' | 'italic' | 'text'>[] = [
  { color: '#ffffff', font: 'dela', italic: true, text: 'NO WAY' },
  { color: '#ffd23f', text: 'WAIT FOR IT' },
  { color: '#ff4b3e', text: 'BRUH' },
  { color: '#2ee6ff', font: 'dela', italic: true, text: 'CAUGHT' },
]

/** Text colours: white, the trend's red, orange, yellow, cyan, green, pink, black. */
const SWATCHES = [
  '#ffffff',
  '#ff3b30',
  '#ff9a1f',
  '#ffd23f',
  '#2ee6ff',
  '#4ade80',
  '#ff5fd2',
  '#000000',
]

type Entrance = 'fade' | 'none' | 'pop' | 'slide'
const ENTRANCES: [Entrance, string][] = [
  ['none', 'None'],
  ['pop', 'Pop'],
  ['fade', 'Fade'],
  ['slide', 'Slide'],
]
const SLIDES: [RankingStickerAnimation['in'], string][] = [
  ['slide-down', '↓ From top'],
  ['slide-left', '← From left'],
  ['slide-right', '→ From right'],
  ['slide-up', '↑ From bottom'],
]
const LOOP_LABEL: Record<RankingStickerAnimation['loop'], string> = {
  float: 'Float',
  none: 'Still',
  pulse: 'Pulse',
  shake: 'Vibrate',
}
const OUT_LABEL: Record<RankingStickerAnimation['out'], string> = {
  fade: 'Fade',
  none: 'Stays',
  pop: 'Pop',
}

/** A new sticker in the lower middle of the clip area, popping in and fading out. */
const newSticker = (over: Partial<RankingSticker>): RankingSticker => ({
  animation: { in: 'pop', loop: 'none', out: 'fade' },
  color: '#ffffff',
  id: rankingItemId(),
  kind: 'text',
  rank: null,
  rotation: 0,
  size: 0.06,
  x: 0.5,
  y: 0.62,
  ...over,
})

/** What a sticker shows, short: its text, or "Picture". */
const stickerName = (s: RankingSticker) =>
  s.kind === 'image' ? 'Picture' : s.text?.trim() || 'Text'

/** How a text sticker looks in a tile: its font, colour, slant and outline. */
const textLook = (s: Pick<RankingSticker, 'color' | 'font' | 'italic'>): React.CSSProperties => ({
  color: s.color,
  fontFamily: s.font ? `"${rankingFontFamily(s.font)}", ${LABEL_FAMILY}` : LABEL_FAMILY,
  fontWeight: 900,
  paintOrder: 'stroke fill',
  transform: s.italic ? 'skewX(-10deg)' : undefined,
  WebkitTextStroke: '3px #000',
})

/** How long a sticker's span runs: its rank's clip as it plays, or the whole short. */
function spanOf(project: RankingProject, rank: null | number): number {
  if (rank === null) return rankingTimeline(project).reduce((sum, p) => sum + p.durSec, 0) || 1
  const clip = project.items.find((item) => item.rank === rank)?.clip
  return clip ? Math.max(0.1, clip.trimEndSec - clip.trimStartSec) : 4.5
}

const seconds = (sec: number) => sec.toFixed(1)

/**
 * Effects: text, emoji and pictures on the frame. One click adds one, to the rank on screen or
 * the whole short; it is then selected, to drag, resize and turn on the preview and to fine-tune
 * here.
 */
export function StickersPanel({
  focusRank,
  onChange,
  onSelect,
  onUploadImage,
  project,
  selected,
}: {
  /** The rank on screen (new stickers go with it, unless "Whole short" is picked). */
  focusRank: null | number
  onChange: (stickers: RankingSticker[]) => void
  onSelect: (id: null | string) => void
  onUploadImage: (file: File) => Promise<null | string>
  project: RankingProject
  /** The sticker being edited (also outlined on the preview). */
  selected: null | string
}) {
  const stickers = project.stickers ?? []
  const [wholeShort, setWholeShort] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [focusText, setFocusText] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const full = stickers.length >= RANKING_STICKERS_MAX
  const scope = wholeShort || focusRank === null ? null : focusRank
  const add = (over: Partial<RankingSticker>) => {
    const sticker = newSticker({ rank: scope, ...over })
    onChange([...stickers, sticker])
    onSelect(sticker.id)
  }
  const current = stickers.find((s) => s.id === selected) ?? null
  const listed = stickers.filter((s) => s.rank === scope)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-8 rounded-sm bg-white/[0.06] p-0.5" role="radiogroup">
        {focusRank !== null && (
          <button
            aria-checked={!wholeShort}
            className={cn(
              'flex-1 rounded-xs text-[13px] font-medium',
              wholeShort ? 'text-secondary hover:text-primary' : 'bg-white/[0.14] text-primary',
            )}
            onClick={() => setWholeShort(false)}
            role="radio"
            type="button"
          >
            This rank (#{focusRank})
          </button>
        )}
        <button
          aria-checked={scope === null}
          className={cn(
            'flex-1 rounded-xs text-[13px] font-medium',
            scope === null ? 'bg-white/[0.14] text-primary' : 'text-secondary hover:text-primary',
          )}
          onClick={() => setWholeShort(true)}
          role="radio"
          type="button"
        >
          Whole short
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className={SUBHEAD}>
          <span>Add an effect</span>
          <span className="font-normal text-white/40">
            {full ? 'That’s the most a short takes' : 'Click to add'}
          </span>
        </div>
        <div className="grid grid-cols-10 gap-1">
          {QUICK_EMOJI.map((emoji) => (
            <button
              aria-label={`Add ${emoji}`}
              className="flex h-8 items-center justify-center rounded-xs bg-white/[0.04] text-lg transition hover:scale-105 hover:bg-white/10 disabled:opacity-30"
              disabled={full}
              key={emoji}
              onClick={() => add({ size: 0.08, text: emoji })}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((preset) => (
            <button
              aria-label={`Add ${preset.text}`}
              className="flex h-9 items-center justify-center overflow-hidden rounded-xs bg-[#111] ring-1 ring-white/[0.08] ring-inset hover:ring-white/40 disabled:opacity-30"
              disabled={full}
              key={preset.text}
              onClick={() => add({ ...preset, size: 0.06 })}
              type="button"
            >
              <span className="text-sm" style={textLook(preset)}>
                {preset.text}
              </span>
            </button>
          ))}
          <button
            className="flex h-9 items-center justify-center gap-1.5 rounded-xs text-xs text-secondary ring-1 ring-white/[0.12] ring-inset hover:text-primary hover:ring-white/40 disabled:opacity-30"
            disabled={full}
            onClick={() => {
              add({ text: 'YOUR TEXT' })
              setFocusText(true)
            }}
            type="button"
          >
            <span className="font-serif text-sm">T</span> Your text
          </button>
          <button
            className="flex h-9 items-center justify-center gap-1.5 rounded-xs text-xs text-secondary ring-1 ring-white/[0.12] ring-inset hover:text-primary hover:ring-white/40 disabled:opacity-30"
            disabled={uploading || full}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            {uploading ? 'Uploading…' : '🖼 Picture'}
          </button>
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setUploading(true)
              void onUploadImage(file)
                .then((imageUrl) => imageUrl && add({ imageUrl, kind: 'image', size: 0.3 }))
                .finally(() => setUploading(false))
            }}
            ref={fileRef}
            type="file"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className={SUBHEAD}>
          <span>{scope === null ? 'On the whole short' : `On rank #${scope}`}</span>
          <span className="font-normal text-white/40">
            {listed.length} effect{listed.length === 1 ? '' : 's'}
          </span>
        </div>
        {listed.length ? (
          listed.map((s) => (
            <button
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-xs px-1 text-left text-[13px]',
                s.id === selected
                  ? 'bg-white/[0.08] ring-1 ring-[#00b2f8]/60 ring-inset'
                  : 'hover:bg-white/[0.04]',
              )}
              key={s.id}
              onClick={() => onSelect(s.id === selected ? null : s.id)}
              type="button"
            >
              <span className="flex h-7 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-[#111]">
                {s.kind === 'image' && s.imageUrl ? (
                  <img alt="" className="max-h-full max-w-full object-contain" src={s.imageUrl} />
                ) : (
                  <span className="truncate px-0.5 text-[9px]" style={textLook(s)}>
                    {s.text}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-primary">{stickerName(s)}</span>
              <span className="shrink-0 font-mono text-[11px] text-white/40">
                {seconds(s.startSec ?? 0)}–{seconds(s.endSec ?? spanOf(project, s.rank))} s
              </span>
            </button>
          ))
        ) : (
          <p className="py-1 text-xs text-secondary">
            No effects {scope === null ? 'over the whole short' : 'on this rank'} yet. Click one
            above.
          </p>
        )}
      </div>

      {current && (
        <StickerEditor
          autoFocus={focusText}
          key={current.id}
          onChange={(patch) =>
            onChange(stickers.map((s) => (s.id === current.id ? { ...s, ...patch } : s)))
          }
          onDuplicate={() => {
            if (full) return
            const copy = { ...current, id: rankingItemId(), y: Math.min(0.95, current.y + 0.05) }
            onChange([...stickers, copy])
            onSelect(copy.id)
          }}
          onFocused={() => setFocusText(false)}
          onRemove={() => {
            onChange(stickers.filter((s) => s.id !== current.id))
            onSelect(null)
          }}
          span={spanOf(project, current.rank)}
          sticker={current}
        />
      )}
    </div>
  )
}

/** The selected sticker: what it says, its look, its size and tilt, how it moves, when it shows. */
function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-xs text-sm text-secondary hover:bg-white/[0.06] hover:text-primary"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-11 shrink-0 text-xs text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

function StickerEditor({
  autoFocus,
  onChange,
  onDuplicate,
  onFocused,
  onRemove,
  span,
  sticker,
}: {
  /** Put the cursor in its text (just added with "Your text"). */
  autoFocus: boolean
  onChange: (patch: Partial<RankingSticker>) => void
  onDuplicate: () => void
  onFocused: () => void
  onRemove: () => void
  /** How long its rank (or the whole short) plays: the "Shows" bar's length. */
  span: number
  sticker: RankingSticker
}) {
  const animation = animationOf(sticker)
  const setAnimation = (patch: Partial<RankingStickerAnimation>) =>
    onChange({ animation: { ...animation, ...patch } })
  const textRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!autoFocus) return
    textRef.current?.select()
    onFocused()
  }, [autoFocus, onFocused])
  const entrance: Entrance = animation.in.startsWith('slide') ? 'slide' : (animation.in as Entrance)
  const isText = sticker.kind === 'text'
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.08] ring-inset">
      <div className="flex items-center gap-1.5">
        {isText ? (
          <input
            aria-label="Sticker text"
            className={cn(INPUT, 'min-w-0 flex-1 font-semibold')}
            maxLength={RANKING_STICKER_TEXT_MAX}
            onChange={(e) => onChange({ text: e.target.value })}
            ref={textRef}
            value={sticker.text ?? ''}
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-primary">
            {sticker.imageUrl && (
              <img alt="" className="size-8 rounded object-contain" src={sticker.imageUrl} />
            )}
            Picture
          </span>
        )}
        <IconButton label="Duplicate" onClick={onDuplicate}>
          ⧉
        </IconButton>
        <IconButton label="Delete" onClick={onRemove}>
          ✕
        </IconButton>
      </div>

      {isText && (
        <Row label="Font">
          <select
            aria-label="Sticker font"
            className={cn(INPUT, 'min-w-0 flex-1 pr-8')}
            onChange={(e) =>
              onChange({ font: (e.target.value || undefined) as RankingFontId | undefined })
            }
            value={sticker.font ?? ''}
          >
            <option value="">Like the labels</option>
            {RANKING_FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {RANKING_FONT_FACES[id].label}
              </option>
            ))}
          </select>
          <button
            aria-label="Slant"
            aria-pressed={!!sticker.italic}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-xs font-serif italic',
              sticker.italic
                ? 'bg-white/[0.14] text-primary'
                : 'bg-white/[0.06] text-secondary hover:text-primary',
            )}
            onClick={() => onChange({ italic: !sticker.italic })}
            title="Slant"
            type="button"
          >
            I
          </button>
        </Row>
      )}
      {isText && (
        <Row label="Colour">
          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((c) => (
              <button
                aria-label={`Colour ${c}`}
                className={cn(
                  'size-5 rounded-full ring-1 ring-white/20',
                  c === sticker.color.toLowerCase() &&
                    'ring-[1.5px] ring-white ring-offset-2 ring-offset-[#1e1e1e]',
                )}
                key={c}
                onClick={() => onChange({ color: c })}
                style={{ background: c }}
                type="button"
              />
            ))}
            <label
              aria-label="Your own colour"
              className="relative flex size-5 cursor-pointer items-center justify-center rounded-full text-xs text-secondary ring-1 ring-white/20 hover:text-primary"
            >
              +
              <input
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => onChange({ color: e.target.value })}
                type="color"
                value={sticker.color}
              />
            </label>
          </div>
        </Row>
      )}
      <Row label="Size">
        <input
          aria-label="Size"
          className="min-w-0 flex-1 accent-white"
          max={isText ? 20 : 100}
          min={isText ? 2 : 5}
          onChange={(e) => onChange({ size: Number(e.target.value) / 100 })}
          type="range"
          value={Math.round(sticker.size * 100)}
        />
        <span className="w-6 font-mono text-xs text-secondary">
          {Math.round(sticker.size * 100)}
        </span>
        <span className="text-xs text-secondary">Tilt</span>
        <input
          aria-label="Tilt"
          className="min-w-0 flex-1 accent-white"
          max={45}
          min={-45}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          onDoubleClick={() => onChange({ rotation: 0 })}
          type="range"
          value={Math.max(-45, Math.min(45, sticker.rotation))}
        />
        <span className="w-8 text-right font-mono text-xs text-secondary">{sticker.rotation}°</span>
      </Row>
      <Row label="In">
        <Chips
          onPick={(v) =>
            setAnimation({ in: v === 'slide' ? 'slide-up' : (v as RankingStickerAnimation['in']) })
          }
          options={ENTRANCES}
          value={entrance}
        />
      </Row>
      {entrance === 'slide' && (
        <Row label="">
          <Chips onPick={(v) => setAnimation({ in: v })} options={SLIDES} value={animation.in} />
        </Row>
      )}
      <Row label="Loop">
        <Chips
          onPick={(v) => setAnimation({ loop: v })}
          options={STICKER_LOOPS.map((o): [typeof o, string] => [o, LOOP_LABEL[o]])}
          value={animation.loop}
        />
      </Row>
      <Row label="Out">
        <Chips
          onPick={(v) => setAnimation({ out: v })}
          options={STICKER_OUTS.map((o): [typeof o, string] => [o, OUT_LABEL[o]])}
          value={animation.out}
        />
      </Row>
      <Row label="Shows">
        <ShowsBar
          end={sticker.endSec ?? null}
          onChange={(startSec, endSec) => onChange({ endSec, startSec })}
          span={span}
          start={sticker.startSec ?? 0}
        />
      </Row>
    </div>
  )
}

/** One choice as a row of chips (a sticker's entrance, movement or exit). */
function Chips<T extends string>({
  onPick,
  options,
  value,
}: {
  onPick: (value: T) => void
  options: readonly [T, string][]
  value: T
}) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup">
      {options.map(([option, name]) => (
        <button
          aria-checked={option === value}
          className={cn(
            'h-7 rounded-xxs px-2.5 text-xs transition-colors',
            option === value
              ? 'bg-white/[0.14] text-primary ring-1 ring-white/40 ring-inset'
              : 'bg-white/[0.06] text-secondary hover:bg-white/10 hover:text-primary',
          )}
          key={option}
          onClick={() => onPick(option)}
          role="radio"
          type="button"
        >
          {name}
        </button>
      ))}
    </div>
  )
}

/**
 * When a sticker shows, as a window on a bar the length of its rank (or the whole short): drag
 * either end, or the middle to slide it. An end dragged to the bar's end means "to the end".
 */
function ShowsBar({
  end,
  onChange,
  span,
  start,
}: {
  end: null | number
  onChange: (startSec: number | undefined, endSec: null | number) => void
  span: number
  start: number
}) {
  const bar = useRef<HTMLDivElement>(null)
  const drag = useRef<null | {
    at: number
    edge: 'end' | 'move' | 'start'
    from: [number, number]
  }>(null)
  const to = Math.min(span, end ?? span)
  const from = Math.min(start, to)
  const secAt = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect()
    if (!box) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * span
  }
  const apply = (s: number, e: number) => {
    const startSec = Math.round(Math.max(0, Math.min(s, e - 0.2)) * 10) / 10
    const endSec = Math.round(Math.min(span, Math.max(e, startSec + 0.2)) * 10) / 10
    onChange(startSec > 0 ? startSec : undefined, endSec >= span - 0.05 ? null : endSec)
  }
  const edgeAt = (at: number): 'end' | 'move' | 'start' => {
    const near = span * 0.06
    if (Math.abs(at - from) < near) return 'start'
    if (Math.abs(at - to) < near) return 'end'
    if (at > from && at < to) return 'move'
    return at < from ? 'start' : 'end'
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        aria-label="When it shows: drag its ends, or the middle to slide it"
        className="relative h-6 min-w-0 flex-1 cursor-pointer touch-none rounded-xxs bg-white/[0.06]"
        onLostPointerCapture={() => (drag.current = null)}
        onPointerDown={(e) => {
          const at = secAt(e.clientX)
          const edge = edgeAt(at)
          drag.current = { at, edge, from: [from, to] }
          e.currentTarget.setPointerCapture(e.pointerId)
          if (edge === 'start') apply(at, to)
          if (edge === 'end') apply(from, at)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const at = secAt(e.clientX)
          if (d.edge === 'start') apply(at, d.from[1])
          else if (d.edge === 'end') apply(d.from[0], at)
          else {
            const shift = Math.max(-d.from[0], Math.min(span - d.from[1], at - d.at))
            apply(d.from[0] + shift, d.from[1] + shift)
          }
        }}
        onPointerUp={() => (drag.current = null)}
        ref={bar}
        role="group"
      >
        <span
          className="absolute inset-y-0 flex items-center justify-between rounded-xxs bg-[#00b2f8]/[0.28] px-0.5 ring-[1.5px] ring-[#00b2f8] ring-inset"
          style={{ left: `${(from / span) * 100}%`, width: `${((to - from) / span) * 100}%` }}
        >
          <span className="h-3 w-[3px] rounded-full bg-white" />
          <span className="h-3 w-[3px] rounded-full bg-white" />
        </span>
      </div>
      <span className="shrink-0 font-mono text-xs text-secondary">
        {seconds(from)}–{seconds(to)} s
      </span>
    </div>
  )
}
