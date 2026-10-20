'use client'

import {
  emptyItems,
  RANKING_CLIP_MAX_SEC,
  RANKING_CUES_MAX,
  RANKING_LABEL_MAX,
  RANKING_MAX_ITEMS,
  RANKING_MIN_ITEMS,
  RANKING_TITLE_COLORS,
  RANKING_TITLE_LINES_MAX,
  RANKING_TITLE_WORDS_MAX,
  rankingItemId,
  revealOrder,
} from '@reelmakeeasy/common/ranking/ranking-project'
import { RANKING_FONT_FACES, RANKING_FONT_IDS } from '@reelmakeeasy/common/ranking/ranking-type'
import type {
  RankingCue,
  RankingFontId,
  RankingItem,
  RankingNumberFormat,
  RankingProject,
  RankingRevealMode,
  RankingStyle,
  RankingTitle,
  RankingTitleWord,
} from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { Button, cn } from '@shared/ui'
import { useRef, useState } from 'react'

import { SoundsPanel, TransitionPanel } from './RankingSoundPanels'
import { previewSound } from './sound-player'
import { StickersPanel } from './StickersPanel'

const SECTION = 'flex flex-col gap-2 rounded-xl border border-white/10 bg-fill-secondary/40 p-3'
const HEADING = 'text-xs font-semibold tracking-wide text-secondary uppercase'
const INPUT =
  'rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none'

