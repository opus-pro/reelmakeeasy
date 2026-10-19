'use client'

import { drawRankingOverlay } from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_HEIGHT,
  RANKING_WIDTH,
  rankingSegments,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject } from '@shared/types/api/ranking'
import { Button, cn } from '@shared/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import { STUDIO_RANKING_FONTS } from './ranking-fonts'

export type RankingPreviewProps = {
  /** Redraw once the fonts arrive. */
  fontsReady: boolean
  /** The rank being edited: its clip shows (paused at its start) while not playing. */
  focusRank: null | number
  project: RankingProject
}

/**
 * The studio's stage: the short at 9:16, the clip under the title band and the overlay drawn
 * by the same function the export uses. Play runs the whole short in reveal order; stopped, it
 * shows the focused rank's clip with every label, as an editing view.
 */
export function RankingPreview({ focusRank, fontsReady, project }: RankingPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const segments = useMemo(() => rankingSegments(project), [project])
  const [playing, setPlaying] = useState<null | number>(null)
  const [bandHeight, setBandHeight] = useState(240)
  const [elapsed, setElapsed] = useState(0)

  const segment = playing === null ? null : segments[playing]
  const focusItem = project.items.find((item) => item.rank === focusRank && item.clip)
  const clip = segment?.item.clip ?? focusItem?.clip ?? null
  const revealed = useMemo(
    () => (segment ? segment.revealed : project.items.map((item) => item.rank)),
    [project.items, segment],
  )

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const layout = drawRankingOverlay(ctx, project, revealed, { fonts: STUDIO_RANKING_FONTS })
    setBandHeight(layout.bandHeight)
  }, [clip, fontsReady, project, revealed])

  // A new clip (or a new trim): start it at its trim.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !clip) return
    video.currentTime = clip.trimStartSec
    if (playing !== null) void video.play().catch(() => setPlaying(null))
    else video.pause()
  }, [clip, playing])

  const onTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !clip) return
    if (segment) setElapsed(segment.startSec + Math.max(0, video.currentTime - clip.trimStartSec))
    if (video.currentTime < clip.trimEndSec - 0.03) return
    if (playing === null) {
      video.pause()
      video.currentTime = clip.trimStartSec
      return
    }
    setPlaying(playing + 1 < segments.length ? playing + 1 : null)
  }

  const total = segments.reduce((sum, s) => sum + s.durSec, 0)
  const top = (bandHeight / RANKING_HEIGHT) * 100
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative aspect-[9/16] h-[min(72vh,760px)] overflow-hidden rounded-xl border border-white/10 bg-[#111]"
        data-testid="ranking-stage"
      >
        {clip && (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- the user's own clips
          <video
            className="absolute left-0 w-full object-cover"
            key={clip.url}
            onEnded={() => setPlaying(playing !== null && playing + 1 < segments.length ? playing + 1 : null)}
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
        {!clip && (
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
          disabled={!segments.length}
          onClick={() => {
            setElapsed(0)
            setPlaying(playing === null ? 0 : null)
          }}
          size="sm"
          variant="secondary"
        >
          {playing === null ? '▶ Play' : '■ Stop'}
        </Button>
        <Timeline current={playing} elapsed={playing === null ? 0 : elapsed} segments={segments} total={total} />
        <span className="w-12 text-right text-xs text-secondary tabular-nums">{total.toFixed(1)} s</span>
      </div>
    </div>
  )
}

function Timeline({
  current,
  elapsed,
  segments,
  total,
}: {
  current: null | number
  elapsed: number
  segments: ReturnType<typeof rankingSegments>
  total: number
}) {
  if (!total) return <div className="h-6 flex-1 rounded bg-white/5" />
  return (
    <div className="relative flex h-6 flex-1 overflow-hidden rounded bg-white/5">
      {segments.map((s, i) => (
        <div
          className={cn(
            'flex items-center justify-center border-r border-black/40 text-[10px] font-semibold',
            i === current ? 'bg-white/25 text-primary' : 'bg-white/10 text-secondary',
          )}
          key={s.item.id}
          style={{ width: `${(s.durSec / total) * 100}%` }}
          title={`#${s.item.rank} ${s.item.label}`}
        >
          #{s.item.rank}
        </div>
      ))}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
        style={{ left: `${(elapsed / total) * 100}%` }}
      />
    </div>
  )
}
