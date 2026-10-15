'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import React, { useCallback, useMemo, useRef } from 'react'

import { CrossSmall, Loading } from '@/components/icons/core'

export interface ReferenceUploadButtonProps {
  accept: string
  disabled?: boolean
  /** Icon used when there is no preview thumbnail. */
  icon?: React.ReactNode
  label: string
  onButtonClick?: () => void
  onClear?: () => void
  onFileSelect?: (file: File) => void
  tooltip: React.ReactNode
  value?: null | ReferenceUploadButtonValue
}

export type ReferenceUploadButtonValue = {
  file?: File
  fileUri?: string
  height?: number
  isProcessing?: boolean
  presetId?: string
  presetLabel?: string
  previewUrl?: string
  width?: number
}

export const ReferenceUploadButton = React.forwardRef<HTMLInputElement, ReferenceUploadButtonProps>(
  function ReferenceUploadButton(
    { accept, disabled = false, label, onClear, onFileSelect, tooltip, value, icon, onButtonClick },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null)

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [])

    const hasValue = !!(value?.file || value?.presetId)
    const isProcessing = !!value?.isProcessing

    const tooltipContent = useMemo(() => {
      if (
        hasValue &&
        !isProcessing &&
        value?.previewUrl &&
        typeof value.width === 'number' &&
        typeof value.height === 'number' &&
        value.width > 0 &&
        value.height > 0
      ) {
        return (
          <ReferenceHoverPreviewCard
            height={value.height}
            label={label}
            src={value.previewUrl}
            width={value.width}
          />
        )
      }
      return tooltip
    }, [hasValue, isProcessing, label, tooltip, value?.height, value?.previewUrl, value?.width])

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        if (disabled) {
          return
        }
        // If has value and onClear is provided, clear it
        if (hasValue && onClear) {
          e.preventDefault()
          e.stopPropagation()
          onClear()
          return
        }
        // Otherwise, trigger custom onClick if provided (for auth check), or open file picker
        if (onButtonClick) {
          onButtonClick()
        } else {
          inputRef.current?.click()
        }
      },
      [disabled, hasValue, onClear, onButtonClick],
    )

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) {
          return
        }
        onFileSelect?.(file)
        if (inputRef.current) {
          inputRef.current.value = ''
        }
      },
      [onFileSelect],
    )

    return (
      <div className="flex items-center">
        <input
          accept={accept}
          disabled={disabled}
          onChange={handleChange}
          ref={inputRef}
          style={{ display: 'none' }}
          type="file"
        />

        <Tooltip
          className={
            hasValue && value?.previewUrl
              ? 'overflow-hidden rounded-lg border-0 bg-transparent p-0'
              : 'bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1'
          }
          content={tooltipContent}
          side="top"
          sideOffset={8}
        >
          <span className="relative inline-flex items-center group">
            <Button
              className={cn(
                'h-9 rounded-sm flex items-center justify-center font-medium bg-transparent transition-colors',
                hasValue ? 'size-9 min-w-9 p-0' : 'px-2.5 gap-2 text-primary',
                disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-fill-hover hover:text-primary',
                hasValue && 'text-primary',
              )}
              disabled={disabled}
              onClick={handleClick}
            >
              {isProcessing ? (
                <Loading className="size-4.5 shrink-0 animate-spin" />
              ) : value?.previewUrl ? (
                <>
                  <span
                    className="relative flex items-center justify-center size-4.5 rounded border-[1.5px] border-white shrink-0 bg-center bg-cover bg-no-repeat transition-opacity"
                    style={{ backgroundImage: `url(${value.previewUrl})` }}
                  >
                    {hasValue && onClear && (
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-[2px] bg-black/20 rounded-[inherit]">
                        <CrossSmall className="size-3 text-white" />
                      </span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-primary">{icon}</span>
                  <span className="max-sm:hidden">{label}</span>
                </>
              )}
            </Button>
          </span>
        </Tooltip>
      </div>
    )
  },
)

function ReferenceHoverPreviewCard({
  height,
  label,
  src,
  width,
}: {
  height: number
  label: string
  src: string
  width: number
}) {
  // Calculate max dimensions while maintaining aspect ratio
  const aspectRatio = width / height
  const maxHeight = 160 // Maximum height in pixels
  const calculatedWidth = Math.min(maxHeight * aspectRatio, 200) // Cap width at 200px
  const calculatedHeight = calculatedWidth / aspectRatio

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40 shadow-xl"
      style={{
        width: `${calculatedWidth}px`,
        height: `${calculatedHeight}px`,
      }}
    >
      <img alt={label} className="size-full object-cover object-center" src={src} />
      <div className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
        {label}
      </div>
    </div>
  )
}
