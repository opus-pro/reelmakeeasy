import { beatPulse, music } from '../beat'
import { spec, type VoiceLine, voiceLines } from '../clock'
import { type Vowel, vowelOf } from '../kit'

import type { Shot } from './framing'

/**
 * The host's pose on every frame: what the avatar draws. The voice drives the mouth, the blinks,
 * the breath and the small head moves; Claude's cues add gestures, looks, moods and leans on the
 * words they belong to. Everything comes from t (seconds) alone, so any frame renders the same.
 */

/** What a hand does. `rest` hangs by the waist; the others are raised into the frame. */
export type Gesture = 'count' | 'open' | 'point' | 'rest' | 'shrug' | 'think' | 'thumb' | 'wave'

export const GESTURES: readonly Gesture[] = [
  'rest',
  'open',
  'point',
  'count',
  'thumb',
  'wave',
  'think',
  'shrug',
]

/** One arm: its gesture, how far into it (0 rest .. 1 the full gesture), fingers up for `count`,
 *  and seconds since the gesture began (a wave swings with it). `aim`: for a `point` at a
 *  target, the way to it from the shoulder (a unit vector in the avatar's box, y down). */
export type ArmPose = {
  aim?: [number, number]
  gesture: Gesture
  k: number
  n: number
  since: number
}

export type Mood = 'serious' | 'smile' | 'surprised'

/** Where the eyes look: the camera, or off to one side of the screen (at the board), or up. */
export type Look = 'camera' | 'left' | 'right' | 'up'

/**
 * A pose. Angles are degrees; `left` and `right` are sides of the screen (the avatar faces the
 * viewer, so `right` is the avatar's own left hand).
 */
export type Pose = {
  breath: number
  /** -1 frown .. 0 .. 1 raised. */
  brows: number
  /** 0 open .. 1 shut. */
  blink: number
  /** Eyes, -1..1 each way: [x right, y down]. */
  gaze: [number, number]
  head: { nod: number; tilt: number; turn: number }
  /** Body lean, degrees (positive leans to the screen's right). */
  lean: number
  left: ArmPose
  /** 0 shut .. 1 wide open: the voice's loudness now. */
  mouth: number
  right: ArmPose
  /** 0 straight .. 1 a big smile. */
  smile: number
  /** Shoulders up (a shrug), 0..1. */
  shrug: number
  t: number
  /** The mouth's shape: the vowel being said ('M' closed). */
  vowel: Vowel
}

/**
 * A cue on the timeline, at `at` seconds (put it on its word: `word(i, 'three').start`):
 * a gesture (`hand` left, right or both; held `hold` seconds, `n` fingers for count), a look,
 * a mood, a lean, a nod, or a move.
 * - `target` (with `gesture: 'point'`): the spot on screen (1080x1920 pixels) the host points
 *   at: the arm aims there, the eyes follow, and the hand nearest it points unless `hand` says.
 *   `pointedAt(cues, t, spot)` tells the board, so the thing pointed at can react.
 * - `move`: the host walks to that shot's spot (left, right, close: to the front, corner...) and
 *   stays there until the next line's shot or move.
 */
export type Cue = {
  at: number
  gesture?: Gesture
  hand?: 'both' | 'left' | 'right'
  hold?: number
  lean?: number
  look?: Look
  mood?: Mood
  move?: Shot
  n?: number
  nod?: boolean
  target?: [number, number]
}

/** Turns a spot on screen into the avatar's own box (where the stage has placed it now). */
export type ToBox = (x: number, y: number) => [number, number]

/** The shoulders in the avatar's box, for aiming (the avatars' are near here). */
const SHOULDER: [number, number] = [220, -580]

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (x: number) => {
  const k = clamp(x)
  return k * k * (3 - 2 * k)
}
/** 0→1 eased between times a and b. */
const ss = (a: number, b: number, t: number) => smooth((t - a) / (b - a))
/** A seeded 0..1 from an integer. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Seconds a gesture takes to come in and to go back. */
const IN_SEC = 0.28
const OUT_SEC = 0.35
const DEFAULT_HOLD = 1.4

export const REST: ArmPose = { gesture: 'rest', k: 0, n: 0, since: 0 }

/** The voice line being said at t, if any. */
function lineAt(t: number): null | VoiceLine {
  return voiceLines.find((l) => t >= l.start && t <= l.end) ?? null
}

function rawOpen(t: number): number {
  const line = lineAt(t)
  if (!line) return 0
  const f = (t - line.start) * spec.fps
  const i = Math.floor(f)
  const a = line.envelope[i] ?? 0
  const b = line.envelope[i + 1] ?? a
  return a + (b - a) * (f - i)
}

