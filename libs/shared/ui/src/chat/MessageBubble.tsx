import type { ReactNode } from 'react'

import { cn } from '../lib/utils'

export type MessageBubbleTone = 'neutral' | 'warm'

// warm: a bespoke warm-brown (not a design-system token). neutral: Story Mode's
// translucent-white surface. Exported so a bubble with its own layout (the planner timeline's
// MessageBlockItem) shares these surfaces instead of restating the hex.
export const MESSAGE_BUBBLE_TONE_CLASS: Record<MessageBubbleTone, string> = {
  warm: 'bg-[#7c6651]',
  neutral: 'bg-white/[0.08]',
}

/**
 * User messages: bubble colored by `tone`, right-aligned. Agent messages: no bubble, full-width
 * -- UNLESS `tone="neutral"` is explicitly passed (the resolved Q&A recap), in which case
 * the agent message also gets a left-aligned neutral bubble. Any other agent tone stays bare.
 */
export function MessageBubble({
  role,
  tone = 'warm',
  children,
}: {
  children: ReactNode
  role: 'agent' | 'user'
  tone?: MessageBubbleTone
}) {
  if (role === 'agent' && tone !== 'neutral') {
    return <div className="w-full">{children}</div>
  }
  return (
    <div className={cn('flex', role === 'agent' ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[480px] whitespace-pre-wrap rounded-2xl px-4 py-3 text-base text-white [overflow-wrap:anywhere]',
          MESSAGE_BUBBLE_TONE_CLASS[tone],
        )}
      >
        {children}
      </div>
    </div>
  )
}
