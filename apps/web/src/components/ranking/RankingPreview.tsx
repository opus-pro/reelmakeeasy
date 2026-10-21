'use client'

import { isMovingSticker, stickerPose } from '@reelmakeeasy/common/ranking/ranking-motion'
import {
  drawRankingOverlay,
  drawRankingTransition,
  projectFonts,
  stickerBox,
} from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingTimeline,
  type RankingTimelinePart,
  soundsOf,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject, RankingSticker } from '@shared/types/api/ranking'
import { type LibrarySound, soundPlayback } from '@shared/types/api/sound-library'
import { cn } from '@shared/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { STUDIO_RANKING_FONTS } from './ranking-fonts'
import {
  activeCues,
  type CueWindow,
  cueWindows,
  formatTime,
  jumpTarget,
  partIndexAt,
  rankStarts,
} from './ranking-player'
import {
  CueAudio,
  type PlayingSound,
  playSoundPart,
  soundLengthSec,
  unlockAudio,
} from './sound-player'
import { useStickerImages } from './sticker-images'

/** A rank picked in the editor; a new `nonce` asks again, even for the same rank. */
export type RankFocusRequest = { nonce: number; rank: number }

export type RankingPreviewProps = {
  /** The transport and timeline span this width (a CSS length) under the frame. */
  dockWidth?: string
  /** The rank picked in the editor: the preview jumps to its clip (and plays on if it was playing). */
  focusRequest?: null | RankFocusRequest
  /** Redraw once the fonts arrive. */
  fontsReady: boolean
  /** A sticker was moved, resized or turned on the stage (or nudged with the arrow keys). */
  onEditSticker?: (id: string, patch: Partial<RankingSticker>) => void
  /** The rank on screen changed (the editor follows it). */
  onRankOnScreen?: (rank: number) => void
  /** The selected sticker was deleted from the stage (Delete key). */
  onRemoveSticker?: (id: string) => void
  /** A sticker was picked on the stage (null: a click beside them). */
  onSelectSticker?: (id: null | string) => void
  project: RankingProject
  /** The sticker being edited: outlined on the stage. */
  selectedSticker?: null | string
  sounds: LibrarySound[]
  /** How tall the 9:16 frame may be (a CSS length); its width follows, up to the space it has. */
  stageHeight?: string
}

/** How long a clip may hold the playhead (loading) before its sounds wait for it too. */
const STALL_MS = 300

/**
 * The short as it will export: the clip under the title band, the overlay drawn by the same
 * functions the export uses, each rank's sounds and the music bed. Everything follows one
 * playhead (seconds into the short): play and pause, scrub the timeline, click a rank to jump
 * to it. A rank's sounds play only while its clip does, cut where it ends, like the export.
 */
