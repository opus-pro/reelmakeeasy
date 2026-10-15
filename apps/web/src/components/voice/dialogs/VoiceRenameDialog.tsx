'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Button, cn, Dialog, Input } from '@shared/ui'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { CrossSmall, Pause, Play } from '@/components/icons/core'
import { useApi } from '@/hooks/useApi'
import { useAudio } from '@/hooks/useAudio'
import { useBreakpoint } from '@/util/browserUtils'

import { defaultColor, type VoiceOption } from '../components/voice-over-selection'

const nsLogger = Logger.get('voice.voice-rename-dialog')

interface VoiceRenameDialogProps {
  dialogClassNames?: {
    content?: string
    overlay?: string
  }
  isPending?: boolean
  onCancel: () => void
  onConfirmRename: (voiceCloneId: string, newName: string) => Promise<void>
  open: boolean
  showClose?: boolean
  voice: null | VoiceOption
}

export function VoiceRenameDialog({
  dialogClassNames,
  open,
  voice,
  onCancel,
  onConfirmRename,
  isPending = false,
  showClose = true,
}: VoiceRenameDialogProps) {
  const [newName, setNewName] = useState('')
  const { playingId, toggle } = useAudio()
  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const { isBelowMd } = useBreakpoint('md')

  const isPlaying = playingId === voice?.value

  useEffect(() => {
    if (open && voice) {
      setNewName(voice.name)
    }
  }, [open, voice])

  const voiceClonePlaybackMutation = useMutation({
    mutationFn: async (voiceCloneId: string) => {
      const res = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
        voiceCloneId: string
      }>(`/api/voice-clones/${voiceCloneId}/playback`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to get playback URL')
      }

      return res.data
    },
  })

  const voiceOverPreviewMutation = useMutation({
    mutationFn: async (voiceId: string) => {
      const res = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
      }>(`/api/voice-over/${voiceId}/preview`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to get presigned URL')
      }

      return res.data
    },
  })

  const handlePlayback = async () => {
    if (!voice) {
      return
    }

    if (voice.voiceCloneId) {
      try {
        const playbackData = await voiceClonePlaybackMutation.mutateAsync(voice.voiceCloneId)
        toggle(voice.value, playbackData.signedUrl)
      } catch (error) {
        nsLogger.error('Failed to get playback URL:', error)
      }
    } else if (voice.needsPresignedUrl) {
      try {
        const previewData = await voiceOverPreviewMutation.mutateAsync(voice.value)
        toggle(voice.value, previewData.signedUrl)
      } catch (error) {
        nsLogger.error('Failed to get presigned URL:', error)
      }
    } else if (voice.previewAudioUrl) {
      toggle(voice.value, voice.previewAudioUrl)
    }
  }

  const handleSave = async () => {
    if (!voice?.voiceCloneId || !newName.trim()) {
      return
    }
    await onConfirmRename(voice.voiceCloneId, newName.trim())
  }

  const isValid = newName.trim() !== '' && newName.trim() !== voice?.name
  const isLoadingAudio = voiceClonePlaybackMutation.isPending || voiceOverPreviewMutation.isPending

  return (
    <Dialog
      classNames={{
        content: cn(
          'bg-[rgba(68,68,68,0.5)] backdrop-blur-2xl text-white border-0 w-[358px] md:max-w-[560px] rounded-xl p-6',
          dialogClassNames?.content,
        ),
        description: 'text-secondary text-sm',
        header: 'mb-4',
        overlay: dialogClassNames?.overlay,
      }}
      description="Enter a new name for your voice."
      onOpenChange={(isOpen) => !isOpen && onCancel()}
      open={open}
      showClose={showClose}
      title="Rename voice"
    >
      <div className="flex flex-col items-center gap-6 py-4">
        {/* Voice Avatar with Play Button */}
        <div className="flex flex-col items-center gap-3">
          <button
            className="rounded-full size-[120px] flex items-center justify-center cursor-pointer transition-opacity hover:opacity-90"
            disabled={isLoadingAudio}
            onClick={handlePlayback}
            style={{ background: voice?.color || defaultColor }}
            type="button"
          >
            {isPlaying ? (
              <Pause className="size-12 text-white" />
            ) : (
              <Play className="size-12 text-white ml-1" />
            )}
          </button>
          {voice?.voiceCloneId && voice?.createdAt && (
            <div className="text-secondary text-sm">Created on {formatDate(voice.createdAt)}</div>
          )}
        </div>

        {/* Name Input */}
        <Input
          className="w-full bg-fill-secondary text-primary rounded-lg px-4 py-3 h-12"
          classNames={{ input: 'placeholder:text-white/40' }}
          maxLength={50}
          onChange={(value) => setNewName(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isValid && !isPending) {
              handleSave()
            }
          }}
          placeholder={voice?.name}
          suffix={
            isBelowMd && newName.length > 0 ? (
              <Button
                aria-label="Clear name"
                className="flex items-center justify-center size-5 rounded-full bg-white/20 hover:bg-white/30 p-0 shrink-0"
                onClick={() => setNewName('')}
                variant="ghost"
              >
                <CrossSmall className="size-3.5 text-white" />
              </Button>
            ) : null
          }
          value={newName}
        />

        {/* Action Buttons */}
        <div className="flex justify-center md:justify-between w-full gap-2 md:gap-3">
          <Button
            className="flex-1 md:flex-none bg-tertiary hover:bg-fill-hover text-primary px-4 h-[48px] md:h-[38px] rounded-full md:rounded-sm"
            disabled={isPending}
            onClick={onCancel}
            variant="secondary"
          >
            {isBelowMd ? 'Cancel' : 'Back'}
          </Button>

          <Button
            className="flex-1 md:flex-none bg-primary hover:bg-primary-hover text-black px-4 h-[48px] md:h-[38px] rounded-full md:rounded-sm"
            disabled={!isValid || isPending}
            onClick={handleSave}
            variant="primary"
          >
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function formatDate(dateString?: string): string {
  if (!dateString) {
    return ''
  }
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
