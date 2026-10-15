import { useMemo } from 'react'

import { getPubSub } from '../render-engine-sdk/pub-sub'

// Thin React wrapper over the SDK-level pubSub bus (render-engine-sdk/pub-sub).
// getPubSub returns a stable singleton, so this just memoizes it for hook consumers.
export const usePubSub = () => {
  const pubSub = getPubSub()
  return useMemo(() => pubSub, [pubSub])
}
