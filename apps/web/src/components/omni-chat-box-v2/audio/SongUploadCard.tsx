'use client'
import { cn, toast } from '@shared/ui'
import { useRef, useState } from 'react'

import { Microphone } from '@/components/icons/core'

import { rejectedFilesMessage } from '../story-mode-style-image'

interface SongUploadCardProps {
  accept: string
  className?: string
  disabled?: boolean
  onSelectFiles: (files: File[]) => void
}

export function SongUploadCard({
  accept,
  className,
  disabled,
  onSelectFiles,
}: SongUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  // The designed "hovered" state fills the dashed zone and fans
  // the Song cards further apart. Trigger it on pointer hover AND file drag.
  const highlighted = isHovering || isDragging

  const emit = (fileList: FileList | null, method: 'browse' | 'drop') => {
    if (disabled || !fileList || fileList.length === 0) {
      return
    }
    // Drops bypass the input's `accept`, so filter here too: the song card is
    // audio-only, and non-audio drops (e.g. images) must not slip through to the
    // Story Mode pipeline as hidden anchor attachments.
    const files = Array.from(fileList)
    const accepted = files.filter((file) => matchesAccept(file, accept))
    const rejected = files.filter((file) => !matchesAccept(file, accept))
    // Name the rejected file instead of failing silently: one toast per drop
    // with a stable id, mirroring the omnibox rejection notice.
    if (rejected.length > 0) {
      toast.error(rejectedFilesMessage(rejected, 'Only audio files'), {
        id: 'song-upload-unsupported-type',
      })
    }
    if (accepted.length === 0) {
      return
    }
    onSelectFiles(accepted)
  }

  return (
    <div
      className={cn(
        // bg-menu-background = rgba(68,68,68,0.5) (design token
        // ui/menu-background) - same translucent fill as the omnibox panel this
        // card replaces. bg-menu is the SOLID #444 menu fill and reads too light.
        'flex h-[150px] w-full items-start justify-center rounded-[24px] bg-menu-background p-[8px] backdrop-blur-[50px]',
        className,
      )}
    >
      <input
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          emit(e.target.files, 'browse')
          e.target.value = ''
        }}
        ref={inputRef}
        type="file"
      />
      <div
        aria-label="Song audio upload"
        className={cn(
          'flex h-full min-w-px flex-1 items-center justify-center gap-[32px] rounded-[16px] border border-dashed border-white/10 pl-[8px] transition-colors duration-200',
          highlighted && 'bg-white/10',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
        data-testid="song-upload-dropzone"
        onClick={() => {
          if (!disabled) {
            inputRef.current?.click()
          }
        }}
        onDragLeave={(e) => {
          const related = e.relatedTarget as Node | null
          if (!related || !e.currentTarget.contains(related)) {
            setIsDragging(false)
          }
        }}
        onDragOver={(e) => {
          if (disabled) {
            return
          }
          e.preventDefault()
          setIsDragging(true)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          emit(e.dataTransfer.files, 'drop')
        }}
        onMouseEnter={() => {
          if (!disabled) {
            setIsHovering(true)
          }
        }}
        onMouseLeave={() => setIsHovering(false)}
        role="region"
      >
        {/* Stacked Song cards. Back card overlaps the front
            via the negative margin; both fan further apart when highlighted. */}
        <div className="flex items-center">
          <div className="mr-[-69.302px] flex h-[90.727px] w-[75.322px] items-center justify-center">
            <div
              className={cn(
                'transition-transform duration-200',
                highlighted ? '-rotate-[15deg]' : '-rotate-12',
              )}
            >
              <div className="h-[80px] w-[60px] rounded-[8px] border-2 border-white/5 bg-[#3d3c3c]" />
            </div>
          </div>
          <div className="flex h-[86.716px] w-[69.302px] items-center justify-center">
            <div
              className={cn(
                'transition-transform duration-200',
                highlighted ? 'rotate-[9deg]' : 'rotate-[7deg]',
              )}
            >
              <div className="flex h-[80px] w-[60px] flex-col items-center justify-center gap-[4px] rounded-[8px] border-2 border-white/10 bg-[#454545] p-[6px]">
                <Microphone className="size-[24px] text-white opacity-50" />
                <span className="w-full truncate text-center text-[12px] font-medium leading-[15px] text-primary">
                  Song
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <p className="text-[18px] font-medium leading-[22px] text-primary">
            Drag and drop an audio file, or{' '}
            <button
              className="underline"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation()
                inputRef.current?.click()
              }}
              type="button"
            >
              Browse
            </button>
          </p>
          <p className="text-[16px] font-normal leading-[26px] tracking-[-0.12px] text-white/40">
            Upload an audio file with your song to create music video.
          </p>
        </div>
      </div>
    </div>
  )
}

// Mirror the file input's `accept` for drag-drop, which the browser does NOT
// filter. Accepts wildcard ("audio/*"), exact mime ("audio/mpeg") and extension
// (".mp3") tokens, matching the standard accept attribute syntax.
function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.length === 0) {
    return true
  }
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return tokens.some((token) => {
    if (token.startsWith('.')) {
      return name.endsWith(token)
    }
    if (token.endsWith('/*')) {
      return type.startsWith(token.slice(0, -1))
    }
    return type === token
  })
}
