'use client'

import { Button, cn } from '@shared/ui'
import Dialog from '@shared/ui/dialog'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { formatSecondsToTime } from '@/util/time-utils'

type TrimRange = {
  endSec: number
  startSec: number
}

interface VideoTrimDialogProps {
  clipDurationSec: number
  file: File
  isLoading?: boolean
  onCancel: () => void
  onConfirm: (range: TrimRange) => void
  open: boolean
  videoDurationSec: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export const VideoTrimDialog = memo(
  ({
    clipDurationSec,
    file,
    isLoading = false,
    onCancel,
    onConfirm,
    open,
    videoDurationSec,
  }: VideoTrimDialogProps) => {
    const [videoUrl, setVideoUrl] = useState<null | string>(null)
    const [startSec, setStartSec] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const trackRef = useRef<HTMLDivElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const dragStateRef = useRef<null | { startSec: number; startX: number }>(null)

    const safeDuration = Number.isFinite(videoDurationSec) ? videoDurationSec : 0
    const clipDuration = useMemo(() => {
      if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) {
        return 0
      }
      if (!safeDuration) {
        return clipDurationSec
      }
      return Math.min(clipDurationSec, safeDuration)
    }, [clipDurationSec, safeDuration])

    const maxStartSec = Math.max(0, safeDuration - clipDuration)

    const clipLabel = useMemo(() => {
      if (!Number.isFinite(clipDuration) || clipDuration <= 0) {
        return '0'
      }
      const rounded = Math.round(clipDuration * 10) / 10
      return Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`
    }, [clipDuration])

    useEffect(() => {
      if (!open) {
        return
      }
      setStartSec(0)
    }, [open, file])

    useEffect(() => {
      setStartSec((prev) => clamp(prev, 0, maxStartSec))
    }, [maxStartSec])

    useEffect(() => {
      if (!open) {
        setVideoUrl(null)
        return
      }

      const objectUrl = URL.createObjectURL(file)
      setVideoUrl(objectUrl)
      return () => {
        URL.revokeObjectURL(objectUrl)
      }
    }, [file, open])

    useEffect(() => {
      const video = videoRef.current
      if (!video || !open || !Number.isFinite(startSec)) {
        return
      }
      try {
        video.currentTime = startSec
        if (isDragging || isLoading) {
          video.pause()
        }
      } catch {
        // Ignore seek errors during rapid drag updates.
      }
    }, [isDragging, isLoading, open, startSec])

    useEffect(() => {
      const video = videoRef.current
      if (
        !video ||
        !open ||
        !videoUrl ||
        isDragging ||
        isLoading ||
        !Number.isFinite(startSec) ||
        !Number.isFinite(clipDuration) ||
        clipDuration <= 0
      ) {
        return
      }

      let cancelled = false
      const endSec = startSec + clipDuration

      const handleTimeUpdate = () => {
        if (video.currentTime >= endSec - 0.05) {
          video.currentTime = startSec
          if (video.paused) {
            void video.play().catch(() => {
              // Ignore autoplay errors for preview.
            })
          }
        }
      }

      const playPreview = async () => {
        try {
          video.currentTime = startSec
          await video.play()
          if (cancelled) {
            return
          }
          video.addEventListener('timeupdate', handleTimeUpdate)
        } catch {
          // Ignore autoplay errors for preview.
        }
      }

      if (video.readyState >= 1) {
        void playPreview()
      } else {
        const handleLoadedMetadata = () => {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          if (!cancelled) {
            void playPreview()
          }
        }
        video.addEventListener('loadedmetadata', handleLoadedMetadata)
        return () => {
          cancelled = true
          video.removeEventListener('loadedmetadata', handleLoadedMetadata)
          video.removeEventListener('timeupdate', handleTimeUpdate)
          video.pause()
        }
      }

      return () => {
        cancelled = true
        video.removeEventListener('timeupdate', handleTimeUpdate)
        video.pause()
      }
    }, [clipDuration, isDragging, isLoading, open, startSec, videoUrl])

    const startPercent = safeDuration ? (startSec / safeDuration) * 100 : 0
    const widthPercent = safeDuration ? (clipDuration / safeDuration) * 100 : 0

    const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!trackRef.current || safeDuration <= 0 || clipDuration <= 0 || isLoading) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStateRef.current = {
        startSec,
        startX: event.clientX,
      }
      setIsDragging(true)
    }

    const handleSelectionPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current || !trackRef.current || safeDuration <= 0) {
        return
      }
      const rect = trackRef.current.getBoundingClientRect()
      const deltaPx = event.clientX - dragStateRef.current.startX
      const deltaSec = (deltaPx / rect.width) * safeDuration
      const nextStart = clamp(dragStateRef.current.startSec + deltaSec, 0, maxStartSec)
      setStartSec(nextStart)
    }

    const handleSelectionPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      dragStateRef.current = null
      setIsDragging(false)
    }

    const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!trackRef.current || safeDuration <= 0 || clipDuration <= 0 || isLoading) {
        return
      }
      const rect = trackRef.current.getBoundingClientRect()
      const ratio = (event.clientX - rect.left) / rect.width
      const nextStart = clamp(ratio * safeDuration, 0, maxStartSec)
      setStartSec(nextStart)
    }

    const handleOpenChange = (isOpen: boolean) => {
      if (!isOpen && !isLoading) {
        onCancel()
      }
    }

    const canConfirm = !isLoading && safeDuration > 0 && clipDuration > 0

    return (
      <Dialog
        classNames={{
          content:
            'border-none bg-menu-background backdrop-blur-2xl max-w-[560px] flex flex-col rounded-xl p-6',
          header: 'mb-0 shrink-0 space-y-1',
          title: 'text-lg font-semibold text-primary leading-tight',
        }}
        description={`Select a ${clipLabel}s clip from the video to fill this shot.`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button disabled={isLoading} onClick={onCancel} variant="default">
              Cancel
            </Button>
            <Button
              className={cn(
                isLoading &&
                  'h-9 rounded-sm px-2.5 text-sm font-medium bg-fill-secondary hover:bg-fill-hover hover:text-primary',
              )}
              disabled={!canConfirm}
              onClick={() => onConfirm({ endSec: startSec + clipDuration, startSec })}
              variant={isLoading ? 'ghost' : 'primary'}
            >
              {isLoading ? 'Processing...' : 'Confirm'}
            </Button>
          </div>
        }
        onOpenChange={handleOpenChange}
        open={open}
        showClose={!isLoading}
        title="Trim"
      >
        <div className="flex flex-col gap-3">
          <div className="relative rounded-xs bg-fill-disabled flex items-center justify-center">
            <video
              className={cn('h-[280px] w-[158px] object-cover', isLoading && 'opacity-60')}
              controls={false}
              muted
              onContextMenu={(e) => e.preventDefault()}
              playsInline
              ref={videoRef}
              src={videoUrl ?? undefined}
            />
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-menu-background/80 backdrop-blur-sm z-50 rounded-xs">
                <div className="flex flex-col items-center gap-3">
                  <div className="size-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                  <div className="text-sm text-white/70">Processing...</div>
                </div>
              </div>
            )}
          </div>
          {/* Timeline track */}
          <div
            className="relative h-10 rounded-xs bg-fill-disabled overflow-hidden"
            onPointerDown={handleTrackPointerDown}
            ref={trackRef}
          >
            {/* Grid pattern */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-full h-2.5 bg-[linear-gradient(to_right,rgba(255,255,255,0.25)_1px,transparent_1px)] bg-[length:12px_100%] opacity-70" />
            </div>

            {/* Selection overlay */}
            <div
              className={cn(
                'absolute top-0 h-10 rounded-xs',
                'bg-white/30 border-2 border-white',
                isDragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
              onPointerCancel={handleSelectionPointerEnd}
              onPointerDown={handleSelectionPointerDown}
              onPointerMove={handleSelectionPointerMove}
              onPointerUp={handleSelectionPointerEnd}
              style={{
                left: `${startPercent}%`,
                width: `${Math.min(widthPercent, 100)}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-secondary font-medium py-1">
            <span>{formatSecondsToTime(0)}</span>
            <span>Select {clipLabel}s clip</span>
            <span>{formatSecondsToTime(safeDuration)}</span>
          </div>
        </div>
      </Dialog>
    )
  },
)

VideoTrimDialog.displayName = 'VideoTrimDialog'
