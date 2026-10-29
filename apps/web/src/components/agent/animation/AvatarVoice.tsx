'use client'

import type { AgentAvatar } from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { Pause, Play } from 'lucide-react'
import { useState } from 'react'

import {
  usePresetVoiceOptions,
  useUserVoiceClones,
  useVoicePreviewUrl,
  type VoiceOption,
  VoiceSelectionDialog,
} from '@/components/voice'
import { useApi } from '@/hooks/useApi'
import { useAudio } from '@/hooks/useAudio'

import { LABEL_CLASS } from '../motion/setup-parts'

/**
 * A saved avatar's voice on the setup card: its fixed voice (or the one made from its
 * description) to listen to, and "Change voice", the app's voice library (presets and the user's
 * own voices). The pick is saved to the avatar, so every later video with it speaks in it.
 */
export function AvatarVoice({
  avatar,
  onChange,
}: {
  avatar: AgentAvatar
  /** The avatar as saved with its new voice. */
  onChange: (avatar: AgentAvatar) => void
}) {
  const { fetchApiDomain } = useApi()
  const { options } = usePresetVoiceOptions()
  const { userVoices } = useUserVoiceClones()
  const { playingId, toggle } = useAudio()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const option: undefined | VoiceOption = avatar.voiceId
    ? [...userVoices, ...options].find((v) => v.value === avatar.voiceId)
    : undefined
  const signed = useVoicePreviewUrl(avatar.voiceId ?? '', option?.needsPresignedUrl)
  const preview = avatar.voiceId
    ? option?.needsPresignedUrl
      ? signed.data?.signedUrl
      : option?.previewAudioUrl
    : (avatar.voiceSampleUrl ?? undefined)
  const playId = `avatar-voice:${avatar.id}:${avatar.voiceId ?? 'own'}`
  const playing = playingId === playId

  const save = async (voiceId: null | string) => {
    setSaving(true)
    setError(null)
    const res = await fetchApiDomain<AgentAvatar>(
      `/api/agent/avatars/${encodeURIComponent(avatar.id)}/voice`,
      { data: { voiceId }, method: 'PUT', noThrowError: true },
    )
    setSaving(false)
    if (res.ok && res.data) onChange(res.data)
    else setError(res.error || "Couldn't save the voice. Try again.")
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Voice</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-label={playing ? 'Pause the voice' : 'Play the voice'}
          className={cn(
            'flex size-7 items-center justify-center rounded-full border border-white/15 text-primary transition-colors hover:border-white/40',
            !preview && 'cursor-not-allowed opacity-40',
          )}
          disabled={!preview}
          onClick={() => preview && toggle(playId, preview)}
          type="button"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <span className="text-sm font-medium text-primary">
          {avatar.voiceId ? (option?.name ?? 'Its voice') : 'Made from its description'}
        </span>
        {option?.tone && <span className="text-xs text-secondary">{option.tone}</span>}
        <Button disabled={saving} onClick={() => setOpen(true)} size="sm" variant="secondary">
          {saving ? 'Saving…' : avatar.voiceId ? 'Change voice' : 'Pick a voice'}
        </Button>
      </div>
      <span className="text-xs text-tertiary">
        {avatar.voiceId
          ? `${avatar.name} speaks in this voice in every video.`
          : `Made from "${avatar.voiceDescription}", so it can sound a little different each time. Pick a voice and ${avatar.name} sounds the same in every video.`}
      </span>
      {error && <span className="text-xs text-amber-400">{error}</span>}
      {open && (
        <VoiceSelectionDialog
          onOpenChange={setOpen}
          onVoiceConfirm={(voice) => {
            if (voice && voice.value !== avatar.voiceId) void save(voice.value)
          }}
          onVoiceSelect={() => undefined}
          open={open}
          selectedVoice={avatar.voiceId}
        />
      )}
    </div>
  )
}
