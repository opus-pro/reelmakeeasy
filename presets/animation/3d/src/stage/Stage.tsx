import { loadFont } from '@remotion/google-fonts/Inter'
import { useLayoutEffect, useRef } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { createEngine3D, type Engine3D } from './engine'

const { fontFamily } = loadFont('normal', { subsets: ['latin'], weights: ['700'] })

/** A 3D episode: built once, then `update(t)` sets everything from t alone (seconds). */
export type Stage3DEpisode = { update: (t: number) => void }

/**
 * The 3D look's stage: a full-resolution three.js scene under soft studio light with a label layer
 * on top. `build(E)` runs once; its `update(t)` runs on every frame. Put `<Captions />` after it.
 */
export function Stage3D({
  background,
  build,
}: {
  background?: string
  build: (E: Engine3D, font: string) => Stage3DEpisode
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const gl = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const made = useRef<{ E: Engine3D; ep: Stage3DEpisode } | null>(null)
  useLayoutEffect(() => {
    if (!made.current && gl.current && overlay.current) {
      const E = createEngine3D({ background, gl: gl.current, overlay: overlay.current })
      made.current = { E, ep: build(E, fontFamily) }
    }
    if (!made.current) return
    const { E, ep } = made.current
    E.labels.clearRect(0, 0, 1080, 1920)
    ep.update(frame / fps)
    E.render()
  }, [background, build, fps, frame])
  return (
    <AbsoluteFill>
      <canvas height={1920} ref={gl} style={{ left: 0, position: 'absolute', top: 0 }} width={1080} />
      <canvas height={1920} ref={overlay} style={{ left: 0, position: 'absolute', top: 0 }} width={1080} />
    </AbsoluteFill>
  )
}
