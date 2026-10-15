import { ArrowDown, ArrowUp, CornerDownLeft, LoaderCircle, Square } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '../lib/utils'
import { Button } from '../primitives'

import { AttachButton } from './AttachButton'
import { type AttachmentChip, AttachmentChips } from './AttachmentChips'

export type { AttachmentChip }

export function Composer({
  attachments,
  disabled = false,
  hint = 'Ask the agent to help you with anything',
  placeholder = 'Send messages to ReelMakeEasy...',
  value,
  onChange,
  onAttachment,
  onRemoveAttachment,
  onSubmit,
  isSending,
  isRunning,
  interrupting,
  onInterrupt,
  movePrefixBelowWhenFilled = false,
  prefix,
  surfaceClassName,
}: {
  attachments?: AttachmentChip[]
  disabled?: boolean
  hint?: ReactNode
  // When the agent is running, a Stop control appears alongside Send. Send stays enabled - the
  // runtime absorbs a message sent mid-turn, so the user can steer without aborting the turn first.
  interrupting?: boolean
  isRunning?: boolean
  isSending?: boolean
  /** Move the prefix and controls below the input once it contains text. */
  movePrefixBelowWhenFilled?: boolean
  onAttachment?: (files: File[]) => void
  onChange?: (v: string) => void
  onInterrupt?: () => void
  onRemoveAttachment?: (id: string) => void
  onSubmit?: () => void
  placeholder?: string
  /** Optional inline context shown between the attachment control and message input. */
  prefix?: ReactNode
  /** Optional styling for the rounded input surface, excluding attachments and the hint below. */
  surfaceClassName?: string
  value?: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [expanded, setExpanded] = useState(false)
  // Block send until every attachment is settled and uploaded: an `uploading` chip would be dropped
  // (its upload hasn't finished) and an `error` chip would be silently omitted. Both have a visible
  // remove button, so the user can always clear a stuck chip to send. Owning this here keeps
  // attachment-readiness with the component that renders the chips, rather than split across callers.
  const attachmentsBusy = (attachments ?? []).some(
    (a) => a.status === 'uploading' || a.status === 'error',
  )
  const canSend = (value ?? '').trim().length > 0 && !isSending && !attachmentsBusy && !disabled
  // Stop fires a REAL interrupt on the live session; a disabled composer (read-only viewer,
  // time travel scrubbed into the past) must not offer it.
  const showStop = Boolean(isRunning && onInterrupt && !disabled)
  // don't stack a greyed-out Send next to Stop. While Stop shows, render Send only once
  // it's actually pressable -- so running + empty is Stop-only, while running + typing keeps the
  // enabled Send so the user can steer mid-turn (the runtime absorbs a message sent then).
  const showSend = canSend || !showStop
  const stackControls = Boolean(movePrefixBelowWhenFilled && prefix && value)
  const inlinePrefixGap = Boolean(movePrefixBelowWhenFilled && prefix && !value)
  const hideEmptyMobileControls = Boolean(movePrefixBelowWhenFilled && prefix && !value)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }

    const resize = () => {
      el.style.height = 'auto'
      const nextHeight = el.scrollHeight
      el.style.height = `${nextHeight}px`
      const style = window.getComputedStyle(el)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const verticalPadding =
        Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      const isMultiline =
        Number.isFinite(lineHeight) && Number.isFinite(verticalPadding)
          ? nextHeight - verticalPadding > lineHeight * 1.5
          : nextHeight > 44
      setExpanded(isMultiline)

      // A wrapped placeholder can make the browser preserve a stale internal scroll offset while
      // the textarea catches up to its new width, clipping the first line even though it is empty.
      if (!value) {
        el.scrollTop = 0
      }
    }

    resize()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    // Prefixes and responsive controls can narrow the textarea without changing its value. Observe
    // its width so the auto-height follows newly wrapped placeholder/value lines as well as typing.
    let measuredWidth = -1
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? el.clientWidth
      if (width === measuredWidth) {
        return
      }
      measuredWidth = width
      resize()
    })
    observer.observe(el)

    return () => observer.disconnect()
  }, [placeholder, value])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) {
        onSubmit?.()
      }
    }
  }

  return (
    <div className="relative flex flex-col gap-2">
      <AttachmentChips attachments={attachments ?? []} onRemove={onRemoveAttachment} />
      <div
        className={cn(
          'flex bg-menu px-3 py-2 rounded-3xl',
          expanded ? 'items-end' : 'items-center',
          stackControls && 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-y-2 p-1.5',
          hideEmptyMobileControls && 'max-sm:px-[5px]',
          surfaceClassName,
        )}
      >
        {/* Attaching uploads to the LIVE session, so a disabled composer must not offer it. */}
        {onAttachment && (
          <div
            className={cn('flex shrink-0 items-center', stackControls && 'col-start-1 row-start-2')}
          >
            <AttachButton disabled={disabled} onAttachment={onAttachment} />
          </div>
        )}
        {prefix && (
          <div
            className={cn(
              'flex shrink-0 items-center',
              stackControls && 'col-start-2 row-start-2 justify-self-start',
            )}
          >
            {prefix}
          </div>
        )}
        <textarea
          className={cn(
            'flex-1 resize-none overflow-y-auto scrollbar-hide border-0 bg-transparent text-sm text-foreground placeholder:text-tertiary outline-none focus:ring-0 leading-5 disabled:cursor-not-allowed disabled:opacity-50 max-sm:text-base max-sm:leading-[26px] max-sm:tracking-[-0.12px]',
            stackControls && 'col-span-3 row-start-1 w-full px-2 py-1',
            inlinePrefixGap && 'ml-1.5',
            hideEmptyMobileControls && 'whitespace-nowrap max-sm:p-0',
          )}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          rows={1}
          style={{ maxHeight: '10rem' }}
          value={value ?? ''}
        />
        <div
          className={cn(
            'flex shrink-0 items-center gap-2',
            stackControls && 'col-start-3 row-start-2',
            hideEmptyMobileControls && 'max-sm:hidden',
          )}
        >
          {showStop && (
            <Button
              aria-label="Stop agent"
              disabled={interrupting}
              onClick={onInterrupt}
              size="sm"
              type="button"
              variant="ghost"
            >
              {interrupting ? (
                'Stopping…'
              ) : (
                <>
                  <Square className="mr-1 size-3" fill="currentColor" />
                  Stop
                </>
              )}
            </Button>
          )}
          {showSend && (
            <Button
              aria-label="Send"
              className="rounded-full"
              disabled={!canSend}
              onClick={onSubmit}
              size="icon"
              type="button"
              variant="primary"
            >
              {isSending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="text-center text-xs text-secondary">{hint}</p>}
    </div>
  )
}

// Composer's tips row when a keyboard-navigable option list (OptionList) is the active input
// surface, matching the Figma "tips" variant for that state. Pass as the `hint` prop.
export function ComposerOptionsHint() {
  return (
    <span className="flex items-center justify-center gap-1">
      <ArrowUp className="size-3.5" />
      <ArrowDown className="size-3.5" />
      <span>to navigate</span>
      <span className="text-tertiary">&middot;</span>
      <CornerDownLeft className="size-3.5" />
      <span>Enter to select</span>
      <span className="text-tertiary">&middot;</span>
      <span>or type below</span>
    </span>
  )
}