export function RankingPreview({
  focusRequest,
  dockWidth = '430px',
  fontsReady,
  onEditSticker,
  onRankOnScreen,
  onRemoveSticker,
  onSelectSticker,
  project,
  selectedSticker,
  sounds,
  stageHeight = 'min(72vh, 760px)',
}: RankingPreviewProps) {
  const images = useStickerImages(project.stickers)
  const [draggingSticker, setDraggingSticker] = useState<null | string>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const parts = useMemo(() => rankingTimeline(project), [project])
  const total = parts.reduce((sum, p) => sum + p.durSec, 0)
  const soundById = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds])
  const windows = useMemo(
    () =>
      cueWindows(project, parts, (id) => {
        const sound = soundById.get(id)
        return sound ? soundLengthSec(sound) : null
      }),
    [parts, project, soundById],
  )
  // What the timeline and the music bed are, as text: edits that change neither (a label, a
  // sticker) leave the playhead and the sounds alone.
  const timelineKey = useMemo(
    () =>
      JSON.stringify(
        parts.map((p) =>
          p.kind === 'clip'
            ? [p.startSec, p.durSec, p.segment.item.clip?.url, p.segment.item.clip?.trimStartSec]
            : [p.startSec, p.durSec],
        ),
      ),
    [parts],
  )
  const musicKey = useMemo(() => {
    const chosen = soundsOf(project)
    const sound = chosen.music ? soundById.get(chosen.music) : undefined
    return JSON.stringify([chosen.music, chosen.musicVolume, sound && soundPlayback(sound)])
  }, [project, soundById])

  // The playhead: a ref for the clock, state for what's drawn.
  const timeRef = useRef(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  const videos = useRef(new Map<number, HTMLVideoElement>())
  // Clips that can't play (by URL): the playhead runs over them on the clock instead.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const failedRef = useRef(failed)
  failedRef.current = failed
  // A clip still loading holds the playhead; past STALL_MS its sounds wait with it.
  const [buffering, setBuffering] = useState(false)
  const stall = useRef<{ since: null | number; stalled: boolean }>({ since: null, stalled: false })
  const soundByIdRef = useRef(soundById)
  soundByIdRef.current = soundById
  const cueAudio = useRef<CueAudio | null>(null)
  cueAudio.current ??= new CueAudio((id) => soundByIdRef.current.get(id))
  const musicRef = useRef<null | PlayingSound>(null)
  // Scrubbing pauses while the playhead is dragged, then plays on if it was playing.
  const scrubResume = useRef(false)

  const index = partIndexAt(parts, time)
  const part: null | RankingTimelinePart = parts[index] ?? null
  const segment = part?.kind === 'clip' ? part.segment : null
  const clipFailed = !!segment?.item.clip && failed.has(segment.item.clip.url)
  const hasMoving = (project.stickers ?? []).some(isMovingSticker)

  const startMusic = useCallback(
    (t: number) => {
      musicRef.current?.stop()
      musicRef.current = null
      const music = soundsOf(project)
      const sound = music.music ? soundByIdRef.current.get(music.music) : undefined
      if (sound)
        musicRef.current = playSoundPart(sound, {
          level: music.musicVolume,
          loop: true,
          offsetSec: t,
        })
    },
    [project],
  )

  const markFailed = useCallback((url: string) => {
    setFailed((s) => (s.has(url) ? s : new Set(s).add(url)))
  }, [])

  /** Plays a clip's video. A play() cut short by a pause or a seek (jumping) is normal; one the
   *  browser blocks pauses the preview; a clip it can't play is skipped over. */
  const playVideo = useCallback(
    (video: HTMLVideoElement, url: string) => {
      void video.play().catch((e: unknown) => {
        const name = (e as DOMException | undefined)?.name
        if (name === 'AbortError' || !playingRef.current) return
        if (name === 'NotAllowedError') pause()
        else markFailed(url)
      })
    },
    // pause only reads refs.
    [markFailed],
  )

  /** Shows part `i` at `local` seconds into it: its video there (playing on if playing), the others paused. */
  const showPart = useCallback(
    (i: number, local: number) => {
      for (const [k, video] of videos.current) if (k !== i && !video.paused) video.pause()
      const p = parts[i]
      const video = videos.current.get(i)
      const clip = p?.kind === 'clip' ? p.segment.item.clip : null
      if (!clip || !video) return
      const at = clip.trimStartSec + Math.max(0, local)
      if (Math.abs(video.currentTime - at) > 0.04) video.currentTime = at
      if (playingRef.current) playVideo(video, clip.url)
      else if (!video.paused) video.pause()
    },
    [parts, playVideo],
  )

  const seek = useCallback(
    (to: number) => {
      const t = Math.min(Math.max(0, to), Math.max(0, total - 0.001))
      const i = partIndexAt(parts, t)
      timeRef.current = t
      setTime(t)
      showPart(i, t - (parts[i]?.startSec ?? 0))
      // Every sound restarts from here: none from where the playhead was keeps running.
      cueAudio.current?.stopAll()
      stall.current = { since: null, stalled: false }
      setBuffering(false)
      if (playingRef.current) {
        startMusic(t)
        cueAudio.current?.sync(activeCues(windows, t))
      }
    },
    [parts, showPart, startMusic, total, windows],
  )

  function pause() {
    playingRef.current = false
    setPlaying(false)
    setBuffering(false)
    for (const video of videos.current.values()) video.pause()
    cueAudio.current?.stopAll()
    musicRef.current?.stop()
    musicRef.current = null
  }

  /** Plays from the playhead; from the top when it's at the end and `fromTopAtEnd`. */
  function play(fromTopAtEnd = true) {
    if (total <= 0) return
    unlockAudio()
    const atEnd = timeRef.current >= total - 0.05
    if (atEnd && !fromTopAtEnd) return
    playingRef.current = true
    setPlaying(true)
    seek(atEnd ? 0 : timeRef.current)
  }

  const toggle = () => (playingRef.current ? pause() : play())
  const jump = (direction: -1 | 1) => {
    const target = jumpTarget(parts, timeRef.current, direction)
    if (target !== null) seek(target)
  }

  /** Where the playhead is after `dt` more seconds in part `i`; `waiting` while its clip loads. */
  const advance = useCallback(
    (i: number, t: number, dt: number): { t: number; waiting: boolean } => {
      const p = parts[i]
      if (!p) return { t, waiting: false }
      const clip = p.kind === 'clip' ? p.segment.item.clip : null
      const video = clip ? videos.current.get(i) : undefined
      // A transition slide, or a clip that can't play, runs on the wall clock.
      if (!clip || !video || failedRef.current.has(clip.url)) return { t: t + dt, waiting: false }
      // A video that ended early has reached the end of its part.
      if (video.ended) return { t: p.startSec + p.durSec, waiting: false }
      if (video.paused) playVideo(video, clip.url)
      if (video.readyState < 3) return { t, waiting: true }
      return { t: p.startSec + Math.max(0, video.currentTime - clip.trimStartSec), waiting: false }
    },
    [parts, playVideo],
  )

  /** A clip that keeps loading: its sounds wait for it, then pick up at the playhead. */
  const holdSounds = useCallback(
    (waiting: boolean, now: number, t: number) => {
      if (waiting) {
        stall.current.since ??= now
        if (stall.current.stalled || now - stall.current.since <= STALL_MS) return
        stall.current.stalled = true
        setBuffering(true)
        cueAudio.current?.stopAll()
        musicRef.current?.stop()
        musicRef.current = null
        return
      }
      stall.current.since = null
      if (!stall.current.stalled) return
      stall.current.stalled = false
      setBuffering(false)
      startMusic(t)
    },
    [startMusic],
  )

  // The clock: a clip's time comes from its video (so a slow load holds the playhead instead of
  // racing ahead).
  useEffect(() => {
    if (!playing) return undefined
    let last = performance.now()
    let shown = partIndexAt(parts, timeRef.current)
    let frame = requestAnimationFrame(function tick(now) {
      // Paused from outside a click (a failed play()): stop before anything restarts.
      if (!playingRef.current) return
      const dt = (now - last) / 1000
      last = now
      let i = partIndexAt(parts, timeRef.current)
      if (i !== shown) {
        // The timeline moved under the playhead: show the part it is in now.
        showPart(i, timeRef.current - (parts[i]?.startSec ?? 0))
        shown = i
      }
      let { t, waiting } = advance(i, timeRef.current, dt)
      holdSounds(waiting, now, t)
      const p = parts[i]
      if (p && t >= p.startSec + p.durSec - 0.01) {
        if (i + 1 >= parts.length) {
          timeRef.current = total
          setTime(total)
          pause()
          return
        }
        i += 1
        t = (parts[i] as RankingTimelinePart).startSec
        showPart(i, 0)
        shown = i
      }
      timeRef.current = t
      setTime(t)
      if (!stall.current.stalled) cueAudio.current?.sync(activeCues(windows, t))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
    // pause only reads refs.
  }, [advance, holdSounds, parts, playing, showPart, total, windows])

  // A hidden tab stops animation frames (the clock): pause, so no sound plays on unseen.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && playingRef.current) pause()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
    // pause only reads refs.
  }, [])

  // Nothing keeps playing once the preview is gone.
  useEffect(
    () => () => {
      for (const video of videos.current.values()) video.pause()
      cueAudio.current?.stopAll()
      musicRef.current?.stop()
    },
    [],
  )

  // The timeline changed (a new clip, a trim, a reorder): the playhead stays where it was (inside
  // the short), with that moment's clip and sounds.
  useEffect(() => {
    seek(Math.min(timeRef.current, total))
    // Only when the timeline itself changes.
  }, [timelineKey])

  // The music bed changed while playing: it restarts at the playhead.
  useEffect(() => {
    if (playingRef.current && !stall.current.stalled) startMusic(timeRef.current)
    // Only when the music bed changes.
  }, [musicKey])

  // A rank picked in the editor: jump to its clip (after the timeline effect, so a clip that just
  // arrived is there to jump to).
  useEffect(() => {
    if (!focusRequest) return
    const start = rankStarts(parts).find((r) => r.rank === focusRequest.rank)?.startSec
    if (start === undefined) return
    if (partIndexAt(parts, timeRef.current) === partIndexAt(parts, start)) return
    seek(start)
    // Only when the editor asks.
  }, [focusRequest?.nonce])

  // The editor follows the rank on screen.
  const rankOnScreen = segment?.item.rank ?? null
  useEffect(() => {
    if (rankOnScreen !== null) onRankOnScreen?.(rankOnScreen)
    // Only when the rank on screen changes.
  }, [rankOnScreen])

  // Draw the overlay for the moment on screen, or the transition slide. Paused, ranks with no
  // clip yet show their labels too, so a label being typed shows at once.
  const revealed = useMemo(() => {
    if (!segment) return parts.length ? [] : project.items.map((item) => item.rank)
    if (playing) return segment.revealed
    const noClip = project.items.filter((item) => !item.clip).map((item) => item.rank)
    return [...new Set([...noClip, ...segment.revealed])]
  }, [parts.length, playing, project.items, segment])
  const [bandHeight, setBandHeight] = useState(240)
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return undefined
    if (part?.kind === 'transition') {
      drawRankingTransition(ctx, project, part.nextRank, STUDIO_RANKING_FONTS)
      return undefined
    }
    const clipPart = part?.kind === 'clip' ? part : null
    // Playing: moving stickers follow the playhead; paused, they rest where they can be placed.
    const moving =
      clipPart && playing && hasMoving
        ? (sticker: RankingSticker) =>
            sticker.rank === null
              ? stickerPose(sticker, timeRef.current, total)
              : stickerPose(sticker, timeRef.current - clipPart.startSec, clipPart.durSec)
        : ('still' as const)
    const draw = () =>
      drawRankingOverlay(ctx, project, revealed, {
        fonts: STUDIO_RANKING_FONTS,
        images,
        moving,
        rank: rankOnScreen,
      })
    setBandHeight(draw().bandHeight)
    if (moving === 'still') return undefined
    let frame = requestAnimationFrame(function tick() {
      draw()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [fontsReady, hasMoving, images, part, playing, project, rankOnScreen, revealed, total])

  // Each sticker's size on the frame (measured in the overlay's fonts), for its handles.
  const boxes = useMemo(() => {
    const ctx = canvasRef.current?.getContext('2d')
    const fonts = projectFonts(project, STUDIO_RANKING_FONTS)
    return new Map(
      (project.stickers ?? []).map((sticker) => [
        sticker.id,
        ctx ? stickerBox(ctx, sticker, fonts, images) : { h: sticker.size, w: sticker.size },
      ]),
    )
    // fontsReady: measured again once the fonts are in.
  }, [fontsReady, images, project])
  const editing = !!onEditSticker
  const selected = editing ? (selectedSticker ?? null) : null

  const top = (bandHeight / RANKING_HEIGHT) * 100
  const label = segment
    ? `#${segment.item.rank} ${segment.item.label}`
    : part?.kind === 'transition'
      ? `Next: #${part.nextRank}`
      : ''
  return (
    <div
      aria-label="Ranking preview: Space plays or pauses, the arrow keys jump between ranks"
      className="flex w-full flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      onKeyDown={(e) => {
        const onButton = (e.target as HTMLElement).tagName === 'BUTTON'
        if (e.target !== e.currentTarget && !onButton) return
        // Space or Enter on a button presses that button.
        if (onButton && (e.key === ' ' || e.key === 'Enter')) return
        if (selected && editSelected(e)) {
          e.preventDefault()
          return
        }
        if (e.key === ' ') toggle()
        else if (e.key === 'ArrowRight') jump(1)
        else if (e.key === 'ArrowLeft') jump(-1)
        else if (e.key === 'Home') seek(0)
        else return
        e.preventDefault()
      }}
      tabIndex={0}
    >
      <div
        className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-sm bg-[#111] shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08]"
        data-testid="ranking-stage"
        onClick={(e) => {
          if (draggingSticker || e.target !== e.currentTarget.querySelector('canvas')) return
          // A click beside the stickers lets go of the one selected; otherwise it plays or pauses.
          if (selected) onSelectSticker?.(null)
          else toggle()
        }}
        style={{ width: `min(100%, calc(${stageHeight} * 9 / 16))` }}
      >
        {parts.map((p, i) =>
          p.kind === 'clip' && p.segment.item.clip ? (
            <video
              className={cn(
                'absolute left-0 w-full object-cover',
                i === index ? 'opacity-100' : 'opacity-0',
              )}
              key={`${i}:${p.segment.item.clip.url}`}
              onError={() => {
                const url = p.segment.item.clip?.url
                if (url) markFailed(url)
              }}
              onLoadedData={(e) => {
                // Every clip waits at its first frame, so switching ranks is instant; the one on
                // screen goes to the playhead.
                const clip = p.segment.item.clip
                if (!clip) return
                const local =
                  i === partIndexAt(parts, timeRef.current) ? timeRef.current - p.startSec : 0
                e.currentTarget.currentTime = clip.trimStartSec + Math.max(0, local)
              }}
              playsInline
              preload="auto"
              ref={(el) => {
                if (el) videos.current.set(i, el)
                else videos.current.delete(i)
              }}
              src={p.segment.item.clip.url}
              style={{ height: `${100 - top}%`, top: `${top}%` }}
            />
          ) : null,
        )}
        {!parts.length && (
          <div
            className="absolute inset-x-0 flex items-center justify-center text-sm text-white/40"
            style={{ bottom: 0, top: `${top}%` }}
          >
            Add clips to the ranks
          </div>
        )}
        {clipFailed && (
          <div
            className="pointer-events-none absolute inset-x-0 flex items-center justify-center px-6 text-center text-sm text-amber-300/90"
            style={{ bottom: 0, top: `${top}%` }}
          >
            This clip can't play here. Upload it again or pick another.
          </div>
        )}
        <canvas
          className="absolute inset-0 size-full"
          height={RANKING_HEIGHT}
          ref={canvasRef}
          width={RANKING_WIDTH}
        />
        {/* Out of the way of the picture: a small badge in the corner, not a disc over the labels. */}
        {(buffering || (!playing && part && !draggingSticker && !selected)) && (
          <span className="pointer-events-none absolute right-2.5 bottom-2.5 flex size-8 items-center justify-center rounded-full bg-black/60 text-white/90">
            {buffering ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <PlayIcon className="size-3.5 translate-x-px" />
            )}
          </span>
        )}
        {!playing && onEditSticker && part?.kind === 'clip' && (
          <StickerHandles
            boxes={boxes}
            dragging={draggingSticker}
            onDragging={(id) => {
              setDraggingSticker(id)
              if (id) onSelectSticker?.(id)
            }}
            onEdit={onEditSticker}
            selected={selected}
            stickers={(project.stickers ?? []).filter(
              (s) => s.rank === null || s.rank === rankOnScreen,
            )}
          />
        )}
      </div>
      <div className="flex w-full flex-col gap-2" style={{ maxWidth: dockWidth }}>
        <div className="grid h-9 grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="font-mono text-xs text-primary tabular-nums">
            {formatTime(time)} <span className="text-white/40">/ {formatTime(total)}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <ControlButton
              disabled={!parts.length}
              label="Previous rank (←)"
              onClick={() => jump(-1)}
            >
              <SkipIcon className="size-3.5 -scale-x-100" />
            </ControlButton>
            <ControlButton
              disabled={!parts.length}
              label={playing ? 'Pause (Space)' : 'Play (Space)'}
              onClick={toggle}
              primary
            >
              {playing ? (
                <PauseIcon className="size-4" />
              ) : (
                <PlayIcon className="size-4 translate-x-px" />
              )}
            </ControlButton>
            <ControlButton disabled={!parts.length} label="Next rank (→)" onClick={() => jump(1)}>
              <SkipIcon className="size-3.5" />
            </ControlButton>
          </div>
          {label ? (
            <span className="ml-auto flex h-7 max-w-full min-w-0 items-center gap-1 rounded-xs bg-white/[0.06] px-2 text-xs font-medium text-primary">
              {segment && (
                <span
                  className="font-bold"
                  style={{ color: rankColor(project, segment.item.rank) }}
                >
                  #{segment.item.rank}
                </span>
              )}
              <span className="truncate">
                {segment ? segment.item.label || 'No label yet' : label}
              </span>
            </span>
          ) : (
            <span />
          )}
        </div>
        <Timeline
          onScrub={(t, phase) => {
            if (phase === 'start') scrubResume.current = playingRef.current
            if (phase === 'start' && playingRef.current) pause()
            seek(t)
            // Dropped at the very end: stay there rather than start over.
            if (phase === 'end' && scrubResume.current) play(false)
          }}
          onSeek={seek}
          parts={parts}
          project={project}
          time={time}
          total={total}
          windows={windows}
        />
      </div>
    </div>
  )

  /** Arrow keys nudge the selected sticker (Shift: further), Delete removes it, Escape lets go.
   *  True when the key was one of those. */
  function editSelected(e: React.KeyboardEvent): boolean {
    const sticker = (project.stickers ?? []).find((s) => s.id === selected)
    if (!sticker || !onEditSticker) return false
    const step = e.shiftKey ? 0.05 : 0.01
    const nudge = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    }[e.key as 'ArrowDown']
    if (nudge) {
      onEditSticker(sticker.id, {
        x: clamp01(round3(sticker.x + (nudge[0] ?? 0))),
        y: clamp01(round3(sticker.y + (nudge[1] ?? 0))),
      })
      return true
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onRemoveSticker?.(sticker.id)
      return true
    }
    if (e.key === 'Escape') {
      onSelectSticker?.(null)
      return true
    }
    return false
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** A rank's colour on the overlay: the top three have their own, the rest share one. */
function ControlButton({
  children,
  disabled,
  label,
  onClick,
  primary,
}: {
  children: React.ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'size-9 bg-white text-black hover:bg-white/85'
          : 'size-8 bg-white/10 text-primary hover:bg-white/20',
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
      <rect height="11" rx="1" width="3.5" x="3" y="2.5" />
      <rect height="11" rx="1" width="3.5" x="9.5" y="2.5" />
    </svg>
  )
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" />
    </svg>
  )
}

