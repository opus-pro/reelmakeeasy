'use client'

import { drawRankingOverlay, drawRankingTransition } from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingTimeline,
  type RankingTimelinePart,
  soundsOf,
  transitionOf,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject, RankingSticker } from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { Button, cn } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { STUDIO_RANKING_FONTS } from './ranking-fonts'
import { type PlayingSound, playSoundPart } from './sound-player'
import { useStickerImages } from './sticker-images'

export type RankingPreviewProps = {
  /** Redraw once the fonts arrive. */
  fontsReady: boolean
  /** The rank being edited: its clip shows (paused at its start) while not playing. */
  focusRank: null | number
  /** A sticker was dragged to a new place (fractions of the frame). */
  onMoveSticker?: (id: string, x: number, y: number) => void
  project: RankingProject
  sounds: LibrarySound[]
}

/**
 * The studio's stage: the short at 9:16, the clip under the title band and the overlay drawn by
 * the same functions the export uses. Play runs the whole short: each rank's clip in reveal
 * order, the transition slides between them, the reveal sound and the music bed. Stopped, it
 * shows the focused rank's clip with every label, as an editing view.
 */
export function RankingPreview({ focusRank, fontsReady, onMoveSticker, project, sounds }: RankingPreviewProps) {
  const images = useStickerImages(project.stickers)
  const [draggingSticker, setDraggingSticker] = useState<null | string>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const musicRef = useRef<null | PlayingSound>(null)
  const timeline = useMemo(() => rankingTimeline(project), [project])
  const [playing, setPlaying] = useState<null | number>(null)
  const [bandHeight, setBandHeight] = useState(240)
  const [elapsed, setElapsed] = useState(0)

  const part: RankingTimelinePart | null = playing === null ? null : (timeline[playing] ?? null)
  const segment = part?.kind === 'clip' ? part.segment : null
  const focusItem = project.items.find((item) => item.rank === focusRank && item.clip)
  const clip = part ? (segment?.item.clip ?? null) : (focusItem?.clip ?? null)
  const revealed = useMemo(
    () => (segment ? segment.revealed : project.items.map((item) => item.rank)),
    [project.items, segment],
  )
  const play = (id: null | string, opts: { level?: number; loop?: boolean } = {}) => {
    const sound = sounds.find((s) => s.id === id)
    return sound ? playSoundPart(sound, opts) : null
  }

  // Draw the overlay, or the transition slide while one plays.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    if (part?.kind === 'transition') {
      drawRankingTransition(ctx, project, part.nextRank, STUDIO_RANKING_FONTS)
      return
    }
    // Playing: the rank on screen; stopped: the rank being edited.
    const rank = segment ? segment.item.rank : focusRank
    setBandHeight(
      drawRankingOverlay(ctx, project, revealed, { fonts: STUDIO_RANKING_FONTS, images, rank }).bandHeight,
    )
  }, [focusRank, fontsReady, images, part, project, revealed, segment])

  // Each part's sound as it starts; a transition advances on its own clock.
  useEffect(() => {
    if (!part) return undefined
    if (part.kind === 'transition') {
      play(transitionOf(project).sound)
      const timer = setTimeout(() => advance(), part.durSec * 1000)
      return () => clearTimeout(timer)
    }
    play(soundsOf(project).reveal)
    // This rank's meme sounds, each at its moment.
    const timers = (part.segment.item.cues ?? []).map((cue) =>
      setTimeout(() => play(cue.soundId), cue.atSec * 1000),
    )
    return () => timers.forEach(clearTimeout)
    // Only when the playing part changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // The music bed runs from Play to the end (or Stop).
  useEffect(() => {
    if (playing === null) {
      musicRef.current?.stop()
      musicRef.current = null
      return
    }
    if (musicRef.current) return
    const music = soundsOf(project)
    musicRef.current = play(music.music, { level: music.musicVolume, loop: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  useEffect(() => () => musicRef.current?.stop(), [])

  // A clip (or a new trim): start it at its trim.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !clip) return
    video.currentTime = clip.trimStartSec
    if (playing !== null) void video.play().catch(() => setPlaying(null))
    else video.pause()
  }, [clip, playing])

  function advance() {
    setPlaying((p) => (p !== null && p + 1 < timeline.length ? p + 1 : null))
  }

  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !clip) return
    if (part) setElapsed(part.startSec + Math.max(0, video.currentTime - clip.trimStartSec))
    if (video.currentTime < clip.trimEndSec - 0.03) return
    if (playing === null) {
      video.pause()
      video.currentTime = clip.trimStartSec
      return
    }
    advance()
  }

  const total = timeline.reduce((sum, t) => sum + t.durSec, 0)
  const top = (bandHeight / RANKING_HEIGHT) * 100
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative aspect-[9/16] h-[min(72vh,760px)] overflow-hidden rounded-xl border border-white/10 bg-[#111]"
        data-testid="ranking-stage"
      >
        {clip && part?.kind !== 'transition' && (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- the user's own clips
          <video
            className="absolute left-0 w-full object-cover"
            key={clip.url}
            onEnded={advance}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = clip.trimStartSec
              if (playing !== null) void e.currentTarget.play().catch(() => setPlaying(null))
            }}
            onTimeUpdate={onTimeUpdate}
            playsInline
            preload="auto"
            ref={videoRef}
            src={clip.url}
            style={{ height: `${100 - top}%`, top: `${top}%` }}
          />
        )}
        {!clip && part?.kind !== 'transition' && (
          <div
            className="absolute inset-x-0 flex items-center justify-center text-sm text-white/40"
            style={{ bottom: 0, top: `${top}%` }}
          >
            Add clips to the ranks
          </div>
        )}
        <canvas
          className="pointer-events-none absolute inset-0 size-full"
          height={RANKING_HEIGHT}
          ref={canvasRef}
          width={RANKING_WIDTH}
        />
        {playing === null && onMoveSticker && (
          <StickerHandles
            dragging={draggingSticker}
            onDragging={setDraggingSticker}
            onMove={onMoveSticker}
            stickers={(project.stickers ?? []).filter((s) => s.rank === null || s.rank === focusRank)}
          />
        )}
      </div>
      <div className="flex w-full max-w-[430px] items-center gap-3">
        <Button
          disabled={!timeline.length}
          onClick={() => {
            setElapsed(0)
            setPlaying(playing === null ? 0 : null)
          }}
          size="sm"
          variant="secondary"
        >
          {playing === null ? '▶ Play' : '■ Stop'}
        </Button>
        <Timeline current={playing} elapsed={playing === null ? 0 : elapsed} parts={timeline} total={total} />
        <span className="w-12 text-right text-xs text-secondary tabular-nums">{total.toFixed(1)} s</span>
      </div>
    </div>
  )
}

