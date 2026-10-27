import { useLayoutEffect, useRef } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { createEngine3D, type Engine3D, THREE } from '../stage'

import type { Avatar3D } from './avatar-types'
import { type Area, BOARD, type Shot, shotIndex, shotProgress } from './framing'
import { type Cue, hostPose, type Pose } from './pose'
import { type GestureSounds, GestureSoundTrack } from './sounds'

/** How high the avatar's waist stands (metres): the frame cuts it there. */
export const WAIST_Y = 1

/** The camera per shot: its distance, how high it looks, and how far it sits to the side (a
 *  host on the screen's left has the camera moved right). */
const CAMERA: Record<Shot, { d: number; side: number; y: number }> = {
  close: { d: 1.3, side: 0, y: 1.64 },
  left: { d: 3, side: 0.22, y: 1.8 },
  medium: { d: 3, side: 0, y: 1.84 },
  right: { d: 3, side: -0.22, y: 1.8 },
  wide: { d: 4.2, side: 0, y: 2.15 },
}

/** Points the camera for a shot, `k` 0..1 through it (a slow push-in and drift). */
export function frameShot(camera: THREE.PerspectiveCamera, shot: Shot, k: number, t: number): void {
  const c = CAMERA[shot]
  const d = c.d * (1 - 0.06 * k)
  const swing = Math.sin(t * 0.25) * 0.05
  camera.position.set(c.side + Math.sin(swing) * d, c.y, Math.cos(swing) * d)
  camera.lookAt(c.side, c.y, 0)
  camera.updateProjectionMatrix()
}

/** What the set gives back: optional work on every frame. */
export type Set3D = { update?: (t: number, i: number, shot: Shot) => void }

/**
 * A 3D talking head: the 3D look's engine (studio light), the set Claude builds, the avatar posed
 * from the voice and the cues, the camera per shot, and the board (SVG pictures over the frame).
 * Put `<Voice />`, `<Music />` and `<Captions />` around it in `Animation.tsx`.
 */
export function TalkingHead3D({
  avatar,
  background = '#1B1F2A',
  board = () => '',
  cues = [],
  set,
  shots,
  sounds,
}: {
  avatar: Avatar3D
  background?: string
  /** Pictures for line i at t, as SVG for the 1080×1920 screen, inside `area` (the free space). */
  board?: (t: number, i: number, area: Area) => string
  cues?: Cue[]
  /** Builds the set once (walls, props, lights) in E.scene; the avatar stands at the origin. */
  set: (E: Engine3D) => Set3D
  shots: Shot[]
  /** The gestures' sounds: on by default (a boop on a wave, a ding on a thumbs up…); false for
   *  none, or your own per gesture. */
  sounds?: false | GestureSounds
}) {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const gl = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const made = useRef<null | {
    E: Engine3D
    host: { pose: (p: Pose) => void; root: THREE.Object3D }
    stage: Set3D
  }>(null)
  const t = frame / fps
  const i = shotIndex(t)
  const shot = shots[i] ?? 'medium'
  useLayoutEffect(() => {
    if (!made.current && gl.current && overlay.current) {
      const E = createEngine3D({ background, gl: gl.current, overlay: overlay.current })
      const host = avatar.build(THREE)
      host.root.position.y = WAIST_Y
      E.scene.add(host.root)
      made.current = { E, host, stage: set(E) }
    }
    if (!made.current) return
    const { E, host, stage } = made.current
    host.pose(hostPose(t, cues))
    stage.update?.(t, i, shot)
    frameShot(E.camera, shot, shotProgress(t, durationInFrames / fps), t)
    E.sync()
    E.render()
  }, [avatar, background, cues, durationInFrames, fps, i, set, shot, t])
  return (
    <AbsoluteFill>
      {sounds !== false && <GestureSoundTrack cues={cues} sounds={sounds} />}
      <canvas
        height={1920}
        ref={gl}
        style={{ left: 0, position: 'absolute', top: 0 }}
        width={1080}
      />
      <canvas
        height={1920}
        ref={overlay}
        style={{ display: 'none', left: 0, position: 'absolute', top: 0 }}
        width={1080}
      />
      <svg
        dangerouslySetInnerHTML={{ __html: board(t, i, BOARD[shot]) }}
        height="100%"
        style={{ inset: 0, position: 'absolute' }}
        viewBox="0 0 1080 1920"
        width="100%"
      />
    </AbsoluteFill>
  )
}
