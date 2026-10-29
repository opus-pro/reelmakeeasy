import { useCallback } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'

import {
  type Avatar,
  type Cue,
  type GestureSounds,
  GestureSoundTrack,
  hostPose,
  pixelFilter,
  placeAvatar2D,
} from '../host'
import { type Engine, type PixelEpisode, PixelStage, THREE } from '../pixel'

/**
 * The Avatar explainer in Pixel art: the pixel stage with your world in it (built in `build`, as
 * the 8-bit skill builds an episode) and the avatar drawn into it on the same pixel grid, posed
 * from the voice and your cues (lip sync, blinks, gestures and their sounds). ReelMakeEasy owns
 * it: use it, never edit it.
 *
 * - A 3D avatar stands in the scene: `build(E, host)` gets `host.root` (the waist at the origin,
 *   facing +z, the head about 0.72 m up). Place it (`host.root.position`, `.scale`,
 *   `.rotation.y`), frame it with `E.camera` and light it with your scene's lights; it is drawn,
 *   dithered and lit like everything else.
 * - A 2D or pixel-art avatar is drawn over the scene, cut to the same pixel grid (a pixel-art one
 *   to its own, coarser grid): `place(t)` says where its waist sits on the 1080×1920 screen and
 *   how big it is (default: centre bottom, medium). `host` is null in `build`.
 */
export function PixelTalkingHead({
  avatar,
  build,
  cues = [],
  place = () => ({ s: 0.92, x: 540, y: 1960 }),
  res = 270,
  sounds,
}: {
  avatar: Avatar
  /** Builds the world once; its `update(t)` runs every frame, after the host is posed. */
  build: (E: Engine, host: null | { root: THREE.Object3D }) => PixelEpisode
  cues?: Cue[]
  /** A 2D avatar's place at t: its waist at (x, y) on screen, scaled by s. */
  place?: (t: number) => { s: number; x: number; y: number }
  res?: 180 | 270 | 360 | 540
  /** The gestures' sounds: on by default; false for none, or your own per gesture. */
  sounds?: false | GestureSounds
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const withHost = useCallback(
    (E: Engine): PixelEpisode => {
      const host = avatar.style === '3d' ? avatar.build(THREE) : null
      if (host) E.scene.add(host.root)
      const episode = build(E, host ? { root: host.root } : null)
      return {
        update: (now: number) => {
          host?.pose(hostPose(now, cues))
          episode.update(now)
        },
      }
    },
    [avatar, build, cues],
  )
  return (
    <>
      {sounds !== false && <GestureSoundTrack cues={cues} sounds={sounds} />}
      <PixelStage build={withHost} res={res}>
        {avatar.style !== '3d' && (
          <PixelSprite block={1080 / res} id="pixel-host">
            {placeAvatar2D(avatar, hostPose(t, cues), place(t))}
          </PixelSprite>
        )}
      </PixelStage>
    </>
  )
}

/**
 * SVG markup for the 1080×1920 screen, cut to a pixel grid of `block` screen pixels: each block
 * takes the colour at its centre, and colours are stepped, so a drawing reads as pixel art next
 * to the pixel stage. Use it for anything drawn in SVG that should look pixelated.
 */
export function PixelSprite({
  block,
  children,
  id,
}: {
  block: number
  /** SVG markup in screen units. */
  children: string
  /** The filter's id: unique per sprite on screen. */
  id: string
}) {
  const filter = pixelFilter(id, block, { height: 1920, width: 1080 })
  return (
    <svg
      dangerouslySetInnerHTML={{
        __html: `<defs>${filter}</defs><g filter="url(#${id})">${children}</g>`,
      }}
      height={1920}
      style={{ left: 0, position: 'absolute', top: 0 }}
      viewBox="0 0 1080 1920"
      width={1080}
    />
  )
}
