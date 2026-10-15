'use client'

import type { GenerationProvider } from '@shared/types/api/setup'
import { Button, Dialog } from '@shared/ui'

import { costLine } from './first-video'

const EASY_TEXT =
  'Easy finds a fun fact, a news story or a famous figure. You pick one and a style, and it makes the whole video in about 5 minutes.'
const EXAMPLE_TEXT =
  "We'll fill in an example idea for you. Change it if you like, then make your video."

export interface FirstVideoDialogProps {
  /** Codex or Claude Code is ready, so Easy can run; otherwise the dialog offers an example idea. */
  canStartEasy: boolean
  /** The video service in effect, for the cost line. */
  generation: GenerationProvider
  /** The close button, Escape or a click outside: hides it for this visit, not an answer. */
  onDismiss: () => void
  /** Not now: the answer, so it isn't asked again. */
  onNotNow: () => void
  /** Go (Easy), or Try an example. */
  onStart: () => void
  open: boolean
  /** The chat is opening: both buttons wait, and closing does nothing. */
  starting: boolean
}

/** "Make your first video?": what Easy does, about what a video costs, Go or Not now. */
export function FirstVideoDialog({
  canStartEasy,
  generation,
  onDismiss,
  onNotNow,
  onStart,
  open,
  starting,
}: FirstVideoDialogProps) {
  const startLabel = canStartEasy ? 'Go' : 'Try an example'
  return (
    <Dialog
      classNames={{
        content:
          'backdrop-blur-2xl bg-menu/50 border-tertiary rounded-2xl p-6 max-w-[440px] max-sm:max-w-[90%]',
        description: 'text-secondary text-sm leading-[22px]',
        header: 'gap-3',
        title: 'text-primary text-lg font-semibold leading-[21.8px]',
      }}
      description={canStartEasy ? EASY_TEXT : EXAMPLE_TEXT}
      footer={
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            className="rounded-sm bg-white/10 px-2.5 hover:bg-white/20"
            disabled={starting}
            onClick={onNotNow}
            variant="secondary"
          >
            Not now
          </Button>
          <Button
            className="rounded-sm bg-white px-2.5 text-black hover:bg-white/90"
            disabled={starting}
            onClick={onStart}
          >
            {starting ? 'Opening…' : startLabel}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next && !starting) onDismiss()
      }}
      open={open}
      showClose
      title="Make your first video?"
    >
      <p className="text-xs text-secondary">{costLine(generation)}</p>
    </Dialog>
  )
}
