'use client'

import { Button, cn } from '@shared/ui'
import React from 'react'

import { ArrowUp, Loading, StopFilled } from '@/components/icons/core'

export type ChatBoxSubmitButtonProps = SubmitButtonContext & {
  className?: string
  iconClassName?: string
  loadingClassName?: string
}

export interface SubmitButtonContext {
  /** Accessible name. Defaults to the resolved mode, so Stop announces its pending state. */
  ariaLabel?: string
  /**
   * Whether pressing the button does anything. Overrides the derivation from
   * `disabled` / `isSending`, for callers that already resolved it themselves.
   */
  canPress?: boolean
  /** `data-dd-action` for the button, so each surface reports under its own RUM action. */
  dataDdAction?: string
  /** `data-testid` for the rendered button, so each surface can be addressed separately. */
  dataTestId?: string
  /** Whether the send button should be disabled. Ignored when `canPress` is given. */
  disabled?: boolean
  /** Paints the accent-orange auto-mode skin instead of the neutral white. */
  isAutoMode?: boolean
  /** Whether the prompt has valid content */
  isPromptValid?: boolean
  /** Whether a send operation is in progress */
  isSending?: boolean
  /** Whether streaming is in progress */
  isStreaming?: boolean
  /** Whether the chat box is in mini/compact mode */
  mini?: boolean
  /** Overrides the send/stop derivation, for callers holding a resolved mode. */
  mode?: 'send' | 'stop'
  /** Handler to abort streaming (if available) */
  onAbort?: () => void
  /** Handler to trigger send */
  onSend: () => void
}

const ChatBoxSubmitButtonComponent: React.FC<ChatBoxSubmitButtonProps> = ({
  ariaLabel,
  canPress,
  dataDdAction = 'omnibox-submit-prompt-button',
  dataTestId,
  isSending = false,
  disabled = false,
  isAutoMode = false,
  onSend,
  onAbort,
  mini = false,
  mode,
  isStreaming = false,
  isPromptValid = false,
  className,
  iconClassName,
  loadingClassName,
}) => {
  const resolvedMode = mode ?? (isStreaming && !isPromptValid && onAbort ? 'stop' : 'send')
  const isStop = resolvedMode === 'stop'
  // Stop with no `onAbort` has nothing to click, so it stays disabled however the caller
  // resolved `canPress` -- an enabled button whose handler is undefined reads as available
  // and does nothing. Otherwise Stop is pressable on sight: the omnibox only offers it while
  // streaming, so there is nothing further to gate it on.
  const hasAction = isStop ? Boolean(onAbort) : true
  const pressable = hasAction && (canPress ?? (isStop ? true : !(disabled || isSending)))

  return (
    <Button
      // Naming the in-flight state matters: the button is disabled while sending, so a bare
      // "Send" would read as an available action that silently does nothing.
      aria-label={ariaLabel ?? (isStop ? 'Stop generating' : isSending ? 'Sending' : 'Send')}
      className={cn(
        'cursor-pointer rounded-full size-[38px] min-w-[38px] p-0 transition',
        // Auto mode owns the accent: the agent can proceed without the user. Idle
        // holds the accent and dims via element opacity, not a lower text alpha, so the glyph
        // fades with the fill. Both dim states carry the `disabled:` modifier because Button
        // ships its own `disabled:opacity-50`, which only a same-modifier class dedupes against.
        pressable && isAutoMode && 'bg-accent-orange text-white hover:bg-accent-orange/90',
        pressable && !isAutoMode && 'bg-white text-black hover:bg-white/90',
        !pressable && isAutoMode && 'bg-accent-orange text-white disabled:opacity-30',
        !pressable && !isAutoMode && 'bg-white/10 text-white/60 disabled:opacity-60',
        mini && 'p-1.5 size-7 min-w-7',
        className,
      )}
      data-dd-action={dataDdAction}
      data-mode={resolvedMode}
      // Anchor for onboarding surfaces that point at the composer (the rewards
      // first-video CTA draws attention here). On the button itself
      // rather than a call site so it survives the v1/v2 split and every layout
      // branch - /home renders v1 today, and an anchor on v1 alone would die
      // silently on migration.
      data-onboarding-target="chat-box-submit"
      data-testid={dataTestId}
      disabled={!pressable}
      onClick={isStop ? onAbort : onSend}
      // Button documents `type` as defaulting to "button" but renders no attribute, so the
      // HTML default of "submit" applies -- inside a form that would navigate on click.
      type="button"
    >
      {isStop ? (
        <StopFilled className={cn('size-4 fill-current', iconClassName)} />
      ) : isSending ? (
        <Loading className={cn('size-5 animate-spin', mini && 'size-4', loadingClassName)} />
      ) : (
        <ArrowUp className={cn('size-4.5', mini && 'size-4', iconClassName)} />
      )}
    </Button>
  )
}

export const ChatBoxSubmitButton = React.memo(ChatBoxSubmitButtonComponent)
