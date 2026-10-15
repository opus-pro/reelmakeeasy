'use client'

import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { Button, cn } from '@shared/ui'
import { useCallback, useRef, useState } from 'react'

import { BackdropDialog } from '@/components/omni-chat-box-v2/shared/BackdropDialog'
import { ChooseStylePopup } from '@/components/omni-chat-box-v2/style/ChooseStylePopup'
import {
  type StoryModeStyleOption,
  useStoryModeStyleOptionsState,
} from '@/hooks/useStoryModeConfig'

import { Spinner } from './Spinner'

export type StyleRequestCardProps = {
  entry: Extract<TranscriptEntry, { kind: 'style' }>
  /** What an expired card says (default: start a new session to try again). */
  expiredHint?: string
  onChoose: (styleId: string) => Promise<boolean>
}

/** How many style thumbnails the open card previews under its button. */
const PREVIEW_COUNT = 3

const CARD_CLASS =
  'flex w-full max-w-xl flex-col gap-3 rounded-xl border border-white/10 bg-fill-secondary/50 p-3'

/**
 * Autonomous mode's style step. Open: a button that opens the Story Mode style
 * picker (presets only), with a few thumbnails as a teaser; a pick posts the
 * style and keeps the card locked until `style_chosen` flips it. The button waits
 * for the styles to load, and a failed load offers a retry. Chosen: the
 * style's thumbnail and name. Expired (the session stopped first): muted, with
 * no way to pick.
 */
export function StyleRequestCard({
  entry,
  expiredHint = 'This step expired. Start a new session to try again.',
  onChoose,
}: StyleRequestCardProps) {
  const { isError, retry, styles: styleOptions } = useStoryModeStyleOptionsState()
  const [popupOpen, setPopupOpen] = useState(false)
  const [pending, setPending] = useState(false)
  // Mirrors `pending` synchronously, so two picks in one render can't both post.
  const inFlightRef = useRef(false)

  const open = entry.state === 'open'
  const locked = !open || pending

  const handleSelect = useCallback(
    async (style: StoryModeStyleOption) => {
      setPopupOpen(false)
      if (!open || inFlightRef.current) return
      inFlightRef.current = true
      setPending(true)
      const ok = await onChoose(style.id)
      // On success stay locked until `style_chosen` arrives.
      if (!ok) {
        inFlightRef.current = false
        setPending(false)
      }
    },
    [onChoose, open],
  )

  if (entry.state === 'chosen') {
    return (
      <div className={CARD_CLASS}>
        <div className="flex items-center gap-3">
          {entry.thumbnailUrl && (
            <img
              alt=""
              className="size-14 shrink-0 rounded-md object-cover"
              src={entry.thumbnailUrl}
            />
          )}
          <span className="min-w-0 flex-1 text-sm break-words text-primary">
            Style: {entry.styleName ?? entry.styleId}
          </span>
          <span className="text-sm text-accent-green">✓</span>
        </div>
      </div>
    )
  }

  if (entry.state === 'expired') {
    return (
      <div className={cn(CARD_CLASS, 'opacity-60')}>
        <p className="text-sm font-semibold text-primary">Pick a style</p>
        <p className="text-xs text-secondary">{expiredHint}</p>
      </div>
    )
  }

  const previews = styleOptions.filter((style) => style.thumbnailUrl).slice(0, PREVIEW_COUNT)
  const loaded = styleOptions.length > 0

  return (
    <div className={CARD_CLASS}>
      <p className="text-sm font-semibold text-primary">Pick a style</p>
      <Button
        className="h-9 w-fit rounded-lg px-4"
        disabled={locked || !loaded}
        onClick={() => setPopupOpen(true)}
        type="button"
      >
        {pending && <Spinner className="mr-1.5" />}
        Choose a style
      </Button>
      {!loaded &&
        (isError ? (
          <p className="flex items-center gap-1.5 text-xs text-secondary">
            Couldn&apos;t load styles
            <button
              className="text-primary underline underline-offset-2 hover:text-secondary"
              onClick={retry}
              type="button"
            >
              Retry
            </button>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-secondary">
            <Spinner />
            Loading styles…
          </p>
        ))}
      {previews.length > 0 && (
        <div className="flex gap-2">
          {previews.map((style) => (
            <img
              alt={style.label}
              className="size-16 rounded-md object-cover"
              key={style.id}
              src={style.thumbnailUrl}
              title={style.label}
            />
          ))}
        </div>
      )}
      {popupOpen && !locked && loaded ? (
        <BackdropDialog onOpenChange={setPopupOpen} open={popupOpen} title="Choose style">
          <ChooseStylePopup
            hideAddStyle
            onClose={() => setPopupOpen(false)}
            onSelectStyle={(style) => void handleSelect(style)}
            // Nothing is picked yet: no card shows as selected.
            selectedStyleId=""
            styleOptions={styleOptions}
          />
        </BackdropDialog>
      ) : null}
    </div>
  )
}