function rankColor(project: RankingProject, rank: number): string {
  return project.style.numberColors[Math.min(rank, 4) - 1] ?? '#ffffff'
}

function SkipIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M2.5 3v10a.5.5 0 0 0 .78.42L10 8.9V13a.5.5 0 0 0 .5.5h1.5a.5.5 0 0 0 .5-.5V3a.5.5 0 0 0-.5-.5h-1.5A.5.5 0 0 0 10 3v4.1L3.28 2.58A.5.5 0 0 0 2.5 3Z" />
    </svg>
  )
}

/**
 * The short's timeline: one block per rank (and slide), a mark at each meme sound, the playhead.
 * Click anywhere to jump there; press and drag to scrub.
 */
type StickerDrag = {
  /** The sticker's centre and the press, in stage pixels. */
  cx: number
  cy: number
  id: string
  mode: 'move' | 'rotate' | 'scale'
  px: number
  py: number
  sticker: RankingSticker
}

function Timeline({
  onScrub,
  onSeek,
  parts,
  project,
  time,
  total,
  windows,
}: {
  onScrub: (t: number, phase: 'end' | 'move' | 'start') => void
  onSeek: (t: number) => void
  parts: RankingTimelinePart[]
  project: RankingProject
  time: number
  total: number
  windows: CueWindow[]
}) {
  const [hover, setHover] = useState<null | number>(null)
  const pressed = useRef(false)
  const lastAt = useRef(0)
  if (!total) return <div className="h-12 w-full rounded-xs bg-white/5" />
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    lastAt.current = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * total
    return lastAt.current
  }
  // A drag the browser cancels (or that loses the pointer) still ends, so playback resumes.
  const cancel = () => {
    if (!pressed.current) return
    pressed.current = false
    onScrub(lastAt.current, 'end')
  }
  const current = partIndexAt(parts, time)
  const pct = (sec: number) => `${(Math.min(sec, total) / total) * 100}%`
  return (
    <div
      aria-label="Timeline"
      aria-valuemax={Math.round(total * 10) / 10}
      aria-valuemin={0}
      aria-valuenow={Math.round(time * 10) / 10}
      aria-valuetext={`${formatTime(time)} of ${formatTime(total)}`}
      className="relative h-12 w-full cursor-pointer touch-none rounded-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-white/30"
      onKeyDown={(e) => {
        // A second at a time here (the preview's own arrows jump rank to rank).
        const to =
          e.key === 'ArrowRight'
            ? time + 1
            : e.key === 'ArrowLeft'
              ? time - 1
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? total
                  : null
        if (to === null) return
        e.preventDefault()
        e.stopPropagation()
        onSeek(to)
      }}
      onLostPointerCapture={cancel}
      onPointerCancel={cancel}
      onPointerDown={(e) => {
        pressed.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onScrub(at(e), 'start')
      }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        setHover(at(e))
        if (pressed.current) onScrub(lastAt.current, 'move')
      }}
      onPointerUp={(e) => {
        if (!pressed.current) return
        pressed.current = false
        onScrub(at(e), 'end')
      }}
      role="slider"
      tabIndex={0}
    >
      <div className="absolute inset-x-0 top-1.5 flex h-10">
        {parts.map((p, i) => (
          <div
            className="h-full min-w-0 px-px"
            key={p.kind === 'clip' ? p.segment.item.id : `t-${i}`}
            style={{ width: pct(p.durSec) }}
            title={
              p.kind === 'clip'
                ? `#${p.segment.item.rank} ${p.segment.item.label}`
                : `Slide to #${p.nextRank}`
            }
          >
            {p.kind === 'clip' ? (
              <div
                className={cn(
                  'flex h-full min-w-0 items-start gap-1 rounded-xxs px-[7px] py-[5px] text-[11px] leading-tight transition-colors',
                  i === current
                    ? 'bg-white/10 ring-[1.5px] ring-white/55 ring-inset'
                    : 'bg-white/[0.08] hover:bg-white/[0.12]',
                )}
              >
                <span
                  className="shrink-0 font-bold"
                  style={{ color: rankColor(project, p.segment.item.rank) }}
                >
                  #{p.segment.item.rank}
                </span>
                <span className="truncate text-secondary">{p.segment.item.label}</span>
              </div>
            ) : (
              <div className="h-full rounded-[4px] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.12)_0_3px,transparent_3px_6px)]" />
            )}
          </div>
        ))}
      </div>
      {/* A tick at each meme sound (not the reveal sounds, which open every rank). */}
      {windows
        .filter((w) => w.key.includes(':cue'))
        .map((w) => (
          <span
            className="pointer-events-none absolute bottom-2.5 h-[9px] w-0.5 rounded-full bg-accent-green"
            key={w.key}
            style={{ left: pct(w.startSec) }}
          />
        ))}
      {hover !== null && (
        <span
          className="pointer-events-none absolute top-0 h-12 w-px bg-white/40"
          style={{ left: pct(hover) }}
        />
      )}
      <span
        className="pointer-events-none absolute top-0 flex h-12 w-0.5 -translate-x-1/2 flex-col items-center bg-white"
        style={{ left: pct(time) }}
      >
        <span className="-mt-1 size-2.5 shrink-0 rounded-full bg-white" />
      </span>
    </div>
  )
}

