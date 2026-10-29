import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { createEngine as create } from './px'

// px.ts is plain JS (unchecked): its options are typed here.
const createEngine = create as (o: {
  gl: HTMLCanvasElement | null
  hud: HTMLCanvasElement | null
  res: number
}) => Engine

/** What `createEngine` gives an episode: the three.js scene and camera, the post settings, the
 *  HUD, the x-ray lens, `toScreen` and `sync`. See index.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Engine = any

/** An episode: built once, then `update(t)` sets everything from t alone (seconds) every frame. */
export type PixelEpisode = { update: (t: number) => void }

/**
 * The 8-bit look's stage: a three.js scene drawn into a 270×480 target (`res` 180, 360 or 540 for
 * a coarser or finer grid), a post pass (blocky glow, flash, vignette, ordered dithering), scaled
 * up to 1080 wide (4× at 270) with hard pixel edges, and a 1080×1920 pixel-font HUD on top.
 * `build(E)` runs once; its `update(t)` runs on every frame.
 */
export function PixelStage({
  build,
  children,
  res = 270,
}: {
  build: (E: Engine) => PixelEpisode
  /** Drawn over the scene and under the HUD (an Avatar explainer's 2D host). */
  children?: ReactNode
  res?: 180 | 270 | 360 | 540
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const gl = useRef<HTMLCanvasElement>(null)
  const hud = useRef<HTMLCanvasElement>(null)
  const made = useRef<{ E: Engine; ep: PixelEpisode } | null>(null)
  useLayoutEffect(() => {
    if (!made.current) {
      const E = createEngine({ gl: gl.current, hud: hud.current, res })
      made.current = { E, ep: build(E) }
    }
    const { E, ep } = made.current
    E.hud.clear()
    ep.update(frame / fps)
    E.render()
  }, [build, fps, frame, res])
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <canvas
        ref={gl}
        style={{
          height: 1920,
          imageRendering: 'pixelated',
          left: 0,
          position: 'absolute',
          top: 0,
          width: 1080,
        }}
      />
      {children}
      <canvas
        height={1920}
        ref={hud}
        style={{ left: 0, position: 'absolute', top: 0 }}
        width={1080}
      />
    </AbsoluteFill>
  )
}
