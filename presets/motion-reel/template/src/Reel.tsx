import { AbsoluteFill } from 'remotion'

import { bar, grid } from './grid'
import { Music, Sfx, useOvershoot } from './kit'

/**
 * The reel. ReelMakeEasy's starter: one title on the first bar, so a render works before anything
 * else is built. Replace it with the planned scenes.
 */
export function Reel() {
  const pop = useOvershoot(bar(0))
  return (
    <AbsoluteFill style={{ alignItems: 'center', backgroundColor: '#0b0b0d', justifyContent: 'center' }}>
      <Music />
      <Sfx at={bar(0)} name="hit" />
      <div
        style={{
          color: '#f4f1ea',
          fontFamily: 'Inter, Helvetica, Arial, sans-serif',
          fontSize: grid.width / 14,
          fontWeight: 800,
          transform: `scale(${0.6 + 0.4 * pop})`,
        }}
      >
        {grid.subject}
      </div>
    </AbsoluteFill>
  )
}
