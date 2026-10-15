'use client'

import Dialog from '@shared/ui/dialog'
import { cn } from '@shared/ui/lib/utils'

import { Warning } from '@/components/icons/core'

interface VoiceCloneErrorDialogProps {
  dialogContentClassName?: string
  dialogOverlayClassName?: string
  onClose: () => void
  onGoBack: () => void
  open: boolean
}

/**
 * Shown when a voice-clone sample is in a language MiniMax cannot clone.
 */
export function VoiceCloneErrorDialog({
  dialogContentClassName,
  dialogOverlayClassName,
  onClose,
  onGoBack,
  open,
}: VoiceCloneErrorDialogProps) {
  return (
    <Dialog
      classNames={{
        content: cn(
          'flex flex-col w-[90%] max-w-[560px] max-h-[calc(100dvh-32px)] border-none bg-menu-background backdrop-blur-2xl backdrop-filter rounded-2xl p-6 z-[64]',
          dialogContentClassName,
        ),
        overlay: cn('z-[63]', dialogOverlayClassName),
      }}
      footer={null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose()
        }
      }}
      open={open}
      showClose={true}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="flex size-12 items-center justify-center rounded-full bg-menu-background p-2">
            {/* text-[#cf4020] is the design's Status/error color; no design token exists for it yet. */}
            <Warning className="size-6 text-[#cf4020]" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <h2 className="text-lg font-semibold leading-tight text-primary">
              This language isn&apos;t supported yet
            </h2>
            <p className="max-w-[335px] text-center text-sm text-tertiary">
              We can&apos;t clone a voice in the language we detected. Try a supported language, or
              upload your audio as a voiceover, which works in any language.
            </p>
          </div>

          <button
            className="flex h-[38px] min-w-[38px] items-center justify-center rounded-[10px] bg-white px-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
            onClick={onGoBack}
            type="button"
          >
            Go back
          </button>
        </div>
      </div>
    </Dialog>
  )
}
