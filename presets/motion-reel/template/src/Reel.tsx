import { AbsoluteFill } from 'remotion'

import { bar, bars, grid, melody } from './grid'
import { Music, Sfx, useOvershootAt, useReelFrame } from './kit'

/**
 * The reel. ReelMakeEasy's starter, so a render works before anything else is built: the ground
 * drifts all the time and the title pops on the first accented melody note (or the first bar).
 * Replace it with the planned scenes.
 */
export function Reel() {
  const titleAt = melody(0.8)[0] ?? bar(0)
  const pop = useOvershootAt(titleAt)
  // A constant drift, so the ground is never still.
  const drift = (useReelFrame() / bars(1)) * 2 * Math.PI
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', backgroundColor: '#0b0b0d', justifyContent: 'center' }}
    >
      <Music />
      <Sfx at={titleAt} name="hit" />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${50 + 15 * Math.sin(drift)}% ${50 + 10 * Math.cos(drift)}%, #2a2a33 0%, #0b0b0d 60%)`,
          opacity: 0.8,
        }}
      />
      <div
        style={{
          color: '#f4f1ea',
          fontFamily: 'Inter, Helvetica, Arial, sans-serif',
          fontSize: grid.width / 14,
          fontWeight: 800,
          opacity: Math.min(1, 2 * pop),
          transform: `scale(${0.6 + 0.4 * pop})`,
        }}
      >
        {grid.subject}
      </div>
    </AbsoluteFill>
  )
}
