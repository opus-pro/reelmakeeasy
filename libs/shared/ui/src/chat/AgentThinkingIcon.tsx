import { useRive } from '@rive-app/react-canvas'
import { useState } from 'react'

import { cn } from '../lib/utils'

// Bundled static asset (not a CDN fetch): the accent-orange agent sparkle. Derived from the
// story-mode `ai_icon` Rive mark, recolored to the accent-orange token. Resolved to a URL by the
// bundler (.riv rule in next.config + Storybook viteFinal assetsInclude).
import aiIconOrangeUrl from './assets/ai_icon_orange.riv'

/**
 * The animated agent-thinking mark: the orange Rive sparkle, replacing the static `Ai` sparkle in
 * {@link AgentStatusLine}. Fades in on load rather than showing a placeholder, so no plain-pulse
 * skeleton appears while the animation initializes.
 */
export function AgentThinkingIcon({ className }: { className?: string }) {
  const [isLoaded, setIsLoaded] = useState(false)
  // No onLoadError fallback by design: if the .riv fails to load we render nothing (stays
  // opacity-0) rather than a frozen static mark. The status text still conveys the state.
  const { RiveComponent } = useRive({
    autoplay: true,
    onLoad: () => setIsLoaded(true),
    src: aiIconOrangeUrl,
    stateMachines: 'State Machine',
  })
  return (
    <div aria-hidden className={cn('shrink-0', className)}>
      <div className={cn('size-full transition-opacity', isLoaded ? 'opacity-100' : 'opacity-0')}>
        <RiveComponent />
      </div>
    </div>
  )
}