function Timeline({
  current,
  elapsed,
  parts,
  total,
}: {
  current: null | number
  elapsed: number
  parts: RankingTimelinePart[]
  total: number
}) {
  if (!total) return <div className="h-6 flex-1 rounded bg-white/5" />
  return (
    <div className="relative flex h-6 flex-1 overflow-hidden rounded bg-white/5">
      {parts.map((p, i) => (
        <div
          className={cn(
            'flex items-center justify-center border-r border-black/40 text-[10px] font-semibold',
            p.kind === 'transition' && 'bg-white/[0.04] text-white/30',
            p.kind === 'clip' && (i === current ? 'bg-white/25 text-primary' : 'bg-white/10 text-secondary'),
            p.kind === 'transition' && i === current && 'bg-white/20',
          )}
          key={p.kind === 'clip' ? p.segment.item.id : `t-${i}`}
          style={{ width: `${(p.durSec / total) * 100}%` }}
          title={p.kind === 'clip' ? `#${p.segment.item.rank} ${p.segment.item.label}` : `Transition to #${p.nextRank}`}
        >
          {p.kind === 'clip' ? `#${p.segment.item.rank}` : '›'}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(elapsed / total) * 100}%` }} />
    </div>
  )
}

/**
 * Invisible handles over the stickers on the stage (while stopped): press one and drag to move
 * it. The overlay redraws as it moves.
 */
function StickerHandles({
  dragging,
  onDragging,
  onMove,
  stickers,
}: {
  dragging: null | string
  onDragging: (id: null | string) => void
  onMove: (id: string, x: number, y: number) => void
  stickers: RankingSticker[]
}) {
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    }
  }
  return (
    <div
      className={cn('absolute inset-0', dragging ? 'cursor-grabbing' : '')}
      onPointerMove={(e) => {
        if (!dragging) return
        const { x, y } = at(e)
        onMove(dragging, x, y)
      }}
      onPointerUp={() => onDragging(null)}
      onPointerLeave={() => onDragging(null)}
      style={{ pointerEvents: dragging ? 'auto' : 'none' }}
    >
      {stickers.map((s) => {
        const w = s.kind === 'image' ? s.size * 100 : Math.max(8, s.size * 100 * 1.8 * (s.text?.length ?? 1) * 0.35)
        const h = s.kind === 'image' ? s.size * 100 * 0.5625 : s.size * 100
        return (
          <div
            aria-label="Drag sticker"
            className="absolute cursor-grab rounded border border-dashed border-white/40 hover:border-white"
            key={s.id}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.parentElement?.setPointerCapture?.(e.pointerId)
              onDragging(s.id)
            }}
            style={{
              height: `${h}%`,
              left: `${s.x * 100 - w / 2}%`,
              pointerEvents: 'auto',
              top: `${s.y * 100 - h / 2}%`,
              width: `${w}%`,
            }}
            title="Drag to move"
          />
        )
      })}
    </div>
  )
}
