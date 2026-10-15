'use client'

import { getPublicCdnUrl } from '@/util/cdn-utils'

import RiveCanvas from './RiveCanvas'

// The AI icon Rive animation -- the house signal for "something is being
// generated". Already the project card's generating state and the music panel's
// generating state; this component is the shared home for it, so a new surface
// does not have to re-derive the asset path and state machine name.
const AI_ICON_RIVE_SRC = 'agent/rive/ai_icon.riv'
const AI_ICON_STATE_MACHINE = 'State Machine'

export type AiGeneratingIconProps = {
  /**
   * Play the animation. False renders the artboard's first frame -- a static
   * AI icon -- for surfaces that show the state without animating it
   * (disconnected, tests, a reduced-motion caller).
   */
  animate?: boolean
  /** Sizing / tint. Callers pass `brightness-0 invert` for a white icon. */
  className?: string
}

export function AiGeneratingIcon({ animate = true, className }: AiGeneratingIconProps) {
  return (
    <RiveCanvas
      autoplay={animate}
      className={className}
      showLoadingSkeleton={false}
      src={getPublicCdnUrl(AI_ICON_RIVE_SRC)}
      stateMachines={AI_ICON_STATE_MACHINE}
    />
  )
}
