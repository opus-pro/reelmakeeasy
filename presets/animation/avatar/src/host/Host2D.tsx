import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { beatPulse } from '../beat'
import { type SfxName, type SoundCue, Sounds } from '../kit'

import type { Avatar2D } from './avatar-types'
import {
  cutAt,
  hostStops,
  speedOf,
  type Transition,
  transitionAt,
  travel,
  walkAt,
} from './blocking'
import { type Area, BOARD, type Shot, shotIndex, shotProgress } from './framing'
import { AVATAR_PIXEL, pixelFilter } from './pixelate'
import { type Cue, hostPose, type Pose } from './pose'
import { type GestureSounds, GestureSoundTrack } from './sounds'

/** Where the avatar's box sits in each shot: its waist at (x, y) on screen, scaled. A flat
 *  (2D or pixel-art) avatar in a 3D world stands in the same places. */
export const PLACE: Record<Shot, Place> = {
  close: { s: 1.45, x: 540, y: 2330 },
  corner: { s: 0.5, x: 820, y: 1950 },
  'corner-left': { s: 0.5, x: 260, y: 1950 },
  left: { s: 0.8, x: 300, y: 1960 },
  medium: { s: 0.92, x: 540, y: 1960 },
  right: { s: 0.8, x: 780, y: 1960 },
  wide: { s: 0.62, x: 540, y: 1940 },
}

export type Place = { s: number; x: number; y: number }

let pixelIds = 0

/** The avatar drawn for a pose at a place on screen: leaning and breathing about its waist (a
 *  pixel-art one cut to its grid). */
export function placeAvatar2D(avatar: Avatar2D, p: Pose, { s, x, y }: Place): string {
  const breathe = 1 + 0.008 * p.breath
  const drawn = `<g transform="translate(${x},${y}) scale(${s}) rotate(${p.lean}) scale(1,${breathe})">${avatar.draw(p)}</g>`
  if (avatar.style !== 'pixel') return drawn
  const id = `avatar-px-${(pixelIds = (pixelIds + 1) % 100000)}`
  const block = Math.max(2, Math.round(AVATAR_PIXEL * s))
  return `<defs>${pixelFilter(id, block, { height: 6000, width: 6000, x: -2500, y: -2500 })}</defs><g filter="url(#${id})">${drawn}</g>`
}

const ease = (k: number) => k * k * (3 - 2 * k)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** The host's place mid-walk: two steps across (a hop each), leaning into the walk. */
function walkPlace(from: Shot, to: Shot, k: number): { lean: number; place: Place } {
  const a = PLACE[from]
  const b = PLACE[to]
  const e = ease(k)
  const s = lerp(a.s, b.s, e)
  const going = k > 0 && k < 1 ? 1 : 0
  const hop = Math.abs(Math.sin(k * Math.PI * 2)) * 34 * s * going
  const dir = Math.sign(b.x - a.x)
  return {
    lean: dir * 7 * Math.sin(k * Math.PI),
    place: { s, x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) - hop },
  }
}

/** The sounds each scene transition makes, from its cut (a walk gets a light swish; a dropped
 *  page lands with a thud). */
const TRANSITION_SOUNDS: Record<Exclude<Transition, 'cut'>, { after?: number; name: SfxName }[]> = {
  blinds: [{ name: 'zip' }],
  drop: [{ name: 'slide-down' }, { after: 0.3, name: 'hit' }],
  flip: [{ name: 'swish' }, { after: 0.22, name: 'pop' }],
  iris: [{ name: 'twinkle' }],
  move: [{ name: 'swish' }],
  slide: [{ name: 'swish' }],
  whip: [{ name: 'whoosh' }],
  zoom: [{ name: 'whoosh' }],
}

function transitionSoundCues(shots: Shot[], cues: Cue[], transitions: Transition[]): SoundCue[] {
  const out: SoundCue[] = []
  shots.forEach((shot, i) => {
    const kind = transitions[i] ?? 'move'
    if (i === 0 || kind === 'cut') return
    // A walk only sounds when the host goes somewhere.
    if (kind === 'move' && shots[i - 1] === shot) return
    for (const s of TRANSITION_SOUNDS[kind])
      out.push({ at: cutAt(i) + (s.after ?? 0), name: s.name, volume: kind === 'move' ? 0.2 : 0.4 })
  })
  for (const c of cues) if (c.move) out.push({ at: c.at, name: 'swish', volume: 0.2 })
  return out
}

/** Diagonal stripes covering the frame, each `amount` (0..1) of its width, the first ones ahead. */
function blindsClip(id: string, k: number): string {
  const bands = 8
  const width = 2600 / bands
  const rects = Array.from({ length: bands }, (_, j) => {
    const a = Math.min(1, Math.max(0, k * 1.7 - j * 0.09))
    const w = width * (1 - (1 - a) ** 3)
    return `<rect x="${(-760 + j * width).toFixed(1)}" y="-700" width="${w.toFixed(1)}" height="3300" transform="rotate(18 540 960)"/>`
  }).join('')
  return `<clipPath id="${id}">${rects}</clipPath>`
}