export type RankingEditorProps = {
  focusRank: null | number
  /** Opens the sound library (the Sounds tab). */
  onOpenLibrary: () => void
  /** The user's sound library, for the sound pickers. */
  sounds: LibrarySound[]
  onChange: (next: RankingProject) => void
  onFocusRank: (rank: number) => void
  /** Uploads a sticker picture; resolves its address (null when it failed). */
  onUploadStickerImage: (file: File) => Promise<null | string>
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
      <SoundsPanel
        onChange={(sounds) => onChange({ ...project, sounds })}
        onOpenLibrary={props.onOpenLibrary}
        sounds={props.sounds}
        value={project.sounds}
      />
      <TransitionPanel
        onChange={(transition) => onChange({ ...project, transition })}
        sounds={props.sounds}
        value={project.transition}
      />
      <StickersPanel
        onChange={(stickers) => onChange({ ...project, stickers })}
        onUploadImage={props.onUploadStickerImage}
        project={project}
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
function RankRows({ focusRank, onChange, onFocusRank, onUploadClip, project, sounds, uploading }: RankingEditorProps) {
  // Which row is being dragged, and where it would land (before row `target`).
  const [drag, setDrag] = useState<{ dragging: null | number; target: null | number }>({
    dragging: null,
    target: null,
  })
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
        <span className="text-xs text-secondary">1 is the top · drag ⠿ to reorder</span>
      </div>
      {project.items.map((item, i) => (
        <RankRow
          drag={{
            dragging: drag.dragging === i,
            line: drag.dragging !== null && drag.target === i ? 'before' : drag.dragging !== null && drag.target === i + 1 && i === project.items.length - 1 ? 'after' : null,
            onDragEnd: () => setDrag({ dragging: null, target: null }),
            onDragOver: (e) => {
              if (drag.dragging === null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const box = e.currentTarget.getBoundingClientRect()
              const target = e.clientY < box.top + box.height / 2 ? i : i + 1
              if (target !== drag.target) setDrag({ ...drag, target })
            },
            onDragStart: (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', item.id)
              setDrag({ dragging: i, target: null })
            },
            onDrop: (e) => {
              e.preventDefault()
              const { dragging, target } = drag
              if (dragging !== null && target !== null && target !== dragging && target !== dragging + 1)
                setItems(moveItem(project.items, dragging, target))
              setDrag({ dragging: null, target: null })
            },
          }}
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
          sounds={sounds}
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

type RowDrag = {
  dragging: boolean
  /** A bar above (or, on the last row, below) where the dragged row would land. */
  line: 'after' | 'before' | null
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
}

function RankRow({
  drag,
  focused,
  item,
  onChange,
  onFocus,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpload,
  uploading,
  sounds,
}: {
  drag: RowDrag
  focused: boolean
  item: RankingItem
  onChange: (item: RankingItem) => void
  onFocus: () => void
  onMoveDown?: () => void
  onMoveUp?: () => void
  onRemove?: () => void
  onUpload: (file: File) => Promise<void>
  sounds: LibrarySound[]
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1.5 rounded-lg border p-2',
        focused ? 'border-white/40 bg-white/5' : 'border-white/10',
        drag.dragging && 'opacity-40',
      )}
      data-rank-row
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
    >
      {drag.line === 'before' && <span className="absolute inset-x-0 -top-1.5 h-0.5 rounded bg-white" />}
      {drag.line === 'after' && <span className="absolute inset-x-0 -bottom-1.5 h-0.5 rounded bg-white" />}
      <div className="flex items-center gap-2">
        <span
          aria-label={`Drag rank ${item.rank}`}
          className="cursor-grab px-0.5 text-secondary select-none hover:text-primary active:cursor-grabbing"
          draggable
          onDragStart={(e) => {
            // The whole row is what moves: show it as the drag image.
            const row = e.currentTarget.closest('[data-rank-row]')
            if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 16, 16)
            drag.onDragStart(e as unknown as React.DragEvent<HTMLDivElement>)
          }}
          role="button"
          tabIndex={-1}
          title="Drag to reorder"
        >
          ⠿
        </span>
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
      <div className="flex flex-wrap items-center gap-2 pl-12">
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
      <div className="pl-12">
        <CueList item={item} onChange={onChange} sounds={sounds} />
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

/**
 * A rank's meme sounds: each one plays at a moment of the clip (seconds from where the clip
 * starts playing). Put them on the action: the fall, the bite, the reveal.
 */
function CueList({
  item,
  onChange,
  sounds,
}: {
  item: RankingItem
  onChange: (item: RankingItem) => void
  sounds: LibrarySound[]
}) {
  const cues = item.cues ?? []
  const playSec = item.clip ? Math.max(0, item.clip.trimEndSec - item.clip.trimStartSec) : 0
  const setCues = (next: RankingCue[]) => onChange({ ...item, cues: next })
  if (!item.clip) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-secondary">
      <span>Sounds</span>
      {cues.map((cue) => (
        <span className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5" key={cue.id}>
          <select
            aria-label="Cue sound"
            className="max-w-[120px] truncate bg-transparent text-primary focus:outline-none"
            onChange={(e) => setCues(cues.map((c) => (c.id === cue.id ? { ...c, soundId: e.target.value } : c)))}
            value={cue.soundId}
          >
            {sounds.map((s) => (
              <option key={s.id} value={s.id}>
                {s.favorite ? '★ ' : ''}
                {s.name}
              </option>
            ))}
          </select>
          <span>at</span>
          <input
            aria-label="Cue time"
            className="w-12 bg-transparent text-primary tabular-nums focus:outline-none"
            max={playSec}
            min={0}
            onChange={(e) =>
              setCues(
                cues.map((c) =>
                  c.id === cue.id ? { ...c, atSec: Math.max(0, Math.min(playSec, Number(e.target.value))) } : c,
                ),
              )
            }
            step={0.1}
            type="number"
            value={cue.atSec}
          />
          <span>s</span>
          <button
            aria-label="Play cue sound"
            className="hover:text-primary"
            onClick={() => {
              const s = sounds.find((x) => x.id === cue.soundId)
              if (s) previewSound(s)
            }}
            type="button"
          >
            ▶
          </button>
          <button
            aria-label="Remove cue"
            className="hover:text-primary"
            onClick={() => setCues(cues.filter((c) => c.id !== cue.id))}
            type="button"
          >
            ✕
          </button>
        </span>
      ))}
      {cues.length < RANKING_CUES_MAX && sounds.length > 0 && (
        <button
          className="rounded-md border border-dashed border-white/20 px-2 py-0.5 hover:text-primary"
          onClick={() =>
            setCues([
              ...cues,
              { atSec: Math.round(Math.min(playSec, playSec / 2) * 10) / 10, id: rankingItemId(), soundId: sounds[0]!.id },
            ])
          }
          type="button"
        >
          + sound on the action
        </button>
      )}
      {sounds.length === 0 && <span>(add sounds to your library to use them here)</span>}
    </div>
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
      <OrderChips
        onMove={(from, to) => onChange({ mode: 'custom', order: moveItem(reveal.order, from, to) })}
        onStep={moveIn}
        order={reveal.order}
      />
      <p className="text-xs text-secondary">Drag the ranks to change the order they play in.</p>
    </section>
  )
}

/** `list` with the item at `from` moved to index `to` (as counted before the move). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to > from ? to - 1 : to, 0, item as T)
  return next
}

/**
 * The reveal order as chips: drag one onto another to put it there (a bar shows where it lands),
 * or use its arrows (keyboard). Dropping on a chip's left half puts it before, right half after.
 */
function OrderChips({
  onMove,
  onStep,
  order,
}: {
  onMove: (from: number, to: number) => void
  onStep: (i: number, by: number) => void
  order: number[]
}) {
  const [dragging, setDragging] = useState<null | number>(null)
  const [target, setTarget] = useState<null | number>(null)
  const end = () => {
    setDragging(null)
    setTarget(null)
  }
  return (
    <div className="flex flex-wrap items-center gap-1" onDragLeave={(e) => e.currentTarget === e.target && setTarget(null)}>
      {order.map((rank, i) => (
        <div
          className={cn(
            'relative flex cursor-grab items-center gap-0.5 rounded-md bg-white/10 px-1.5 py-0.5 text-xs text-primary select-none active:cursor-grabbing',
            dragging === i && 'opacity-40',
          )}
          draggable
          key={rank}
          onDragEnd={end}
          onDragOver={(e) => {
            if (dragging === null) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const box = e.currentTarget.getBoundingClientRect()
            setTarget(e.clientX < box.left + box.width / 2 ? i : i + 1)
          }}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(rank))
            setDragging(i)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging !== null && target !== null && target !== dragging && target !== dragging + 1)
              onMove(dragging, target)
            end()
          }}
          title="Drag to reorder"
        >
          {target === i && dragging !== null && <span className="absolute -left-1 inset-y-0 w-0.5 rounded bg-white" />}
          {target === i + 1 && dragging !== null && i === order.length - 1 && (
            <span className="absolute -right-1 inset-y-0 w-0.5 rounded bg-white" />
          )}
          {i > 0 && (
            <button aria-label={`Reveal #${rank} earlier`} className="text-secondary hover:text-primary" onClick={() => onStep(i, -1)} type="button">
              ‹
            </button>
          )}
          <span className="font-semibold">#{rank}</span>
          {i < order.length - 1 && (
            <button aria-label={`Reveal #${rank} later`} className="text-secondary hover:text-primary" onClick={() => onStep(i, 1)} type="button">
              ›
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const NUMBER_FORMATS: [RankingNumberFormat, string][] = [
  ['dot', '1.'],
  ['hash', '#1'],
  ['plain', '1'],
  ['keycap', '1️⃣ keycaps'],
  ['medal', '🥇 medals, then 4.'],
  ['custom', 'Your own (emoji, words)'],
]

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
  const font = (label: string, key: 'labelFont' | 'numberFont' | 'titleFont') => (
    <label className="flex items-center gap-1.5 text-xs text-secondary" key={key}>
      {label}
      <select
        className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-xs text-primary"
        onChange={(e) => onChange({ ...style, [key]: (e.target.value || undefined) as RankingFontId | undefined })}
        value={style[key] ?? 'montserrat'}
      >
        {RANKING_FONT_IDS.map((id) => (
          <option key={id} value={id}>
            {RANKING_FONT_FACES[id].label}
          </option>
        ))}
      </select>
    </label>
  )
  const format = style.numberFormat ?? 'dot'
  return (
    <section className={SECTION}>
      <span className={HEADING}>Fonts and rank marks</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {font('Title', 'titleFont')}
        {font('Numbers', 'numberFont')}
        {font('Labels', 'labelFont')}
        <label className="flex items-center gap-1.5 text-xs text-secondary">
          Marks
          <select
            className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-xs text-primary"
            onChange={(e) => onChange({ ...style, numberFormat: e.target.value as RankingNumberFormat })}
            value={format}
          >
            {NUMBER_FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {format === 'custom' && (
        <label className="flex flex-col gap-1 text-xs text-secondary">
          Your marks, rank 1 first, separated by spaces (emoji welcome)
          <input
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary"
            onChange={(e) => onChange({ ...style, numberMarks: e.target.value.split(/\s+/).filter(Boolean) })}
            // Uncontrolled: the box keeps the spaces being typed; the marks are its words.
            defaultValue={(style.numberMarks ?? []).join(' ')}
            placeholder="👑 🔥 😂 💀 🤡"
          />
        </label>
      )}
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
