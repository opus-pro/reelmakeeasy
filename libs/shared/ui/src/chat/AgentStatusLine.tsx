import { Sparkles } from 'lucide-react'

import { cn } from '../lib/utils'

import { AgentThinkingIcon } from './AgentThinkingIcon'

function formatElapsed(sec: number): string {
  if (sec < 60) {
    return `${sec}s`
  }
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

/** Inline agent-running indicator: sparkle icon + elapsed time + live status label. */
export function AgentStatusLine({
  elapsedSec = 0,
  label = 'Still thinking...',
  animated = true,
  showTimer = true,
}: {
  animated?: boolean
  elapsedSec?: number
  label?: string
  showTimer?: boolean
}) {
  return (
    <div
      className={cn(
        // items-start, not items-center: a wrapped label would otherwise pull the mark down to the
        // block's middle. The 24px icon matches the 24px line box, so the first line needs no nudge.
        'flex items-start gap-2 text-base',
        // A frozen line (e.g. "Interrupted") reads as settled: a dimmer gray across icon + text.
        animated ? 'text-secondary' : 'text-tertiary',
      )}
    >
      {/* Live runs show the animated orange Rive mark; a frozen line keeps a static sparkle so no
          blank first frame flashes from a paused Rive canvas. The frozen icon uses currentColor,
          so it shares the line's dimmer gray (no orange), reading as inactive. */}
      {animated ? (
        <AgentThinkingIcon className="size-6" />
      ) : (
        <Sparkles aria-hidden className="size-6 shrink-0" fill="currentColor" />
      )}
      <span>
        {/* Elapsed time leads, dot-separated, matching the Figma reference order. */}
        {showTimer && (
          <span className="tabular-nums">{formatElapsed(Math.max(0, elapsedSec))} · </span>
        )}
        {label}
      </span>
    </div>
  )
}