/** `translate`/`scale` about the frame's centre. */
const aboutCentre = (s: number) => `translate(540 960) scale(${s}) translate(-540 -960)`

/** A horizontal motion blur filter (none when it would barely show). */
function blurFilter(id: string, px: number): string {
  return px < 0.4
    ? ''
    : `<filter id="${id}" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="${px.toFixed(1)} ${(px * 0.15).toFixed(1)}"/></filter>`
}

/**
 * A 2D talking head: on every frame, the set, the avatar posed from the voice and the cues, and
 * the board (pictures beside or above the host). Put `<Voice />`, `<Music />` and `<Captions />`
 * around it in `Animation.tsx`.
 *
 * The host walks between spots (a line's new shot, or a `move` cue), points at spots on screen
 * (`point` cues with a `target`), and a line can change the whole scene on its way in
 * (`transitions`: slide, whip, zoom, iris, flip, drop, blinds; see blocking.ts).
 */
export function TalkingHead2D({
  avatar,
  board = () => '',
  cues = [],
  defs = '',
  irisAt,
  set,
  shots,
  sounds,
  transitions = [],
}: {
  avatar: Avatar2D
  /** Pictures for line i at t, as SVG for the 1080×1920 screen, inside `area` (the free space). */
  board?: (t: number, i: number, area: Area) => string
  cues?: Cue[]
  defs?: string
  /** Where line i's iris opens from (default: the host's face). */
  irisAt?: (i: number) => [number, number]
  /** The set behind the host for line i at t: SVG for the 1080×1920 screen. */
  set: (t: number, i: number, shot: Shot) => string
  /** One shot per voice line, in order. */
  shots: Shot[]
  /** The gestures' and transitions' sounds: on by default (a boop on a wave, a whoosh on a
   *  whip…); false for none, or your own per gesture. */
  sounds?: false | GestureSounds
  /** How each line comes in (index = line): `move` by default; see blocking.ts. */
  transitions?: Transition[]
}) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const t = frame / fps
  const i = shotIndex(t)
  const shot = shots[i] ?? 'medium'
  const stops = useMemo(() => hostStops(shots, cues, transitions), [shots, cues, transitions])
  const transitionSounds = useMemo(
    () => transitionSoundCues(shots, cues, transitions),
    [shots, cues, transitions],
  )
  const walk = walkAt(stops, t)
  const { lean, place } = walkPlace(walk.from, walk.to, walk.k)
  // A slow push-in through the shot, and a little kick on the cut.
  const k = shotProgress(t, durationInFrames / fps)
  // …and a breath of a pulse on each bar of the music.
  const push =
    1 + 0.045 * k + 0.02 * Math.max(0, 1 - k * 8) + 0.006 * beatPulse(t, 'downbeats', 0.4)
  // Pushed in about the face (900 up the box), so the face stays where the shot put it.
  const at = { s: place.s * push, x: place.x, y: place.y + 900 * place.s * (push - 1) }
  const toBox = (x: number, y: number): [number, number] => [(x - at.x) / at.s, (y - at.y) / at.s]
  const p = hostPose(t, cues, toBox)
  const posed = { ...p, lean: p.lean + lean }
  const host = placeAvatar2D(avatar, posed, at)
  const area = BOARD[walk.to]

  const tr = transitionAt(transitions, i, t)
  let svg: string
  if (tr) {
    const before = shots[i - 1] ?? 'medium'
    const oldScene = `${set(t, i - 1, before)}${board(t, i - 1, BOARD[before])}`
    const newScene = `${set(t, i, shot)}${board(t, i, area)}`
    const m = travel(tr.k)
    const blur = speedOf(tr.k)
    // The host in each scene for the moves that carry it with the frame: the old one where it
    // stood just before the cut (it may have walked there mid-line).
    const was = walkAt(stops, cutAt(i) - 1e-3)
    const oldHost = placeAvatar2D(
      avatar,
      hostPose(t, cues),
      walkPlace(was.from, was.to, was.k).place,
    )
    if (tr.kind === 'slide') {
      // The camera slides on to the next stop: the old set and board leave as one strip with the
      // new one, the host walking across in front. The world moves against the host's walk (a
      // host walking left sees the next stop come in from the left).
      const dir = PLACE[shot].x < PLACE[walkAt(stops, cutAt(i) - 1e-3).to].x ? 1 : -1
      svg =
        `<defs>${defs}${blurFilter('th-o', 22 * blur)}</defs>` +
        `<g transform="translate(${(dir * 1080 * m).toFixed(1)} 0)"${blur > 0.02 ? ' filter="url(#th-o)"' : ''}>${oldScene}</g>` +
        `<g transform="translate(${(-dir * 1080 * (1 - m)).toFixed(1)} 0)"${blur > 0.02 ? ' filter="url(#th-o)"' : ''}>${newScene}</g>` +
        host
    } else if (tr.kind === 'flip') {
      // A card turning over about the frame's middle: the old side narrows and darkens to an edge,
      // the new side opens out from it, the host in front.
      const half = tr.k < 0.5
      const e = half ? tr.k * 2 : (tr.k - 0.5) * 2
      const w = half ? 1 - e * e : 1 - (1 - e) * (1 - e)
      const shade = half ? 0.45 * e : 0.45 * (1 - e)
      const face = half ? oldScene : newScene
      svg =
        `<defs>${defs}</defs><rect width="1080" height="1920" fill="#1a1a1a"/>` +
        `<g transform="translate(540 960) scale(${Math.max(0.001, w).toFixed(4)} ${(1 - 0.06 * (1 - w)).toFixed(4)}) translate(-540 -960)">${face}<rect width="1080" height="1920" fill="#000" opacity="${shade.toFixed(3)}"/></g>` +
        host
    } else if (tr.kind === 'drop') {
      // A new page falls from the top, turning a little, lands with a bounce and settles; the old
      // page under it sinks back and darkens.
      const fall = Math.min(1, tr.k / 0.55)
      const land = Math.max(0, tr.k - 0.55) / 0.45
      const y =
        -1920 * (1 - fall * fall) + (fall >= 1 ? -40 * Math.sin(land * Math.PI) * (1 - land) : 0)
      const rot =
        -5 * (1 - fall) + (fall >= 1 ? 1.2 * Math.sin(land * Math.PI * 2) * (1 - land) : 0)
      svg =
        `<defs>${defs}<filter id="th-drop" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="24" stdDeviation="22" flood-opacity="0.35"/></filter></defs>` +
        `<g transform="${aboutCentre(1 - 0.05 * tr.k)}">${oldScene}<rect width="1080" height="1920" fill="#000" opacity="${(0.3 * Math.min(1, tr.k * 1.5)).toFixed(3)}"/></g>` +
        `<g transform="translate(0 ${y.toFixed(1)}) rotate(${rot.toFixed(2)} 540 960)" filter="url(#th-drop)">${newScene}</g>` +
        host
    } else if (tr.kind === 'blinds') {
      // Diagonal stripes sweep across, each widening until they close into the new scene.
      svg =
        `<defs>${defs}${blindsClip('th-blinds', tr.k)}</defs>` +
        oldScene +
        `<g clip-path="url(#th-blinds)">${newScene}</g>` +
        host
    } else if (tr.kind === 'whip') {
      const stretch = 1 + 0.2 * blur
      const whip = (dx: number) =>
        `translate(${dx.toFixed(1)} 0) translate(540 960) scale(${stretch} 1) translate(-540 -960)`
      svg =
        `<defs>${defs}${blurFilter('th-o', 30 * blur)}</defs>` +
        `<g transform="${whip(-1080 * m)}" filter="url(#th-o)">${set(t, i - 1, before)}${oldHost}${board(t, i - 1, BOARD[before])}</g>` +
        `<g transform="${whip(1080 * (1 - m))}" filter="url(#th-o)">${set(t, i, shot)}${host}${board(t, i, area)}</g>`
    } else if (tr.kind === 'zoom') {
      // Flying through: the old scene grows past the camera and fades; the new set is already
      // there behind it, and its host and pictures come up out of the distance.
      const near = 0.6 + 0.4 * m
      svg =
        `<defs>${defs}${blurFilter('th-o', 16 * blur)}</defs>` +
        set(t, i, shot) +
        `<g transform="${aboutCentre(near)}" opacity="${Math.min(1, 0.2 + m).toFixed(3)}">${host}${board(t, i, area)}</g>` +
        `<g transform="${aboutCentre(1 + 3 * m)}" opacity="${((1 - m) ** 2).toFixed(3)}" filter="url(#th-o)">${set(t, i - 1, before)}${oldHost}${board(t, i - 1, BOARD[before])}</g>`
    } else {
      // An iris: the new scene opens as a circle from the host's face, its edge a soft ring.
      const [cx, cy] = irisAt?.(i) ?? [at.x, at.y - 900 * at.s]
      const r = 2300 * m
      svg =
        `<defs>${defs}<clipPath id="th-iris"><circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/></clipPath></defs>` +
        oldScene +
        `<g clip-path="url(#th-iris)">${newScene}</g>` +
        `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="${(0.6 * (1 - m)).toFixed(3)}" stroke-width="${(30 * (1 - m) + 4).toFixed(1)}"/>` +
        host
    }
  } else {
    svg = `<defs>${defs}</defs>${set(t, i, shot)}${host}${board(t, i, area)}`
  }
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {sounds !== false && <GestureSoundTrack cues={cues} sounds={sounds} />}
      {sounds !== false && <Sounds cues={transitionSounds} />}
      <svg
        dangerouslySetInnerHTML={{ __html: svg }}
        height="100%"
        style={{ inset: 0, position: 'absolute' }}
        viewBox="0 0 1080 1920"
        width="100%"
      />
    </AbsoluteFill>
  )
}