/** How open the mouth is at t, eased over the last few 60ths of a second. */
export function mouthOpen(t: number): number {
  let open = 0
  ;[0.4, 0.3, 0.2, 0.1].forEach((k, i) => {
    open += k * Math.min(1, rawOpen(t - i / 60) * 1.4)
  })
  return open
}

/** The vowel being said at t ('M' between words). */
export function vowelAt(t: number): Vowel {
  const line = lineAt(t)
  const w = line?.words.find((x) => t >= x.start && t <= x.end + 0.04)
  return w ? vowelOf(w.text) : 'M'
}

/** The mouth's width and height factors for a vowel (1 = a relaxed 'A'). */
export function mouthShape(v: Vowel): { h: number; w: number } {
  if (v === 'E' || v === 'I') return { h: 0.5, w: 1.15 }
  if (v === 'O') return { h: 0.85, w: 0.7 }
  if (v === 'U') return { h: 0.65, w: 0.55 }
  if (v === 'M') return { h: 0.15, w: 0.9 }
  return { h: 1, w: 1 }
}

/** 0..1..0 blinks: about every 3-5 s, plus one as each line starts. */
export function blinkAt(t: number): number {
  const lid = (start: number) => {
    const p = t - start
    return p >= 0 && p < 0.16 ? Math.sin((p / 0.16) * Math.PI) : 0
  }
  let v = 0
  let at = 0.7
  for (let i = 0; at < t + 1; i++) {
    v = Math.max(v, lid(at))
    at += 3 + hash(i) * 2
  }
  for (const l of voiceLines) v = Math.max(v, lid(l.start - 0.05))
  return v
}

/** The way from a shoulder to a target in the box, as a unit vector. */
function aimFrom(side: 'left' | 'right', [x, y]: [number, number]): [number, number] {
  const dx = x - (side === 'left' ? -SHOULDER[0] : SHOULDER[0])
  const dy = y - SHOULDER[1]
  const d = Math.hypot(dx, dy) || 1
  return [dx / d, dy / d]
}

/** The hand a cue uses: as it says; a point at a target, the hand on the target's side. */
function handOf(c: Cue, toBox?: ToBox): 'both' | 'left' | 'right' {
  if (c.hand) return c.hand
  if (c.target && toBox) return toBox(c.target[0], c.target[1])[0] < 0 ? 'left' : 'right'
  return 'right'
}

/** An arm at t from the cues for its side. */
function armAt(cues: Cue[], side: 'left' | 'right', t: number, toBox?: ToBox): ArmPose {
  let pose = REST
  for (const c of cues) {
    if (!c.gesture || c.at > t) continue
    const hand = handOf(c, toBox)
    if (hand !== side && hand !== 'both') continue
    const hold = c.hold ?? DEFAULT_HOLD
    const k =
      ss(c.at - IN_SEC * 0.5, c.at + IN_SEC * 0.5, t) *
      (1 - ss(c.at + hold, c.at + hold + OUT_SEC, t))
    if (k <= 0.001) continue
    const aim =
      c.gesture === 'point' && c.target && toBox
        ? aimFrom(side, toBox(c.target[0], c.target[1]))
        : undefined
    pose = { ...(aim ? { aim } : {}), gesture: c.gesture, k, n: c.n ?? 1, since: t - c.at }
  }
  return pose
}

/** The newest cue of a kind at or before t. */
function last<K extends keyof Cue>(cues: Cue[], key: K, t: number): Cue | undefined {
  let found: Cue | undefined
  for (const c of cues)
    if (c[key] !== undefined && c.at <= t && (!found || c.at >= found.at)) found = c
  return found
}

/** The host's pose at t (seconds), from the voice and the cues. `toBox`: where the stage has
 *  placed the avatar now, so a point aims at its target on screen. */
