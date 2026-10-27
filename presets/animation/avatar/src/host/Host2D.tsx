import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { beatPulse } from '../beat'

import type { Avatar2D } from './avatar-types'
import { type Area, BOARD, type Shot, shotIndex, shotProgress } from './framing'
import { type Cue, hostPose, type Pose } from './pose'
import { type GestureSounds, GestureSoundTrack } from './sounds'

/** Where the avatar's box sits in each shot: its waist at (x, y) on screen, scaled. */
const PLACE: Record<Shot, { s: number; x: number; y: number }> = {
  close: { s: 1.45, x: 540, y: 2330 },
  left: { s: 0.8, x: 300, y: 1960 },
  medium: { s: 0.92, x: 540, y: 1960 },
  right: { s: 0.8, x: 780, y: 1960 },
  wide: { s: 0.62, x: 540, y: 1940 },
}

/** The avatar drawn for a pose at a place on screen: leaning and breathing about its waist. */
export function placeAvatar2D(
  avatar: Avatar2D,
  p: Pose,
  { s, x, y }: { s: number; x: number; y: number },
): string {
  const breathe = 1 + 0.008 * p.breath
  return `<g transform="translate(${x},${y}) scale(${s}) rotate(${p.lean}) scale(1,${breathe})">${avatar.draw(p)}</g>`
}

/**
 * A 2D talking head: on every frame, the set, the avatar posed from the voice and the cues, and
 * the board (pictures beside or above the host). Put `<Voice />`, `<Music />` and `<Captions />`
 * around it in `Animation.tsx`.
 */
export function TalkingHead2D({
  avatar,
  board = () => '',
  cues = [],
  defs = '',
  set,
  shots,
  sounds,
}: {
  avatar: Avatar2D
  /** Pictures for line i at t, as SVG for the 1080×1920 screen, inside `area` (the free space). */
  board?: (t: number, i: number, area: Area) => string
  cues?: Cue[]
  defs?: string
  /** The set behind the host for line i at t: SVG for the 1080×1920 screen. */
  set: (t: number, i: number, shot: Shot) => string
  /** One shot per voice line, in order. */
  shots: Shot[]
  /** The gestures' sounds: on by default (a boop on a wave, a ding on a thumbs up…); false for
   *  none, or your own per gesture. */
  sounds?: false | GestureSounds
}) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const t = frame / fps
  const i = shotIndex(t)
  const shot = shots[i] ?? 'medium'
  const place = PLACE[shot]
  // A slow push-in through the shot, and a little kick on the cut.
  const k = shotProgress(t, durationInFrames / fps)
  // …and a breath of a pulse on each bar of the music.
  const push =
    1 + 0.045 * k + 0.02 * Math.max(0, 1 - k * 8) + 0.006 * beatPulse(t, 'downbeats', 0.4)
  const p = hostPose(t, cues)
  // Pushed in about the face (900 up the box), so the face stays where the shot put it.
  const at = { s: place.s * push, x: place.x, y: place.y + 900 * place.s * (push - 1) }
  const svg = `<defs>${defs}</defs>${set(t, i, shot)}${placeAvatar2D(avatar, p, at)}${board(t, i, BOARD[shot])}`
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {sounds !== false && <GestureSoundTrack cues={cues} sounds={sounds} />}
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
