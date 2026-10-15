'use client'

import { cn, Popover } from '@shared/ui'
import { useState } from 'react'

import { useProjectAspectRatio } from '@/components/agent/useAgentProject'
import { useIsMobile } from '@/util/browserUtils'

import { CaptionSettingsPanel } from './CaptionSettingsPanel'
import { useCaptionStatus } from './useCaptionSettings'

export type CaptionStyleButtonProps = {
  /** The preview's aspect ratio; unset, the project's own. */
  aspectRatio?: null | string
  captionsOn: boolean
  /** For the link, e.g. a smaller text size to match the links around it. */
  className?: string
  disabled: boolean
  /** The player shows each change at once (the editor engine), not only after a render. */
  livePreview: boolean
  /** One more line for a loop whose preview has no fact stamps yet. */
  loopNote?: string
  projectId: string
}

/**
 * "Style" beside a Captions switch: the caption look's controls in a popover, the same in
 * the agent chat and in the editor. A live preview shows each change at once; a file player
 * only after the next render. With captions off it holds a loop's highlight, which still
 * colours the fact stamps, and shows nothing for any other video.
 */
export function CaptionStyleButton({
  aspectRatio,
  captionsOn,
  className,
  disabled,
  livePreview,
  loopNote,
  projectId,
}: CaptionStyleButtonProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const projectAspectRatio = useProjectAspectRatio(projectId)
  const isLoop = useCaptionStatus(projectId).status?.kind === 'loop'
  if (!captionsOn && !isLoop) return null
  return (
    <Popover
      align="start"
      className="z-[100] w-80 rounded-2xl border-0 bg-menu-background p-4 text-primary shadow-none backdrop-blur-2xl"
      content={
        <CaptionSettingsPanel
          aspectRatio={aspectRatio ?? projectAspectRatio}
          captionsOn={captionsOn}
          disabled={disabled}
          loopNote={loopNote}
          note={livePreview ? undefined : 'Shows after the video renders again'}
          projectId={projectId}
        />
      }
      modal={isMobile}
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      sideOffset={4}
    >
      <button
        className={cn(
          'w-fit text-sm text-primary underline underline-offset-2 hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        disabled={disabled}
        type="button"
      >
        Style
      </button>
    </Popover>
  )
}
