import type { ReactNode } from 'react'

import { MessageBubble } from './MessageBubble'

/**
 * Resolved Q&A recap bubble: a neutral agent
 * bubble showing the asked question and, once known, the committed answer.
 */
export function QaRecap({ answer, question }: { answer?: ReactNode; question: string }) {
  return (
    <MessageBubble role="agent" tone="neutral">
      <p className="whitespace-pre-wrap break-words text-base font-normal leading-6.5 tracking-[-0.12px] text-secondary [overflow-wrap:anywhere]">
        Q: {question}
      </p>
      {answer != null && (
        <p className="whitespace-pre-wrap break-words text-base font-normal leading-6.5 tracking-[-0.12px] text-primary [overflow-wrap:anywhere]">
          A: {answer}
        </p>
      )}
    </MessageBubble>
  )
}
