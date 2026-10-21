import {
  type RankingTimelinePart,
  soundsOf,
  transitionOf,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject } from '@shared/types/api/ranking'

/**
 * The preview's clock, as plain functions of the short's timeline: one playhead (seconds into the
 * short) decides which part is on screen and which sounds are playing, so jumping, scrubbing and
 * pausing all come down to moving that one number.
 */

/** The part on screen at `t`: the last one that has started (the first before 0, the last after the end). */
export function partIndexAt(parts: RankingTimelinePart[], t: number): number {
  let index = 0
  for (const [i, part] of parts.entries()) if (part.startSec <= t + 1e-6) index = i
  return index
}

/**
 * A sound in the short: when it starts and when it stops, in short seconds. Like the export, a
 * sound plays only inside its part: a clip's reveal sound and meme sounds stop where the clip
 * ends, and a transition's sound where the slide ends.
 */
export type CueWindow = { endSec: number; key: string; soundId: string; startSec: number }

/** Every sound of the short, from its timeline; `lengthOf` is a sound's playing length (null: unknown). */
export function cueWindows(
  project: RankingProject,
  parts: RankingTimelinePart[],
  lengthOf: (soundId: string) => null | number,
): CueWindow[] {
  const windows: CueWindow[] = []
  const add = (key: string, soundId: null | string, atSec: number, part: RankingTimelinePart) => {
    if (!soundId || atSec >= part.durSec) return
    const length = lengthOf(soundId)
    if (!length || length <= 0) return
    const startSec = part.startSec + atSec
    const endSec = Math.min(startSec + length, part.startSec + part.durSec)
    windows.push({
      endSec,
      // Which sound and when are part of the key: a sound changed while it plays restarts as
      // the new one instead of the old one running on.
      key: `${key}:${soundId}@${startSec.toFixed(3)}-${endSec.toFixed(3)}`,
      soundId,
      startSec,
    })
  }
  const reveal = soundsOf(project).reveal
  const transitionSound = transitionOf(project).sound
  for (const [i, part] of parts.entries()) {
    if (part.kind === 'transition') {
      add(`${i}:transition`, transitionSound, 0, part)
      continue
    }
    add(`${i}:reveal`, reveal, 0, part)
    for (const [c, cue] of (part.segment.item.cues ?? []).entries())
      add(`${i}:cue${c}`, cue.soundId, cue.atSec, part)
  }
  return windows
}

/** The sounds playing at `t`, each with how far into it the playhead is. */
export function activeCues(windows: CueWindow[], t: number): (CueWindow & { offsetSec: number })[] {
  return windows
    .filter((w) => t >= w.startSec - 1e-6 && t < w.endSec)
    .map((w) => ({ ...w, offsetSec: Math.max(0, t - w.startSec) }))
}

/** Where each rank's clip starts, in play order (for jumping rank to rank). */
export function rankStarts(parts: RankingTimelinePart[]): { rank: number; startSec: number }[] {
  return parts.flatMap((p) =>
    p.kind === 'clip' ? [{ rank: p.segment.item.rank, startSec: p.startSec }] : [],
  )
}

/** The rank to jump to from `t`: the next one, or the previous one (the start of this rank first, when well into it). */
export function jumpTarget(
  parts: RankingTimelinePart[],
  t: number,
  direction: -1 | 1,
): null | number {
  const starts = rankStarts(parts).map((r) => r.startSec)
  if (direction === 1) return starts.find((s) => s > t + 0.05) ?? null
  const before = starts.filter((s) => s < t - 0.05)
  const current = before.at(-1)
  if (current === undefined) return starts[0] ?? null
  // Well into a rank: back to its start; right at its start: the rank before.
  return t - current > 0.75 ? current : (before.at(-2) ?? current)
}

/** "0:07.3" */
export function formatTime(sec: number): string {
  // Rounded to tenths first, so 9.96 reads 0:10.0 (not 0:010.0) and 59.97 reads 1:00.0.
  const tenths = Math.round(Math.max(0, sec) * 10)
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths - minutes * 600) / 10
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}
