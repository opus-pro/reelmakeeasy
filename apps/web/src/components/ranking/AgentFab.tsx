'use client'

import type { RankingProject } from '@shared/types/api/ranking'
import { cn } from '@shared/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { agentChatUrl } from '@/components/agent/start-easy'
import { Sparkle } from '@/components/icons/core'

import type { RankingApi } from './ranking-api'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What to ask for, one click away (a click fills the box; it doesn't send). */
const SUGGESTIONS = [
  'Add a 💀 when he falls on #2',
  'Make the labels funnier',
  'Add a boom on every fall',
  'Change the slide before #1 to “And the winner…”',
]

/**
 * "Edit with agent": a round button with the agent's star that floats beside the preview
 * (`float`; hovering slides its label open, so it says what it does before a click) or sits in
 * the header with its label (`inline`, where floating would cover the short). It opens a box
 * for what to change; sending opens a Ranking chat on this ranking with it as the first
 * message, and the agent makes the change there.
 */
export function AgentFab({
  api,
  onOpenChange,
  onText,
  open,
  project,
  text,
  variant,
}: {
  api: RankingApi
  onOpenChange: (open: boolean) => void
  onText: (text: string) => void
  open: boolean
  project: RankingProject
  text: string
  variant: 'float' | 'inline'
}) {
  const inline = variant === 'inline'
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return undefined
    input.current?.focus()
    // A click outside, or Escape, closes it.
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // Escape that cancels an input method's conversion isn't "close".
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) onOpenChange(false)
    }
    // Capture: a press that something else stops (dragging a sticker) still closes it.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onOpenChange, open])

  const send = () => {
    if (sending) return
    setSending(true)
    setError(null)
    api
      .openChat(project.id, project.name, text)
      .then((sessionId) => router.push(agentChatUrl(sessionId)))
      .catch((e: unknown) => {
        setError(errorText(e))
        setSending(false)
      })
  }

  return (
    <div
      className={cn(
        'z-30 flex flex-col gap-2',
        // Inline, its box hangs from the header (which holds it), not from the button.
        inline ? 'items-end' : 'absolute top-4 left-4 items-start',
      )}
      ref={box}
    >
      <button
        aria-expanded={open}
        aria-label="Edit with agent"
        className={cn(
          'group flex items-center overflow-hidden rounded-full bg-[#20231a] text-primary ring-[1.5px] ring-accent-green/60 transition-shadow ring-inset hover:ring-accent-green focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:outline-none',
          inline
            ? 'h-8 gap-1.5 pr-3 pl-2.5 max-sm:px-2'
            : 'h-12 shadow-[0_0_0_4px_rgba(190,247,55,0.08),0_8px_24px_rgba(0,0,0,0.45)]',
          open && 'ring-accent-green/80',
        )}
        onClick={() => onOpenChange(!open)}
        title="Edit with agent (/)"
        type="button"
      >
        <span
          className={cn('flex shrink-0 items-center justify-center', inline ? 'size-4' : 'size-12')}
        >
          <Sparkle className={cn('text-accent-green', inline ? 'size-4' : 'size-5')} />
        </span>
        <span
          className={cn(
            'font-semibold whitespace-nowrap',
            inline
              ? 'text-[13px] max-sm:sr-only'
              : // Folded away until hovered or focused (or open): it slides out of the circle.
                cn(
                  '-ml-1 max-w-0 text-sm opacity-0 transition-[max-width,opacity,padding] duration-200 ease-out',
                  'group-hover:max-w-40 group-hover:pr-4 group-hover:opacity-100',
                  'group-focus-visible:max-w-40 group-focus-visible:pr-4 group-focus-visible:opacity-100',
                  open && 'max-w-40 pr-4 opacity-100',
                ),
          )}
        >
          Edit with agent
        </span>
      </button>
      {open && (
        <form
          className={cn(
            'flex w-[min(360px,calc(100vw-32px))] flex-col gap-2.5 rounded-lg bg-[#262626] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.12]',
            inline && 'absolute top-full right-4 left-4 mt-2 w-auto sm:left-auto sm:w-[360px]',
          )}
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <p className="text-[13px] font-semibold text-primary">What should the agent change?</p>
          <textarea
            aria-label="What should the agent change?"
            className="min-h-[72px] resize-none rounded-xs border-0 bg-black/30 px-2.5 py-2 text-[13px] text-primary placeholder:text-white/40 focus:ring-1 focus:ring-white/30 focus:outline-none"
            disabled={sending}
            maxLength={2000}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter starts a new line; Enter that picks an input method's
              // candidate does neither (229: how Safari says so).
              if (e.key !== 'Enter' || e.shiftKey) return
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              send()
            }}
            placeholder="e.g. add a boom when the dog falls on #2"
            ref={input}
            value={text}
          />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                className="rounded-full px-2.5 py-1 text-left text-xs text-secondary ring-1 ring-white/[0.12] ring-inset hover:text-primary hover:ring-white/30"
                key={suggestion}
                onClick={() => {
                  onText(suggestion)
                  input.current?.focus()
                }}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 text-[11px]',
                error ? 'text-amber-400' : 'text-white/40',
              )}
            >
              {error ?? 'Opens the chat on this ranking; the agent does the rest.'}
            </span>
            <button
              className="flex h-8 shrink-0 items-center rounded-xs bg-white px-3 text-[13px] font-medium text-[#111] hover:bg-white/85 disabled:opacity-50"
              disabled={sending}
              type="submit"
            >
              {sending ? 'Opening…' : text.trim() ? 'Send' : 'Open chat'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