/**
 * Handles over the stickers on the stage (while paused). Each has a box the size of what it
 * draws: press one to select it and drag to move it. The selected one is outlined in blue, with
 * corner handles to resize it and a handle above to turn it (Shift: in 15 degree steps).
 */
function StickerHandles({
  boxes,
  dragging,
  onDragging,
  onEdit,
  selected,
  stickers,
}: {
  boxes: ReadonlyMap<string, { h: number; w: number }>
  dragging: null | string
  onDragging: (id: null | string) => void
  onEdit: (id: string, patch: Partial<RankingSticker>) => void
  selected: null | string
  stickers: RankingSticker[]
}) {
  const drag = useRef<null | StickerDrag>(null)
  const layer = useRef<HTMLDivElement>(null)
  const start = (e: React.PointerEvent, sticker: RankingSticker, mode: StickerDrag['mode']) => {
    e.preventDefault()
    e.stopPropagation()
    const box = layer.current?.getBoundingClientRect()
    if (!box) return
    layer.current?.setPointerCapture?.(e.pointerId)
    drag.current = {
      cx: box.left + sticker.x * box.width,
      cy: box.top + sticker.y * box.height,
      id: sticker.id,
      mode,
      px: e.clientX,
      py: e.clientY,
      sticker,
    }
    onDragging(sticker.id)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const box = layer.current?.getBoundingClientRect()
    if (!d || !box) return
    if (d.mode === 'move') {
      onEdit(d.id, {
        x: clamp01(round3(d.sticker.x + (e.clientX - d.px) / box.width)),
        y: clamp01(round3(d.sticker.y + (e.clientY - d.py) / box.height)),
      })
    } else if (d.mode === 'scale') {
      const from = Math.hypot(d.px - d.cx, d.py - d.cy) || 1
      const to = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
      onEdit(d.id, { size: round3(Math.min(1, Math.max(0.02, d.sticker.size * (to / from)))) })
    } else {
      // The handle sits above the sticker: straight up is 0 degrees.
      let angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90
      if (angle > 180) angle -= 360
      if (e.shiftKey) angle = Math.round(angle / 15) * 15
      onEdit(d.id, { rotation: Math.round(angle) })
    }
  }
  const end = () => {
    drag.current = null
    onDragging(null)
  }
  return (
    <div
      className={cn('absolute inset-0', dragging ? 'cursor-grabbing' : '')}
      onLostPointerCapture={end}
      onPointerCancel={end}
      onPointerMove={move}
      onPointerUp={end}
      ref={layer}
      style={{ pointerEvents: dragging ? 'auto' : 'none' }}
    >
      {stickers.map((s) => {
        const size = boxes.get(s.id) ?? { h: s.size, w: s.size }
        const isSelected = s.id === selected
        return (
          <div
            aria-label="Drag sticker"
            className="group absolute cursor-grab"
            key={s.id}
            onPointerDown={(e) => start(e, s, 'move')}
            style={{
              height: `${size.h * 100}%`,
              left: `${s.x * 100}%`,
              pointerEvents: 'auto',
              top: `${s.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${s.rotation}deg)`,
              width: `${size.w * 100}%`,
            }}
            title="Drag to move"
          >
            <span
              className={cn(
                'absolute -inset-1 rounded-[3px]',
                isSelected
                  ? 'border-[1.5px] border-[#00b2f8]'
                  : 'border border-dashed border-transparent group-hover:border-white/40',
              )}
            />
            {isSelected && (
              <>
                {(
                  [
                    '-top-[9px] -left-[9px]',
                    '-top-[9px] -right-[9px]',
                    '-bottom-[9px] -left-[9px]',
                    '-bottom-[9px] -right-[9px]',
                  ] as const
                ).map((corner) => (
                  <span
                    aria-label="Resize"
                    className={cn(
                      'absolute size-[9px] cursor-nwse-resize rounded-[2px] border-[1.5px] border-[#00b2f8] bg-white',
                      corner,
                    )}
                    key={corner}
                    onPointerDown={(e) => start(e, s, 'scale')}
                  />
                ))}
                <span className="pointer-events-none absolute top-[-22px] left-1/2 h-[14px] w-[1.5px] -translate-x-1/2 bg-[#00b2f8]" />
                <span
                  aria-label="Turn"
                  className="absolute top-[-32px] left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border-[1.5px] border-[#00b2f8] bg-white"
                  onPointerDown={(e) => start(e, s, 'rotate')}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
