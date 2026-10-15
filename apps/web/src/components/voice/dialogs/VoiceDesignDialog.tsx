'use client'

import { toast } from '@shared/ui'
import Dialog from '@shared/ui/dialog'
import { cn } from '@shared/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import { EngineCostTag } from '../components/tts-engines'
import {
  defaultColor,
  type UserVoiceClone,
  type VoiceOption,
} from '../components/voice-over-selection'

const MAX_DESCRIPTION_LENGTH = 1000
const MAX_SAMPLE_TEXT_LENGTH = 400

const EXAMPLE_DESCRIPTION =
  'A warm, calm middle-aged female narrator with a gentle British accent, speaking slowly and clearly.'

interface DesignedVoice {
  previewUrl?: string
  voiceId: string
}

interface VoiceDesignDialogProps {
  onClose: () => void
  onVoiceCreated: (voice: VoiceOption) => void
  open: boolean
}

/**
 * Designs a new voice from a written description with Qwen3-TTS. The API speaks
 * a sample in the described voice and turns it into a reusable voice, which the
 * user auditions, names and saves.
 */
export function VoiceDesignDialog({ onClose, onVoiceCreated, open }: VoiceDesignDialogProps) {
  const { fetchApiDomain } = useApi()
  const [description, setDescription] = useState('')
  const [sampleText, setSampleText] = useState('')
  const [name, setName] = useState('')
  const [designed, setDesigned] = useState<DesignedVoice | null>(null)

  useEffect(() => {
    if (!open) {
      setDescription('')
      setSampleText('')
      setName('')
      setDesigned(null)
    }
  }, [open])

  const design = useMutation({
    mutationFn: async () => {
      const created = await fetchApiDomain<{ voiceId: string }>('/api/voice-clones/qwen3/design', {
        data: {
          description: description.trim(),
          ...(sampleText.trim() ? { sampleText: sampleText.trim() } : {}),
        },
        method: 'POST',
      })
      if (!created.ok) throw new Error(created.error || 'Failed to design the voice')
      const playback = await fetchApiDomain<{ signedUrl: string }>(
        `/api/voice-clones/qwen3/temporary/${created.data.voiceId}/playback`,
      )
      return {
        previewUrl: playback.ok ? playback.data.signedUrl : undefined,
        voiceId: created.data.voiceId,
      }
    },
    onError: (error) => toast.error(error.message.split('\n')[0] || 'Failed to design the voice'),
    onSuccess: setDesigned,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!designed) throw new Error('Design a voice first')
      const saved = await fetchApiDomain<UserVoiceClone>(
        `/api/voice-clones/qwen3/temporary/${designed.voiceId}/save`,
        { data: { name: name.trim() }, method: 'POST' },
      )
      if (!saved.ok) throw new Error(saved.error || 'Failed to save the voice')
      return saved.data
    },
    onError: (error) => toast.error(error.message.split('\n')[0] || 'Failed to save the voice'),
    onSuccess: (voice) => {
      toast.success('Your voice has been saved')
      onVoiceCreated({
        color: defaultColor,
        name: voice.name,
        provider: voice.provider,
        value: voice.voiceId,
        voiceCloneId: voice.id,
      })
      onClose()
    },
  })

  const canDesign = description.trim().length > 0 && !design.isPending
  const canSave = Boolean(designed) && name.trim().length > 0 && !save.isPending

  return (
    <Dialog
      classNames={{
        content:
          'z-[95] flex flex-col w-full h-[100dvh] max-w-none md:h-auto md:w-[560px] md:max-w-[calc(100vw-32px)] border-none bg-menu-background backdrop-blur-2xl p-6 md:rounded-sm',
        overlay: 'z-[94] backdrop-blur-[2px]',
      }}
      footer={null}
      ignoreInteractOutside={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
      open={open}
      showClose={true}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold leading-[21.8px] text-primary">Design a voice</h2>
            <EngineCostTag engine="qwen3" />
          </div>
          <p className="text-sm text-secondary md:text-xs">
            Describe the voice you want. Qwen3-TTS creates it and speaks an English sample you can
            keep.
          </p>
        </div>

        <Field label="Voice description">
          <textarea
            className={INPUT_CLASS}
            disabled={design.isPending}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={EXAMPLE_DESCRIPTION}
            rows={3}
            value={description}
          />
        </Field>

        <Field label="Sample text (optional)">
          <input
            className={INPUT_CLASS}
            disabled={design.isPending}
            maxLength={MAX_SAMPLE_TEXT_LENGTH}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder="What the sample says"
            value={sampleText}
          />
        </Field>

        <button
          className={cn(PRIMARY_BUTTON_CLASS, 'self-start')}
          disabled={!canDesign}
          onClick={() => {
            setDesigned(null)
            design.mutate()
          }}
          type="button"
        >
          {design.isPending ? 'Designing…' : designed ? 'Try again' : 'Design voice'}
        </button>

        {designed && (
          <div className="flex flex-col gap-4 rounded-sm border border-white/10 p-4">
            {designed.previewUrl ? (
              <audio className="w-full" controls src={designed.previewUrl} />
            ) : (
              <p className="text-sm text-secondary">The voice is ready. Name it to save it.</p>
            )}
            <Field label="Voice name">
              <input
                className={INPUT_CLASS}
                disabled={save.isPending}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="My narrator"
                value={name}
              />
            </Field>
            <button
              className={cn(PRIMARY_BUTTON_CLASS, 'self-end')}
              disabled={!canSave}
              onClick={() => save.mutate()}
              type="button"
            >
              {save.isPending ? 'Saving…' : 'Save voice'}
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

const INPUT_CLASS =
  'w-full rounded-sm border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'

const PRIMARY_BUTTON_CLASS =
  'flex h-[38px] min-w-[38px] items-center justify-center rounded-[10px] bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50'

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode
  className?: string
  label: string
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-secondary">{label}</span>
      {children}
    </label>
  )
}
