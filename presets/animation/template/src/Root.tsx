import { Composition } from 'remotion'

import { Animation } from './Animation'
import { durationInFrames, spec } from './clock'

/** The animation's one composition. Its size, frame rate and length come from
 *  `public/animation.json` (written by ReelMakeEasy from the setup): don't hard-code them. */
export const RemotionRoot = () => (
  <Composition
    component={Animation}
    durationInFrames={durationInFrames}
    fps={spec.fps}
    height={spec.height}
    id="Animation"
    width={spec.width}
  />
)
