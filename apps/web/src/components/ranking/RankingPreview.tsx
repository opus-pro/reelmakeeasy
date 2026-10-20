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
import type { RankingProject } from '@shared/types/api/ranking'
import type { LibrarySound } from '@shared/types/api/sound-library'
import { Button, cn } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { STUDIO_RANKING_FONTS } from './ranking-fonts'

export type RankingPreviewProps = {
  /** Redraw once the fonts arrive. */
  fontsReady: boolean
  /** The rank being edited: its clip shows (paused at its start) while not playing. */
  focusRank: null | number
  project: RankingProject
  sounds: LibrarySound[]
}

/** Plays a library sound once (or loops it), at a level; returns it to stop later. */
function playSound(url: string | undefined, opts: { loop?: boolean; volume?: number } = {}): HTMLAudioElement | null {
  if (!url) return null
  const audio = new Audio(url)
  audio.loop = !!opts.loop
  audio.volume = Math.max(0, Math.min(1, opts.volume ?? 1))
  void audio.play().catch(() => undefined)
  return audio
}

/**
 * The studio's stage: the short at 9:16, the clip under the title band and the overlay drawn by
 * the same functions the export uses. Play runs the whole short: each rank's clip in reveal
 * order, the transition slides between them, the reveal sound and the music bed. Stopped, it
 * shows the focused rank's clip with every label, as an editing view.
 */
export function RankingPreview({ focusRank, fontsReady, project, sounds }: RankingPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
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
  const soundUrl = (id: null | string) => sounds.find((s) => s.id === id)?.url

  // Draw the overlay, or the transition slide while one plays.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    if (part?.kind === 'transition') {
      drawRankingTransition(ctx, project, part.nextRank, STUDIO_RANKING_FONTS)
      return
    }
    setBandHeight(drawRankingOverlay(ctx, project, revealed, { fonts: STUDIO_RANKING_FONTS }).bandHeight)
  }, [fontsReady, part, project, revealed])

  // Each part's sound as it starts; a transition advances on its own clock.
  useEffect(() => {
    if (!part) return undefined
    if (part.kind === 'transition') {
      playSound(soundUrl(transitionOf(project).sound))
      const timer = setTimeout(() => advance(), part.durSec * 1000)
      return () => clearTimeout(timer)
    }
    playSound(soundUrl(soundsOf(project).reveal))
    return undefined
    // Only when the playing part changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // The music bed runs from Play to the end (or Stop).
  useEffect(() => {
    if (playing === null) {
      musicRef.current?.pause()
      musicRef.current = null
      return
    }
    if (musicRef.current) return
    const music = soundsOf(project)
    musicRef.current = playSound(soundUrl(music.music), { loop: true, volume: music.musicVolume })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  useEffect(() => () => musicRef.current?.pause(), [])

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
