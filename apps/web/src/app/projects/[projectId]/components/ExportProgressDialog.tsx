'use client'

import { Button, cn, toast } from '@shared/ui'
import Dialog from '@shared/ui/dialog'
import { memo, useMemo } from 'react'
import { useState } from 'react'

import { CircularProgress } from '@/components/CircularProgress'
import { VideoPlayer } from '@/components/VideoPlayer'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { useExportProgress } from '../hooks/useExportProgress'

interface ExportProgressDialogProps {
  autoFit?: boolean
  description?: string
  // Simulated progress-window length (ms). Pass a longer value (~5.5min) when the
  // export runs a Topaz upscale so the fake progress paces with the real ~5min
  // render instead of freezing at 90%. Defaults to the no-upscale ~1.5min curve.
  estimatedDurationMs?: number
  isActive: boolean
  isCancelling?: boolean
  isCompleted: boolean
  onCancelled?: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  preventClose?: boolean
  thumbnailUrl: string | undefined
  videoUrl: string | undefined
}

function ExportProgressDialog({
  autoFit = false,
  description: descriptionProp,
  estimatedDurationMs,
  open,
  onOpenChange,
  videoUrl,
  thumbnailUrl,
  isCancelling,
  isActive,
  isCompleted,
  onCancelled,
  preventClose = false,
}: ExportProgressDialogProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const { progress } = useExportProgress({
    estimatedDurationMs,
    isActive,
    isCompleted,
  })

  const handleConfirmCancel = useRefCallback(async () => {
    setShowCancelConfirm(false)
    if (!isActive || isCancelling) {
      return
    }

    try {
      await onCancelled?.()
      toast.dismiss()
      toast.success('Export cancelled')
      onOpenChange(false)
    } catch (_error) {
      toast.dismiss()
      toast.error('Failed to cancel export. Please try again.')
    }
  })

  const handleKeepExporting = useRefCallback(() => {
    setShowCancelConfirm(false)
  })

  const handleDialogOpenChange = useRefCallback((open: boolean) => {
    if (!open && preventClose) {
      return
    }
    if (!open && isActive && !isCompleted) {
      setShowCancelConfirm(true)
    } else {
      onOpenChange(open)
    }
  })

  const description = useMemo(() => {
    if (isCompleted) {
      return 'Rendering complete. Your video has been downloaded.'
    }
    if (descriptionProp) {
      return descriptionProp
    }
    return 'The video will be automatically downloaded once rendering is complete.'
  }, [descriptionProp, isCompleted])

  return (
    <>
      <Dialog
        classNames={{
          content:
            'border-none bg-menu-background backdrop-blur-2xl max-w-[560px] h-[560px] flex flex-col rounded-xl p-6',
          header: 'mb-0 shrink-0',
          description: 'whitespace-pre-wrap',
        }}
        description={description}
        ignoreInteractOutside={true}
        onOpenChange={handleDialogOpenChange}
        open={open}
        showClose={!preventClose}
        title="Export video"
      >
        <div className="relative size-full flex items-center justify-center overflow-hidden rounded-xl bg-black">
          <div
            className={cn(
              'relative h-full w-auto',
              autoFit ? 'flex justify-center items-center' : 'aspect-[9/16]',
            )}
          >
            {isCompleted ? (
              <VideoPlayer
                autoPlay={false}
                className="size-full object-cover"
                loop={false}
                showHoverPlayButton={true}
                spacebarHandling="off"
                // Add a timestamp to the video URL to prevent caching
                src={`${videoUrl || ''}?t=${Date.now()}`}
              />
            ) : (
              <>
                <div className="absolute inset-0 backdrop-blur-2xl bg-menu-background/50" />
                <img alt="Thumbnail" className="size-full object-cover" src={thumbnailUrl || ''} />
              </>
            )}
            {!isCompleted && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <CircularProgress percentage={progress} size={68} />
              </div>
            )}
          </div>
        </div>
      </Dialog>
      <Dialog
        classNames={{
          content:
            'border-none bg-menu-background backdrop-blur-2xl max-w-[480px] flex flex-col rounded-xl p-6',
          header: 'mb-0 shrink-0',
        }}
        description="If you exit now, the rendering process will be terminated and your progress won't be saved."
        footer={
          <div className="flex w-full items-center gap-3">
            <Button className="flex-1" onClick={handleKeepExporting} variant="default">
              Keep exporting
            </Button>
            {onCancelled && (
              <Button className="flex-1" onClick={handleConfirmCancel} variant="primary">
                Cancel
              </Button>
            )}
          </div>
        }
        onOpenChange={(open) => !open && setShowCancelConfirm(false)}
        open={showCancelConfirm}
        showClose={false}
        title="Cancel export?"
      >
        {null}
      </Dialog>
    </>
  )
}

export default memo(ExportProgressDialog)
