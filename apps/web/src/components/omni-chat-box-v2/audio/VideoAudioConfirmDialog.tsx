'use client'
import { Button, cn } from '@shared/ui'
import { useEffect, useState } from 'react'

import { CrossSmall } from '@/components/icons/core'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { getVideoMetadata } from '@/util/media'
import { formatSecondsToTime } from '@/util/time-utils'

import { BackdropDialog } from '../shared/BackdropDialog'

const FF_STYLE = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

export type VideoAudioConfirmDialogProps = {
  file: File | null
  onCancel: () => void
  onConfirm: (file: File) => void
}

/**
 * Pre-upload confirmation popup shown when the user picks a video file as a
 * Story Mode voice-over source. Opens before any bytes leave the client.
 * Resolution flows back through the parent-owned `pendingVideoFile` state
 * and the promise-bridge in `OmniChatBox`.
 */
export function VideoAudioConfirmDialog({
  file,
  onCancel,
  onConfirm,
}: VideoAudioConfirmDialogProps) {
  const open = file !== null
  const limits = useStoryModeUserLimits()
  const [durationSeconds, setDurationSeconds] = useState<null | number>(null)

  useEffect(() => {
    if (!file) {
      setDurationSeconds(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await getVideoMetadata(file, { withThumbnail: false })
        if (!cancelled && result.metadata?.duration != null) {
          setDurationSeconds(result.metadata.duration)
        }
      } catch {
        // Non-decodable container. Omit the duration line.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  const handleConfirm = () => {
    if (!file) {
      return
    }
    onConfirm(file)
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleCancel()
    }
  }

  // Copy shows the marketed cap, but only flag over-limit past the real enforced
  // cap (maxAudioUploadSeconds), consistent with the upload toast.
  const isOverLimit = durationSeconds != null && durationSeconds > limits.maxAudioUploadSeconds
  // Clamp the shown duration to the marketed cap for accepted files so it never
  // reads above "N minutes max"; over-cap files keep their real (red) duration.
  const shownDurationSeconds =
    durationSeconds != null && !isOverLimit
      ? Math.min(durationSeconds, limits.audioUploadDisplayMinutes * 60)
      : durationSeconds
  const durationLine =
    shownDurationSeconds != null && Number.isFinite(shownDurationSeconds)
      ? `Duration: ${formatSecondsToTime(shownDurationSeconds)} / ${limits.audioUploadDisplayMinutes} minutes max.`
      : null

  return (
    <BackdropDialog
      contentClassName="w-[440px] max-w-[calc(100vw-32px)]"
      onOpenChange={handleOpenChange}
      open={open}
      title="Use audio from this video?"
    >
      <section className="flex size-full flex-col rounded-[24px] bg-[rgba(68,68,68,0.5)] px-4 pb-4">
        <header className="flex w-full items-center gap-4 py-4">
          <div className="flex min-h-[22px] min-w-0 flex-1 flex-col justify-center py-[3px]">
            <h2 className="text-[18px] font-semibold leading-[21.8px] text-white" style={FF_STYLE}>
              Use audio from this video?
            </h2>
          </div>
          <button
            aria-label="Close video audio confirmation"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/[0.18]"
            onClick={handleCancel}
            type="button"
          >
            <CrossSmall className="size-6 text-white" />
          </button>
        </header>

        <div className="flex w-full flex-col items-center justify-center gap-4 pb-4">
          <div className="flex w-full flex-col items-start gap-3 text-white/50">
            <p className="w-full text-sm leading-[22px]" style={FF_STYLE}>
              {"We'll take the audio track from "}
              <span className="text-white">{file?.name || 'this video'}</span>
              {
                " and use it as your voice-over and transcript. The video itself won't appear in the generated result."
              }
            </p>
            {durationLine ? (
              <p
                className={cn(
                  'w-full text-xs font-medium leading-[15px]',
                  isOverLimit ? 'text-red-300' : 'text-white/50',
                )}
                style={FF_STYLE}
              >
                {durationLine}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3">
          <Button
            className="h-[38px] min-w-[38px] rounded-[10px] bg-[var(--UI-button-tonal,rgba(255,255,255,0.10))] px-[10px] text-sm font-medium text-white hover:bg-[var(--UI-button-hover,rgba(255,255,255,0.18))]"
            onClick={handleCancel}
            style={FF_STYLE}
            variant="base"
          >
            <span className="px-[2px]">Cancel</span>
          </Button>
          <Button
            className="h-[38px] min-w-[38px] rounded-[10px] px-[10px] text-sm font-medium hover:bg-[var(--UI-button-active-hover,rgba(255,255,255,0.80))]"
            onClick={handleConfirm}
            style={FF_STYLE}
            variant="primary"
          >
            <span className="px-[2px]">Use audio</span>
          </Button>
        </footer>
      </section>
    </BackdropDialog>
  )
}

export default VideoAudioConfirmDialog
