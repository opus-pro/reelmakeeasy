import { cn, Dialog } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import RiveCanvas from '@/components/animated/RiveCanvas'
import { Select } from '@/components/icons/core'
import type { GenerateProgress } from '@/hooks/useAssetGeneration'
import { getPublicCdnUrl } from '@/util/cdn-utils'

export interface KeyframeOption {
  imageUrl: string
  label: string
}

interface KeyframeSelectionDialogProps {
  onConfirm: (selectedIndex: number) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  options: KeyframeOption[]
  progress: GenerateProgress | null
}

interface ProgressStep {
  completed: boolean
  loading: boolean
  message: string
}

export function KeyframeSelectionDialog({
  onConfirm,
  onOpenChange,
  open,
  options,
  progress,
}: KeyframeSelectionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const lastMessageRef = useRef<null | string>(null)
  const isLoading = options.length === 0

  // Accumulate progress steps - each new message marks previous ones as completed
  useEffect(() => {
    if (!open) {
      // Reset when dialog closes
      setProgressSteps([])
      lastMessageRef.current = null
      return
    }

    const currentMessage = progress?.message || progress?.stage || 'Initializing...'

    // Only add new step if message changed
    if (currentMessage !== lastMessageRef.current) {
      lastMessageRef.current = currentMessage
      setProgressSteps((prev) => {
        // Mark all previous steps as completed
        const completedPrev = prev.map((step) => ({ ...step, completed: true, loading: false }))
        // Add new step as loading
        return [...completedPrev, { message: currentMessage, completed: false, loading: true }]
      })
    }
  }, [open, progress])

  // This dialog stays mounted across open/close cycles (controlled via `open`),
  // so we must reset/clamp internal selection when reopening or when options change.
  useEffect(() => {
    if (!open) {
      return
    }
    const maxIndex = Math.max(options.length - 1, 0)
    setSelectedIndex(Math.min(0, maxIndex))
  }, [open, options.length])

  const handleConfirm = () => {
    onConfirm(selectedIndex)
  }

  const handleOptionClick = (index: number) => {
    setSelectedIndex(index)
  }

  return (
    <Dialog
      classNames={{
        content: 'border-none bg-menu-background backdrop-blur-2xl rounded-lg p-6 w-[520px]',
        footer: cn('flex items-center justify-end', isLoading && 'invisible'),
      }}
      confirmButtonProps={{
        className: 'bg-primary text-primary-foreground',
        disabled: isLoading,
      }}
      confirmText="Continue"
      description="Three keyframe options have been generated. Select one to proceed with video generation."
      ignoreInteractOutside
      onConfirm={handleConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title={isLoading ? 'Generating keyframes...' : 'Choose a keyframe to regenerate'}
    >
      <div className="flex flex-col gap-4">
        {/* Progress steps - upper part (only visible during loading) */}
        <div className={cn('flex flex-col gap-1', !isLoading && 'hidden')}>
          {progressSteps.map((step, index) => (
            <ProgressStepItem key={index} step={step} />
          ))}
        </div>

        {/* Image options / Loading placeholders */}
        <div className="flex gap-2.5">
          {isLoading ? (
            <>
              <LoadingImagePlaceholder label="Option 1" />
              <LoadingImagePlaceholder label="Option 2" />
              <LoadingImagePlaceholder label="Option 3" />
            </>
          ) : (
            options.map((option, index) => {
              const isSelected = index === selectedIndex
              return (
                <div
                  className="flex flex-1 flex-col items-center gap-2.5 cursor-pointer"
                  key={index}
                  onClick={() => handleOptionClick(index)}
                >
                  <div
                    className={cn(
                      'relative aspect-[9/16] w-full rounded-xs overflow-hidden border-2',
                      isSelected ? 'border-primary' : 'border-transparent',
                    )}
                  >
                    <div className="absolute inset-0 bg-fill-disabled pointer-events-none rounded-xs" />
                    <img
                      alt={option.label}
                      className="absolute inset-0 size-full object-cover rounded-xs pointer-events-none"
                      src={option.imageUrl}
                    />
                  </div>
                  <p className={cn('text-sm', isSelected ? 'text-primary' : 'text-secondary')}>
                    {option.label}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </div>
    </Dialog>
  )
}

function LoadingImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2.5">
      <div className="relative aspect-[9/16] w-full rounded-lg overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-fill-tertiary rounded-lg" />
        {/* Shimmer effect - diagonal from top-left to bottom-right */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-1/2 left-1/2 w-[300%] h-32 blur-xl animate-shimmer-diagonal"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.15) 50%, transparent 100%)',
            }}
          />
        </div>
      </div>
      <p className="text-sm text-secondary">{label}</p>
    </div>
  )
}

function ProgressStepItem({ step }: { step: ProgressStep }) {
  return (
    <div className="flex gap-1 items-center w-full">
      <div className="shrink-0 size-[18px] flex items-center justify-center">
        {step.completed ? (
          <Select className="size-[18px] text-secondary" />
        ) : step.loading ? (
          <RiveCanvas
            autoplay
            className="size-[18px]"
            showLoadingSkeleton={false}
            src={getPublicCdnUrl('agent/rive/ai_icon.riv')}
            stateMachines="State Machine"
          />
        ) : (
          <div className="size-2 rounded-full bg-fill-tertiary" />
        )}
      </div>
      <p className={cn('flex-1 text-sm leading-[22px] text-secondary')}>{step.message}</p>
    </div>
  )
}
