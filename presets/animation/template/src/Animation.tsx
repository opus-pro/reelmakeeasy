import { AbsoluteFill, useCurrentFrame } from 'remotion'

import { spec } from './clock'
import { Captions, Music, usePopAt, Voice } from './kit'

/**
 * The animation. ReelMakeEasy's starter, so a render works before anything else is built: a
 * drifting ground, the subject popping in, the voice with captions and the music under it.
 * Replace it with the planned scenes (one component per scene in `src/scenes/`).
 */
export function Animation() {
  const drift = (useCurrentFrame() / spec.fps) * 0.4
  const pop = usePopAt(0)
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', backgroundColor: '#14121c', justifyContent: 'center' }}
    >
      <Voice />
      <Music />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${50 + 18 * Math.sin(drift)}% ${40 + 10 * Math.cos(drift)}%, #3a3352 0%, #14121c 65%)`,
        }}
      />
      <div
        style={{
          color: '#f6f2ea',
          fontFamily: 'Inter, Helvetica, Arial, sans-serif',
          fontSize: spec.width / 12,
          fontWeight: 800,
          padding: spec.width * 0.08,
          textAlign: 'center',
          transform: `scale(${0.6 + 0.4 * pop})`,
        }}
      >
        {spec.subject ?? 'Did you know?'}
      </div>
      <Captions />
    </AbsoluteFill>
  )
}
