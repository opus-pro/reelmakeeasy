'use client'

import {
  emptyItems,
  RANKING_CLIP_MAX_SEC,
  RANKING_LABEL_MAX,
  RANKING_MAX_ITEMS,
  RANKING_MIN_ITEMS,
  RANKING_TITLE_COLORS,
  RANKING_TITLE_LINES_MAX,
  RANKING_TITLE_WORDS_MAX,
  rankingItemId,
  revealOrder,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type {
  RankingItem,
  RankingProject,
  RankingRevealMode,
  RankingStyle,
  RankingTitle,
  RankingTitleWord,
} from '@shared/types/api/ranking'
import { Button, cn } from '@shared/ui'
import { useRef, useState } from 'react'

const SECTION = 'flex flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/40 p-3'
const HEADING = 'text-xs font-semibold tracking-wide text-secondary uppercase'
const INPUT =
  'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none'

export type RankingEditorProps = {
  focusRank: null | number
  onChange: (next: RankingProject) => void
  onFocusRank: (rank: number) => void
  /** Uploads a video under a rank (the studio saves it and returns the new clip). */
  onUploadClip: (itemId: string, file: File) => Promise<void>
  project: RankingProject
  uploading: ReadonlySet<string>
}

/** The studio's left side: the title, the ranks and their clips, the reveal order, the colours. */
export function RankingEditor(props: RankingEditorProps) {
  const { onChange, project } = props
  return (
    <div className="flex flex-col gap-3">
      <TitleEditor onChange={(title) => onChange({ ...project, title })} title={project.title} />
      <RankRows {...props} />
      <RevealPanel
        count={project.items.length}
        onChange={(reveal) => onChange({ ...project, reveal })}
        reveal={project.reveal}
      />
      <StylePanel onChange={(style) => onChange({ ...project, style })} style={project.style} />
    </div>
  )
}

function ColorDot({
  color,
  onPick,
  selected,
}: {
  color: string
  onPick: (color: string) => void
  selected: boolean
}) {
  return (
    <button
      aria-label={`Colour ${color}`}
      className={cn('size-5 rounded-full border', selected ? 'border-white ring-1 ring-white' : 'border-white/30')}
      onClick={() => onPick(color)}
      style={{ background: color }}
      type="button"
    />
  )
}

function ColorPicker({ onPick, value }: { onPick: (color: string) => void; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {RANKING_TITLE_COLORS.map((c) => (
        <ColorDot color={c} key={c} onPick={onPick} selected={c === value.toLowerCase()} />
      ))}
      <input
        aria-label="Custom colour"
        className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
        onChange={(e) => onPick(e.target.value)}
        type="color"
        value={value}
      />
    </div>
  )
}

/** The title: one to three lines of words, each word in its own colour (keywords pop). */
function TitleEditor({ onChange, title }: { onChange: (title: RankingTitle) => void; title: RankingTitle }) {
  const [active, setActive] = useState<null | [number, number]>(null)
  const setWord = (li: number, wi: number, word: RankingTitleWord) =>
    onChange({
      ...title,
      lines: title.lines.map((line, i) => (i === li ? line.map((w, j) => (j === wi ? word : w)) : line)),
    })
  const activeWord = active ? title.lines[active[0]]?.[active[1]] : undefined
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between">
        <span className={HEADING}>Title</span>
        <label className="flex items-center gap-1.5 text-xs text-secondary">
          Band
          <input
            className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
            onChange={(e) => onChange({ ...title, band: e.target.value })}
            type="color"
            value={title.band}
          />
        </label>
      </div>
      <p className="text-xs text-secondary">
        Split it into words and colour the keywords: a viewer reads the coloured ones first.
      </p>
      {title.lines.map((line, li) => (
        <div className="flex flex-wrap items-center gap-1.5" key={`line-${li}`}>
          {line.map((word, wi) => (
            <input
              aria-label={`Title line ${li + 1}, word ${wi + 1}`}
              className={cn(INPUT, 'w-auto min-w-0 font-bold', active?.[0] === li && active[1] === wi && 'border-white/60')}
              key={`w-${li}-${wi}`}
              maxLength={40}
              onChange={(e) => setWord(li, wi, { ...word, text: e.target.value })}
              onFocus={() => setActive([li, wi])}
              size={Math.max(3, word.text.length)}
              style={{ color: word.color }}
              value={word.text}
            />
          ))}
          {line.length < RANKING_TITLE_WORDS_MAX && (
            <button
              className="rounded-md border border-dashed border-white/20 px-2 py-1 text-xs text-secondary hover:text-primary"
              onClick={() =>
                onChange({
                  ...title,
                  lines: title.lines.map((l, i) => (i === li ? [...l, { color: '#ffffff', text: '' }] : l)),
                })
              }
              type="button"
            >
              + word
            </button>
          )}
          {title.lines.length > 1 && (
            <button
              aria-label={`Remove line ${li + 1}`}
              className="text-xs text-secondary hover:text-primary"
              onClick={() => {
                setActive(null)
                onChange({ ...title, lines: title.lines.filter((_, i) => i !== li) })
              }}
              type="button"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {title.lines.length < RANKING_TITLE_LINES_MAX && (
          <Button
            onClick={() => onChange({ ...title, lines: [...title.lines, [{ color: '#ffffff', text: '' }]] })}
            size="sm"
            variant="secondary"
          >
            Add a line
          </Button>
        )}
        {active && activeWord && (
          <div className="flex items-center gap-2 text-xs text-secondary">
            <span>“{activeWord.text || '…'}” colour</span>
            <ColorPicker onPick={(color) => setWord(active[0], active[1], { ...activeWord, color })} value={activeWord.color} />
            <button
              className="text-secondary hover:text-primary"
              onClick={() => {
                onChange({
                  ...title,
                  lines: title.lines.map((l, i) => (i === active[0] ? l.filter((_, j) => j !== active[1]) : l)),
                })
                setActive(null)
              }}
              type="button"
            >
              Remove word
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/** The ranks, top first: each one's label, its clip (upload, trim) and its place in the list. */
function RankRows({ focusRank, onChange, onFocusRank, onUploadClip, project, uploading }: RankingEditorProps) {
  const setItems = (items: RankingItem[]) => {
    const ranked = items.map((item, i) => ({ ...item, rank: i + 1 }))
    const order =
      ranked.length === project.items.length
        ? project.reveal.order
        : revealOrder(project.reveal.mode === 'custom' ? 'countdown' : project.reveal.mode, ranked.length)
    onChange({ ...project, items: ranked, reveal: { ...project.reveal, order } })
  }
  const move = (i: number, by: number) => {
    const items = [...project.items]
    const j = i + by
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j] as RankingItem, items[i] as RankingItem]
    setItems(items)
  }
  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between">
        <span className={HEADING}>Ranks</span>
        <span className="text-xs text-secondary">1 is the top</span>
      </div>
      {project.items.map((item, i) => (
        <RankRow
          focused={item.rank === focusRank}
          item={item}
          key={item.id}
          onChange={(next) => setItems(project.items.map((it) => (it.id === item.id ? next : it)))}
          onFocus={() => onFocusRank(item.rank)}
          onMoveDown={i < project.items.length - 1 ? () => move(i, 1) : undefined}
          onMoveUp={i > 0 ? () => move(i, -1) : undefined}
          onRemove={
            project.items.length > RANKING_MIN_ITEMS
              ? () => setItems(project.items.filter((it) => it.id !== item.id))
              : undefined
          }
          onUpload={(file) => onUploadClip(item.id, file)}
          uploading={uploading.has(item.id)}
        />
      ))}
      {project.items.length < RANKING_MAX_ITEMS && (
        <Button
          className="w-fit"
          onClick={() => setItems([...project.items, { ...emptyItems(1)[0]!, id: rankingItemId() }])}
          size="sm"
          variant="secondary"
        >
          Add a rank
        </Button>
      )}
    </section>
  )
}

function RankRow({
  focused,
  item,
  onChange,
  onFocus,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpload,
  uploading,
}: {
  focused: boolean
  item: RankingItem
  onChange: (item: RankingItem) => void
  onFocus: () => void
  onMoveDown?: () => void
  onMoveUp?: () => void
  onRemove?: () => void
  onUpload: (file: File) => Promise<void>
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={cn('flex flex-col gap-1.5 rounded-lg border p-2', focused ? 'border-white/40 bg-white/5' : 'border-white/10')}
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
    >
      <div className="flex items-center gap-2">
        <span className="w-7 text-lg font-black text-primary tabular-nums">{item.rank}.</span>
        <input
          aria-label={`Rank ${item.rank} label`}
          className={cn(INPUT, 'min-w-0 flex-1')}
          maxLength={RANKING_LABEL_MAX}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="What happens (emoji welcome 😳)"
          value={item.label}
        />
        <div className="flex items-center gap-0.5 text-secondary">
          <IconButton disabled={!onMoveUp} label="Move up" onClick={onMoveUp}>
            ↑
          </IconButton>
          <IconButton disabled={!onMoveDown} label="Move down" onClick={onMoveDown}>
            ↓
          </IconButton>
          <IconButton disabled={!onRemove} label="Remove rank" onClick={onRemove}>
            ✕
          </IconButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9">
        <Button disabled={uploading} onClick={() => fileRef.current?.click()} size="sm" variant="secondary">
          {uploading ? 'Uploading…' : item.clip ? 'Replace clip' : 'Add clip'}
        </Button>
        <input
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv,.m4v"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onUpload(file)
          }}
          ref={fileRef}
          type="file"
        />
        {item.clip && <TrimFields item={item} onChange={onChange} />}
      </div>
    </div>
  )
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode
  disabled: boolean
  label: string
  onClick?: () => void
}) {
  return (
    <button
      aria-label={label}
      className="rounded px-1.5 py-0.5 text-sm hover:bg-white/10 hover:text-primary disabled:opacity-30 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

/** The part of a clip that plays: from and to, in seconds, within the file and the cap. */
function TrimFields({ item, onChange }: { item: RankingItem; onChange: (item: RankingItem) => void }) {
  const clip = item.clip
  if (!clip) return null
  const set = (start: number, end: number) => {
    const s = Math.max(0, Math.min(start, clip.durationSec - 0.2))
    const e = Math.min(clip.durationSec, Math.max(s + 0.2, Math.min(end, s + RANKING_CLIP_MAX_SEC)))
    onChange({ ...item, clip: { ...clip, trimEndSec: round1(e), trimStartSec: round1(s) } })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-secondary">
      <span className="max-w-[120px] truncate" title={clip.name}>
        {clip.name}
      </span>
      <label className="flex items-center gap-1">
        from
        <input
          className={cn(INPUT, 'w-16 py-0.5 text-xs')}
          min={0}
          onChange={(e) => set(Number(e.target.value), clip.trimEndSec)}
          step={0.1}
          type="number"
          value={clip.trimStartSec}
        />
      </label>
      <label className="flex items-center gap-1">
        to
        <input
          className={cn(INPUT, 'w-16 py-0.5 text-xs')}
          max={clip.durationSec}
          onChange={(e) => set(clip.trimStartSec, Number(e.target.value))}
          step={0.1}
          type="number"
          value={clip.trimEndSec}
        />
      </label>
      <span>
        of {clip.durationSec.toFixed(1)} s · plays {(clip.trimEndSec - clip.trimStartSec).toFixed(1)} s
      </span>
    </div>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

const REVEAL_LABEL: Record<RankingRevealMode, string> = {
  countdown: 'Countdown',
  countup: 'Top first',
  custom: 'Custom',
  shuffle: 'Blind (shuffled)',
}

/** The order the ranks are revealed in: countdown saves #1 for last; blind keeps viewers guessing. */
function RevealPanel({
  count,
  onChange,
  reveal,
}: {
  count: number
  onChange: (reveal: RankingProject['reveal']) => void
  reveal: RankingProject['reveal']
}) {
  const pick = (mode: RankingRevealMode) =>
    onChange({ mode, order: mode === 'custom' ? reveal.order : revealOrder(mode, count, reveal.order, Date.now() % 997) })
  const moveIn = (i: number, by: number) => {
    const order = [...reveal.order]
    const j = i + by
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
    onChange({ mode: 'custom', order })
  }
  return (
    <section className={SECTION}>
      <span className={HEADING}>Reveal order</span>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(REVEAL_LABEL) as RankingRevealMode[]).map((mode) => (
          <button
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              reveal.mode === mode ? 'border-white/50 bg-white/15 text-primary' : 'border-white/10 text-secondary hover:text-primary',
            )}
            key={mode}
            onClick={() => pick(mode)}
            type="button"
          >
            {REVEAL_LABEL[mode]}
          </button>
        ))}
        {reveal.mode === 'shuffle' && (
          <button className="text-xs text-secondary underline hover:text-primary" onClick={() => pick('shuffle')} type="button">
            Shuffle again
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {reveal.order.map((rank, i) => (
          <div className="flex items-center gap-0.5 rounded-md bg-white/10 px-1.5 py-0.5 text-xs text-primary" key={rank}>
            {i > 0 && (
              <button aria-label={`Reveal #${rank} earlier`} className="text-secondary hover:text-primary" onClick={() => moveIn(i, -1)} type="button">
                ‹
              </button>
            )}
            <span className="font-semibold">#{rank}</span>
            {i < reveal.order.length - 1 && (
              <button aria-label={`Reveal #${rank} later`} className="text-secondary hover:text-primary" onClick={() => moveIn(i, 1)} type="button">
                ›
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function StylePanel({ onChange, style }: { onChange: (style: RankingStyle) => void; style: RankingStyle }) {
  const swatch = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex items-center gap-1.5 text-xs text-secondary" key={label}>
      <input
        className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent"
        onChange={(e) => set(e.target.value)}
        type="color"
        value={value}
      />
      {label}
    </label>
  )
  const setNumber = (i: number, v: string) => {
    const numberColors = [...style.numberColors] as RankingStyle['numberColors']
    numberColors[i] = v
    onChange({ ...style, numberColors })
  }
  return (
    <section className={SECTION}>
      <span className={HEADING}>Colours</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {swatch('#1', style.numberColors[0], (v) => setNumber(0, v))}
        {swatch('#2', style.numberColors[1], (v) => setNumber(1, v))}
        {swatch('#3', style.numberColors[2], (v) => setNumber(2, v))}
        {swatch('Other ranks', style.numberColors[3], (v) => setNumber(3, v))}
        {swatch('Labels', style.labelColor, (v) => onChange({ ...style, labelColor: v }))}
        {swatch('Outline', style.outlineColor, (v) => onChange({ ...style, outlineColor: v }))}
      </div>
    </section>
  )
}
