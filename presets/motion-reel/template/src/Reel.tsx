import { AbsoluteFill } from 'remotion'

import { bar, bars, grid, kicks, melody } from './grid'
import { Music, Sfx, useOvershootAt, usePulse, useReelFrame } from './kit'

/**
 * The reel. ReelMakeEasy's starter, so a render works before anything else is built: the ground
 * drifts all the time and breathes on every kick, and the title pops on the first accented melody
 * note (or the first bar). Replace it with the planned scenes.
 */
export function Reel() {
  const pulse = usePulse(kicks())
  const titleAt = melody(0.8)[0] ?? bar(0)
  const pop = useOvershootAt(titleAt)
  // A constant drift, so the ground moves between kicks too (kicks can be bars apart).
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
          opacity: 0.6 + 0.4 * pulse,
          transform: `scale(${1 + 0.02 * pulse})`,
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
