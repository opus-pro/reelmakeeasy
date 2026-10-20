import type {
  RankingItem,
  RankingProject,
  RankingRevealMode,
  RankingSounds,
  RankingStyle,
  RankingTitle,
  RankingTransition,
} from '@shared/types/api/ranking'

/** The output frame: a vertical short. */
export const RANKING_WIDTH = 1080
export const RANKING_HEIGHT = 1920
export const RANKING_FPS = 30

export const RANKING_MIN_ITEMS = 2
export const RANKING_MAX_ITEMS = 10
export const RANKING_DEFAULT_ITEMS = 5
export const RANKING_LABEL_MAX = 60
export const RANKING_TITLE_LINES_MAX = 3
export const RANKING_TITLE_WORDS_MAX = 12
/** A clip plays at most this long: a ranking short moves fast. */
export const RANKING_CLIP_MAX_SEC = 20
/** What a rank should play for a Short (the trend keeps each rank to about 3-5 s). */
export const RANKING_RANK_TARGET_SEC = { max: 5, min: 3 }
/** A new clip plays this long until trimmed. */
export const RANKING_DEFAULT_CLIP_SEC = 4.5
/** A Short stays under this. */
export const RANKING_SHORT_MAX_SEC = 60
export const RANKING_CUES_MAX = 8
export const RANKING_STICKERS_MAX = 20
export const RANKING_STICKER_TEXT_MAX = 40

/** Title colours the studio offers first (white, then the trend's red, cyan and yellow). */
export const RANKING_TITLE_COLORS = ['#ffffff', '#ff2a2a', '#22e5ff', '#ffd400', '#3dff6e', '#ff5fd2']

export const DEFAULT_RANKING_STYLE: RankingStyle = {
  labelColor: '#ffffff',
  numberColors: ['#ffd400', '#ff8a00', '#ff2a2a', '#ffffff'],
  outlineColor: '#000000',
}

export const DEFAULT_RANKING_TITLE: RankingTitle = {
  band: '#000000',
  lines: [
    [
      { color: '#ffffff', text: 'Ranking' },
      { color: '#ff2a2a', text: 'Funniest' },
    ],
    [
      { color: '#22e5ff', text: 'Cat Fails' },
      { color: '#ffffff', text: 'Ever' },
    ],
  ],
}

export const DEFAULT_RANKING_SOUNDS: RankingSounds = { music: null, musicVolume: 0.35, reveal: null }

export const RANKING_TRANSITION_MIN_SEC = 0.5
export const RANKING_TRANSITION_MAX_SEC = 3
export const RANKING_TRANSITION_TEXT_MAX = 40

export const DEFAULT_RANKING_TRANSITION: RankingTransition = {
  background: '#000000',
  durationSec: 1,
  enabled: false,
  sound: null,
  text: 'Number {rank}…',
  textColor: '#ffd400',
}

/** A project's sounds and transition, with defaults for one saved before they existed. */
export const soundsOf = (project: RankingProject): RankingSounds => project.sounds ?? DEFAULT_RANKING_SOUNDS
export const transitionOf = (project: RankingProject): RankingTransition =>
  project.transition ?? DEFAULT_RANKING_TRANSITION

/** A transition slide's text for the rank it leads into. */
export function transitionText(transition: RankingTransition, nextRank: number): string {
  return transition.text.replaceAll('{rank}', String(nextRank)).trim()
}

let counter = 0
/** A short id for a rank row (unique enough within one project). */
export function rankingItemId(): string {
  counter = (counter + 1) % 1_000_000
  return `r${Date.now().toString(36)}${counter.toString(36)}`
}

/** Ranks 1..count, empty. */
export function emptyItems(count: number): RankingItem[] {
  return Array.from({ length: count }, (_, i) => ({
    clip: null,
    id: rankingItemId(),
    label: '',
    rank: i + 1,
  }))
}

/** A new project: the trend's title, five empty ranks, revealed as a countdown. */
export function newRankingProject(id: string, now: string, name = 'Untitled ranking'): RankingProject {
  const items = emptyItems(RANKING_DEFAULT_ITEMS)
  return {
    createdAt: now,
    id,
    items,
    name,
    reveal: { mode: 'countdown', order: revealOrder('countdown', items.length) },
    sounds: DEFAULT_RANKING_SOUNDS,
    style: DEFAULT_RANKING_STYLE,
    title: DEFAULT_RANKING_TITLE,
    transition: DEFAULT_RANKING_TRANSITION,
    updatedAt: now,
  }
}

/**
 * The ranks in the order they're revealed. Countdown (N..1) saves the best for last; shuffle is
 * the "blind ranking" trend (the viewer doesn't know where the next one lands; #1 still comes last), fixed by `seed`
 * so a project shuffles the same way every time; custom keeps `current` when it still fits.
 */