export function hostPose(t: number, cues: Cue[] = [], toBox?: ToBox): Pose {
  const open = mouthOpen(t)
  const line = lineAt(t)
  const talking = line ? 1 : 0
  // Eyes: on the camera, with small darts; a look cue turns them (and the head a little).
  const lookCue = last(cues, 'look', t)
  const look = lookCue?.look ?? 'camera'
  const lookK = lookCue ? ss(lookCue.at - 0.15, lookCue.at + 0.15, t) : 0
  const target: [number, number] =
    look === 'left'
      ? [-0.8, 0.05]
      : look === 'right'
        ? [0.8, 0.05]
        : look === 'up'
          ? [0.15, -0.8]
          : [0, 0]
  const dart = Math.floor(t / 1.7)
  const gaze: [number, number] = [
    target[0] * lookK + (look === 'camera' ? (hash(dart) - 0.5) * 0.18 : 0),
    target[1] * lookK + (look === 'camera' ? (hash(dart + 99) - 0.5) * 0.12 : 0),
  ]
  // Mood: smile by default; serious or surprised from a cue, eased over 0.3 s.
  const moodCue = last(cues, 'mood', t)
  const moodK = moodCue ? ss(moodCue.at - 0.15, moodCue.at + 0.15, t) : 0
  const mood = moodCue?.mood ?? 'smile'
  const smile =
    mood === 'smile' ? 0.55 : 0.55 * (1 - moodK) + (mood === 'surprised' ? 0.1 : 0.05) * moodK
  const question = line?.text.trim().endsWith('?') ? 1 : 0
  const lineIn = line
    ? ss(line.start - 0.1, line.start + 0.25, t) * (1 - ss(line.start + 0.6, line.start + 1.2, t))
    : 0
  const brows = clamp(
    0.15 +
      0.45 * lineIn +
      0.35 * question * talking +
      (mood === 'surprised' ? 0.6 * moodK : 0) -
      (mood === 'serious' ? 0.45 * moodK : 0),
    -1,
    1,
  )
  // Nods: on cues, and a small one on each line's longest word.
  let nod = 0
  const nodAt = (at: number, size: number) => {
    const p = t - at
    if (p > -0.1 && p < 0.45) nod += size * Math.sin(clamp((p + 0.1) / 0.55) * Math.PI)
  }
  for (const c of cues) if (c.nod) nodAt(c.at, 7)
  for (const l of voiceLines) {
    const w = [...l.words].sort((a, b) => b.end - b.start - (a.end - a.start))[0]
    if (w) nodAt(w.start, 3)
  }
  const leanCue = last(cues, 'lean', t)
  const lean = leanCue ? (leanCue.lean ?? 0) * ss(leanCue.at - 0.3, leanCue.at + 0.3, t) : 0
  const groove = grooveAt(t, talking)
  const left = armAt(cues, 'left', t, toBox)
  const right = armAt(cues, 'right', t, toBox)
  // Eyes on what the hand points at.
  const aimed = [left, right].find((a) => a.aim && a.k > 0.05)
  if (aimed?.aim) {
    gaze[0] += (aimed.aim[0] * 0.9 - gaze[0]) * aimed.k
    gaze[1] += (Math.max(-0.6, Math.min(0.4, aimed.aim[1])) - gaze[1]) * aimed.k * 0.6
  }
  const shrug = Math.max(
    left.gesture === 'shrug' ? left.k : 0,
    right.gesture === 'shrug' ? right.k : 0,
  )
  return {
    blink: blinkAt(t),
    breath: 0.5 + 0.5 * Math.sin(t * 1.7),
    brows,
    gaze,
    head: {
      // A small nod on each beat of the music, softer while talking.
      nod: nod + open * 2.5 * talking + groove.nod,
      tilt: Math.sin(t * 0.7) * 2.2 + (look === 'left' ? -3 : look === 'right' ? 3 : 0) * lookK,
      turn:
        Math.sin(t * 0.43 + 1) * 3 +
        target[0] * 10 * lookK +
        (aimed?.aim ? aimed.aim[0] * 9 * aimed.k : 0),
    },
    // Leaning toward what the hand points at.
    lean:
      lean +
      (music.bpm ? groove.sway : Math.sin(t * 0.5) * 0.8) +
      (aimed?.aim ? Math.sign(aimed.aim[0]) * 4 * aimed.k : 0),
    left,
    mouth: open,
    right,
    shrug,
    smile,
    t,
    vowel: open > 0.06 ? vowelAt(t) : 'M',
  }
}

/** Moving with the music: a nod on each beat, a sway once per two bars. Nothing without music. */
function grooveAt(t: number, talking: number): { nod: number; sway: number } {
  if (!music.bpm) return { nod: 0, sway: 0 }
  const bar = (60 / music.bpm) * music.beatsPerBar
  const first = music.downbeats[0] ?? 0
  return {
    nod: beatPulse(t, 'beats', 0.22) * (talking ? 1.2 : 2.4),
    sway: Math.sin((Math.PI * (t - first)) / bar) * 1.4,
  }
}

/** A still pose for the avatar sheet: neutral, with these changes. */
export function stillPose(over: Partial<Pose> = {}): Pose {
  return {
    blink: 0,
    breath: 0.5,
    brows: 0.1,
    gaze: [0, 0],
    head: { nod: 0, tilt: 0, turn: 0 },
    lean: 0,
    left: REST,
    mouth: 0,
    right: REST,
    shrug: 0,
    smile: 0.55,
    t: 0,
    vowel: 'M',
    ...over,
  }
}
