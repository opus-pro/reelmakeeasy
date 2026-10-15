'use client'

import { Button, cn, Slider } from '@shared/ui'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useReplayMsgList } from '@/app/projects/[projectId]/hooks/useReplayMsgList'
import { useStartReplay } from '@/app/projects/[projectId]/hooks/useStartReplay'
import { ArrowRight, CheckMark, Pause, Play } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useIsMobile } from '@/util/browserUtils'

export interface ReplayControllerProps {
  autoPlay?: boolean
  className?: string
  duration: number
  initialTime?: number
  mode?: 'chat' | 'preview'
  onComplete?: () => void
  onModeChange?: (mode: 'chat' | 'preview') => void
  onPause?: (time: number) => void
  onPlay?: (time: number) => void
  onSeek?: (time: number) => void
  onViewAgain?: () => void
  onViewResult?: () => void
}

interface BindReplayControllerProps {
  autoPlay?: boolean
  mode?: 'chat' | 'preview'
  onModeChange?: (mode: 'chat' | 'preview') => void
}

function BindReplayController({
  autoPlay = false,
  mode = 'chat',
  onModeChange,
}: BindReplayControllerProps) {
  const { lastMsg, currentMsg, reset, seek, pause, resume } = useReplayMsgList()

  useStartReplay()

  const duration = useMemo(() => (lastMsg?.currentMs ?? 0) / 1000, [lastMsg])

  const currentTime = useMemo(() => (currentMsg?.currentMs ?? 0) / 1000, [currentMsg?.currentMs])

  const handleGoEnd = useRefCallback(() => {
    pause()
    seek(Math.floor(duration * 1000))
  })

  const handlePause = useRefCallback((second: number) => {
    pause()
    seek(second * 1000)
  })

  return (
    <ReplayController
      autoPlay={autoPlay}
      duration={duration}
      initialTime={currentTime}
      mode={mode}
      onComplete={handleGoEnd}
      onModeChange={onModeChange}
      onPause={handlePause}
      onPlay={(second) => resume(second * 1000)}
      onSeek={(second) => seek(second * 1000)}
      onViewAgain={() => reset(true)}
      onViewResult={handleGoEnd}
    />
  )
}
function ReplayController({
  autoPlay = true,
  className,
  duration,
  initialTime = 0,
  mode = 'chat',
  onModeChange,
  onComplete,
  onPause,
  onPlay,
  onSeek,
  onViewAgain,
  onViewResult,
}: ReplayControllerProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<number>(Math.min(initialTime, duration))
  const [isCompleted, setIsCompleted] = useState<boolean>(false)
  const [dragValue, setDragValue] = useState<null | number>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const wasPlayingBeforeDrag = useRef<boolean>(false)
  const isMobile = useIsMobile()

  // Get current and last message for progress indicator
  const { currentMsg } = useReplayMsgList()

  const canInteract = useMemo(() => duration > 0, [duration])

  const progress = useMemo(
    () => (duration ? Math.min(duration, Math.max(0, currentTime)) : 0),
    [currentTime, duration],
  )

  const displayedTime = dragValue ?? progress

  // Calculate step progress from messages
  const currentStep = currentMsg?.step ?? 0

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    if (!canInteract) {
      return
    }
    if (intervalRef.current) {
      return
    }
    intervalRef.current = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 0.2
        if (next >= duration) {
          return duration
        }
        return next
      })
    }, 200)
  }, [canInteract, duration])

  useEffect(() => {
    if (isPlaying) {
      startTimer()
    } else {
      stopTimer()
    }
    return stopTimer
  }, [isPlaying, startTimer, stopTimer])

  useEffect(() => {
    if (autoPlay && canInteract) {
      setIsPlaying(true)
      onPlay?.(0)
    }
  }, [autoPlay, canInteract])

  useEffect(() => {
    if (!canInteract) {
      setIsPlaying(false)
      setIsCompleted(false)
      setCurrentTime(0)
      setDragValue(null) // Clear tooltip when slider becomes inactive
    }
  }, [canInteract])

  useEffect(() => {
    if (progress >= duration && canInteract) {
      if (!isCompleted) {
        setIsCompleted(true)
        setIsPlaying(false)
        onComplete?.()
      }
    } else if (isCompleted && progress < duration) {
      setIsCompleted(false)
    }
  }, [canInteract, duration, isCompleted, onComplete, progress])

  // Clear dragValue when replay is completed to hide tooltip
  useEffect(() => {
    if (isCompleted) {
      setDragValue(null)
    }
  }, [isCompleted])

  const handleToggle = () => {
    if (!canInteract) {
      return
    }
    if (isCompleted) {
      return
    }
    if (isPlaying) {
      setIsPlaying(false)
      onPause?.(currentTime)
    } else {
      setIsPlaying(true)
      onPlay?.(currentTime)
    }
  }

  const handleSeekCommit = (value: number) => {
    if (!canInteract) {
      return
    }
    setCurrentTime(value)
    onSeek?.(value)
  }

  const handleViewPrimary = () => {
    if (isCompleted) {
      setCurrentTime(0)
      setIsCompleted(false)
      setIsPlaying(true)
      onViewAgain?.()
      onPlay?.(0)
    } else {
      setIsCompleted(true)
      setIsPlaying(false)
      setCurrentTime(duration)
      onViewResult?.()
    }
  }

  return (
    <div className={cn('w-full rounded-2xl bg-foreground text-white', className)}>
      {/* Top row: Play button, progress bar, and step indicator */}
      <div className="flex h-14 items-center gap-3 p-4">
        <Button
          aria-label={isPlaying && !isCompleted ? 'Pause' : 'Play'}
          className="size-5 rounded-full bg-transparent p-0 text-white !opacity-100"
          disabled={!canInteract || isCompleted}
          onClick={handleToggle}
          size="icon"
          variant="base"
        >
          {isPlaying ? (
            <Pause height={24} width={24} />
          ) : isCompleted ? (
            <CheckMark className="text-accent-green" height={24} width={24} />
          ) : (
            <Play height={24} width={24} />
          )}
        </Button>

        <div className="relative flex flex-1 items-center">
          {isCompleted ? (
            <p className="shrink-0 text-base font-normal leading-6.5 tracking-[-0.12px] text-white">
              Video is ready!
            </p>
          ) : (
            <Slider
              aria-label="Replay progress"
              bufferProgress={100}
              className="flex-1"
              max={Math.max(0, duration)}
              min={0}
              onValueChange={(val) => {
                if (!canInteract) {
                  return
                }
                if (!Array.isArray(val)) {
                  return
                }
                if (dragValue === null) {
                  wasPlayingBeforeDrag.current = isPlaying
                  setIsPlaying(false)
                }
                setDragValue(val[0])
                handleSeekCommit(val[0])
              }}
              onValueCommit={(val) => {
                if (!Array.isArray(val)) {
                  return
                }
                const v = val[0]
                setDragValue(null)
                if (wasPlayingBeforeDrag.current && v < duration) {
                  setIsPlaying(true)
                  onPlay?.(v)
                }
              }}
              rangeClassName="bg-white"
              showBuffer={false}
              step={0.1}
              thumbClassName="size-2.5 bg-white"
              trackClassName="h-1 bg-fill-secondary"
              value={[displayedTime]}
            />
          )}

          {/* Step indicator above the slider thumb when dragging */}
          {dragValue !== null && (
            <div
              className="bg-uiBlack pointer-events-none absolute -top-8 left-0 rounded-md px-2 py-1 text-xs font-medium text-white"
              style={{
                left: `${((dragValue ?? 0) / Math.max(1, duration)) * 100}%`,
                marginLeft: -20, // Half the indicator width for centering
                minWidth: 40,
                textAlign: 'center',
              }}
            >
              {Math.max(1, currentStep)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Action buttons */}
      <div className="flex gap-2 px-4 pb-3 pt-1">
        {isMobile && (
          <Button
            className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-sm border-none bg-white text-sm font-medium text-black hover:bg-gray-100"
            onClick={() => onModeChange?.(mode === 'preview' ? 'chat' : 'preview')}
          >
            {mode === 'preview' ? 'View log' : 'Preview'}
          </Button>
        )}
        <Button
          className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-sm border-none bg-white text-sm font-medium text-black hover:bg-gray-100"
          onClick={handleViewPrimary}
        >
          {isCompleted ? 'View again' : 'Go to result'}
          {!isCompleted && <ArrowRight height={18} width={18} />}
        </Button>
      </div>
    </div>
  )
}

export default memo(BindReplayController)
