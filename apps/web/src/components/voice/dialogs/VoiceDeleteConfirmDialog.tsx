'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { cn, Dialog } from '@shared/ui'
import { useMutation } from '@tanstack/react-query'
import React from 'react'

import { Pause, Play } from '@/components/icons/core'
import { useApi } from '@/hooks/useApi'
import { useAudio } from '@/hooks/useAudio'

import { defaultColor, type VoiceOption } from '../components/voice-over-selection'

const nsLogger = Logger.get('voice.voice-delete-confirm-dialog')

interface VoiceDeleteConfirmDialogProps {
  dialogClassNames?: {
    content?: string
    overlay?: string
  }
  onCancel: () => void
  onConfirmDelete: () => void
  open: boolean
  showClose?: boolean
  voice: null | VoiceOption
}

export function VoiceDeleteConfirmDialog({
  dialogClassNames,
  open,
  voice,
  onCancel,
  onConfirmDelete,
  showClose = true,
}: VoiceDeleteConfirmDialogProps) {
  const { playingId, toggle } = useAudio()
  const { fetchApiDomain: fetchWithProjectId } = useApi()

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

  const handlePlayback = async (voiceToPlay: VoiceOption): Promise<void> => {
    if (voiceToPlay.voiceCloneId) {
      try {
        const playbackData = await voiceClonePlaybackMutation.mutateAsync(voiceToPlay.voiceCloneId)
        toggle(voiceToPlay.value, playbackData.signedUrl)
      } catch (error) {
        nsLogger.error('Failed to get playback URL:', error)
      }
    } else if (voiceToPlay.needsPresignedUrl) {
      try {
        const previewData = await voiceOverPreviewMutation.mutateAsync(voiceToPlay.value)
        toggle(voiceToPlay.value, previewData.signedUrl)
      } catch (error) {
        nsLogger.error('Failed to get presigned URL:', error)
      }
    } else if (voiceToPlay.previewAudioUrl) {
      toggle(voiceToPlay.value, voiceToPlay.previewAudioUrl)
    } else {
      nsLogger.log('No playback URL available for this voice')
    }
  }

  if (!voice) {
    return null
  }

  const isPlaying = playingId === voice.value
  const isLoading = voiceClonePlaybackMutation.isPending || voiceOverPreviewMutation.isPending

  return (
    <Dialog
      classNames={{
        content: cn(
          'w-[calc(100%-2rem)] md:w-[440px] rounded-2xl p-6 flex flex-col items-start border-none bg-menu-background backdrop-blur-[40px] gap-0',
          dialogClassNames?.content,
        ),
        overlay: dialogClassNames?.overlay,
      }}
      footer={null}
      header={null}
      onOpenChange={(isOpen) => !isOpen && onCancel()}
      open={open}
      showClose={showClose}
    >
      {/* Content wrapper with title, description, and voice card */}
      <div className="flex flex-col items-center md:items-start gap-2 md:gap-4 mb-4 self-stretch w-full">
        <h2 className="text-primary text-lg md:text-xl font-semibold">Delete this voice?</h2>

        {/* Description */}
        <p className="text-sm text-secondary text-center md:text-left leading-normal">
          Once deleted, this voice can't be recovered. Are you sure you want to delete it?
        </p>

        {/* Voice preview card */}
        <div className="rounded-xl flex w-full max-w-[392px] items-center border border-[rgba(255,255,255,0.1)] bg-transparent p-[10px]">
          <div className="flex flex-1 items-center gap-2.5">
            {/* Voice play button (same as in voice list) */}
            <button
              className="flex size-8 items-center justify-center rounded-full"
              disabled={isLoading}
              onClick={() => handlePlayback(voice)}
              style={{ background: voice.color || defaultColor }}
              type="button"
            >
              {isPlaying ? (
                <Pause className="size-4 text-white" />
              ) : (
                <Play className="ml-0.5 size-4 text-white" />
              )}
            </button>

            {/* Voice info */}
            <div className="flex flex-col items-start self-stretch">
              {/* Voice name */}
              <div className="text-primary text-[14px] font-medium leading-[17px]">
                {voice.name}
              </div>
              {/* Voice metadata */}
              {voice.voiceCloneId && voice.createdAt && (
                <div className="text-secondary text-[12px] font-normal leading-[19px]">
                  Custom voice {'·'}{' '}
                  {new Date(voice.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex w-full flex-row items-center justify-center md:justify-end gap-2">
        <button
          className="flex-1 md:flex-none h-[48px] md:h-[38px] min-h-[38px] items-center justify-center gap-1.5 rounded-full md:rounded-sm bg-[rgba(255,255,255,0.1)] px-2.5 transition-colors hover:bg-[rgba(255,255,255,0.15)]"
          onClick={onCancel}
          type="button"
        >
          <span className="text-base md:text-sm font-medium text-white">Cancel</span>
        </button>

        <button
          className="flex-1 md:flex-none md:h-[38px] min-h-[38px] items-center justify-center gap-1.5 rounded-full md:rounded-sm bg-white px-2.5 transition-colors hover:bg-white/90"
          onClick={onConfirmDelete}
          type="button"
        >
          <span className="text-base md:text-sm font-medium text-black">Delete</span>
        </button>
      </div>
    </Dialog>
  )
}
