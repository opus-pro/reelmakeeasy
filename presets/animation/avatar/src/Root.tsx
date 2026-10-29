import { Composition } from 'remotion'

import { Animation } from './Animation'
import { durationInFrames, spec } from './clock'
import { AvatarPreview, AvatarSheet } from './host/Sheet'

/** The animation's composition (its size, frame rate and length come from
 *  `public/animation.json`: don't hard-code them), and the avatar's check sheet and preview tile,
 *  which ReelMakeEasy renders for avatar_check and avatar_save. */
export const RemotionRoot = () => (
  <>
    <Composition
      component={Animation}
      durationInFrames={durationInFrames}
      fps={spec.fps}
      height={spec.height}
      id="Animation"
      width={spec.width}
    />
    <Composition
      component={AvatarSheet}
      durationInFrames={1}
      fps={spec.fps}
      height={1920}
      id="AvatarSheet"
      width={1920}
    />
    <Composition
      component={AvatarPreview}
      durationInFrames={1}
      fps={spec.fps}
      height={600}
      id="AvatarPreview"
      width={600}
    />
  </>
)