export function revealOrder(
  mode: RankingRevealMode,
  count: number,
  current: number[] = [],
  seed = count,
): number[] {
  const ranks = Array.from({ length: count }, (_, i) => i + 1)
  if (mode === 'countup') return ranks
  if (mode === 'countdown') return ranks.toReversed()
  if (mode === 'custom' && isPermutation(current, count)) return current
  if (mode === 'custom') return ranks.toReversed()
  // A seeded Fisher-Yates over ranks 2..N, then rank 1 last: the top spot stays the payoff.
  let state = seed * 2_654_435_761 + 1
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
  const order = ranks.slice(1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  order.push(1)
  return order
}

/** Whether `order` holds each rank 1..count exactly once. */
export function isPermutation(order: number[], count: number): boolean {
  if (order.length !== count) return false
  const seen = new Set(order)
  return seen.size === count && order.every((r) => Number.isInteger(r) && r >= 1 && r <= count)
}

/** How long a clip plays: its trim, within the file and the cap. */
export function clipPlaySec(item: RankingItem): number {
  const clip = item.clip
  if (!clip) return 0
  const end = Math.min(clip.trimEndSec, clip.durationSec)
  return Math.max(0, Math.min(RANKING_CLIP_MAX_SEC, end - clip.trimStartSec))
}

/** One segment of the short: a rank's clip, and how many ranks are revealed while it plays. */
export type RankingSegment = { item: RankingItem; revealed: number[]; startSec: number; durSec: number }

/**
 * The short as segments, in reveal order: each rank's clip plays while its label (and every
 * label revealed before it) shows. Ranks without a clip are skipped.
 */
export function rankingSegments(project: RankingProject): RankingSegment[] {
  const byRank = new Map(project.items.map((item) => [item.rank, item]))
  const segments: RankingSegment[] = []
  const revealed: number[] = []
  let at = 0
  for (const rank of project.reveal.order) {
    const item = byRank.get(rank)
    if (!item) continue
    const durSec = clipPlaySec(item)
    if (durSec <= 0) continue
    revealed.push(rank)
    segments.push({ durSec, item, revealed: [...revealed], startSec: at })
    at += durSec
  }
  return segments
}

/** A piece of the finished short: a rank's clip, or the slide leading into the next rank. */
export type RankingTimelinePart =
  | { durSec: number; kind: 'clip'; segment: RankingSegment; startSec: number }
  | { durSec: number; kind: 'transition'; nextRank: number; startSec: number }

/** The whole short in play order: each rank's clip, with a transition slide between ranks. */
export function rankingTimeline(project: RankingProject): RankingTimelinePart[] {
  const transition = transitionOf(project)
  const parts: RankingTimelinePart[] = []
  let at = 0
  for (const [i, segment] of rankingSegments(project).entries()) {
    if (i > 0 && transition.enabled) {
      parts.push({ durSec: transition.durationSec, kind: 'transition', nextRank: segment.item.rank, startSec: at })
      at += transition.durationSec
    }
    parts.push({ durSec: segment.durSec, kind: 'clip', segment, startSec: at })
    at += segment.durSec
  }
  return parts
}

/**
 * Advice for a Short (never blocking): ranks that run long, a short over a minute, ranks with no
 * sound on their action.
 */
export function rankingAdvice(project: RankingProject): string[] {
  const advice: string[] = []
  const long = project.items.filter((item) => clipPlaySec(item) > RANKING_RANK_TARGET_SEC.max + 0.5)
  if (long.length)
    advice.push(
      `Rank ${long.map((i) => i.rank).join(', ')} play${long.length === 1 ? 's' : ''} over ${RANKING_RANK_TARGET_SEC.max} s: Shorts keep each rank to ${RANKING_RANK_TARGET_SEC.min}-${RANKING_RANK_TARGET_SEC.max} s.`,
    )
  const total = rankingTimeline(project).reduce((sum, part) => sum + part.durSec, 0)
  if (total > RANKING_SHORT_MAX_SEC) advice.push(`The short is ${Math.round(total)} s: keep it under a minute.`)
  const silent = project.items.filter((item) => item.clip && !item.cues?.length).map((item) => item.rank)
  if (silent.length && silent.length < project.items.length)
    advice.push(`Rank ${silent.join(', ')} ha${silent.length === 1 ? 's' : 've'} no sound on its action yet.`)
  return advice
}

/** What still stops the short from rendering, in plain words (empty when it's ready). */
export function rankingProblems(project: RankingProject): string[] {
  const problems: string[] = []
  const missing = project.items.filter((item) => !item.clip).map((item) => item.rank)
  if (missing.length) problems.push(`Add a clip to rank ${missing.join(', ')}.`)
  const unlabeled = project.items.filter((item) => !item.label.trim()).map((item) => item.rank)
  if (unlabeled.length) problems.push(`Write a label for rank ${unlabeled.join(', ')}.`)
  if (!project.title.lines.some((line) => line.some((word) => word.text.trim())))
    problems.push('Write a title.')
  return problems
}
