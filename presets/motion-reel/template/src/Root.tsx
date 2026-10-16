import { Composition } from 'remotion'

import { grid } from './grid'
import { Reel } from './Reel'

/** The reel's one composition. Its size, frame rate and length come from `public/reel.json`
 *  (written by ReelMakeEasy from the setup card and the music's beat grid): don't hard-code them. */
export const RemotionRoot = () => (
  <Composition
    component={Reel}
    durationInFrames={grid.durationInFrames}
    fps={grid.fps}
    height={grid.height}
    id="Reel"
    width={grid.width}
  />
)
