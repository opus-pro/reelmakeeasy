'use client'

import {
  AVATAR_GENDERS,
  AVATAR_NAME_MAX,
  AVATAR_STYLE_LABEL,
  AVATAR_STYLES,
  avatarStyleFromDescription,
} from '@reelmakeeasy/common/animation/looks'
import { VIDEO_DEFAULT_DETAIL } from '@reelmakeeasy/common/motion-reel/video-detail'
import type {
  AgentAvatar,
  AgentSession,
  AvatarGender,
  AvatarStyle,
  VideoDetail,
} from '@shared/types/api/agent'
import { Button, cn, Dialog } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { Check, ImagePlus, Pause, PenLine, Play, Sparkles } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { usePresetVoiceOptions, type VoiceOption, VoiceSelectionDialog } from '@/components/voice'
import { useApi } from '@/hooks/useApi'
import { useAudio } from '@/hooks/useAudio'

import { AgentChat } from '../AgentChat'
import { attachmentName, uploadAttachment } from '../attachments/attachments'
import { DetailPicker, LABEL_CLASS } from '../motion/setup-parts'
import { useAgentSession } from '../useAgentSession'

const DESCRIPTION_MAX = 600

/** What each detail level means for an avatar. */
const AVATAR_DETAIL: Record<VideoDetail, string> = {
  high: 'Rich: shading and highlights, hair in locks, seams and buttons, the small things that make them them.',
  low: 'Simple: a few flat shapes; the likeness is in the hair, the colours and the clothes.',
  medium:
    'Clear: the face shape, the hair style, the brows and eyes, the clothes with their collar or pattern.',
  xhigh:
    'The finest: every lock of hair lit, the lids and lashes, fabric folds and accessories, all moving with the pose.',
}

/**
 * The avatar creator, its own step before any video: a name; a photo and/or a description (drawn
 * in 3D or pixel art when it says so, else 2D), or Surprise me (2D, 3D or Pixel art, male or
 * female, and Claude makes up the rest); the detail and its voice. Generate
 * starts Claude on it in a chat of its own, shown here: Claude draws it, checks it, asks to keep
 * it, and saves it; "Use this avatar" then picks it on the card.
 */
export function AvatarCreator({
  onClose,
  onCreated,
  open,
  styles,
}: {
  onClose: () => void
  onCreated: (avatar: AgentAvatar) => void
  open: boolean
  /** The avatar styles the video's style takes, its own first (Surprise me starts on it). */
  styles: readonly AvatarStyle[]
}) {
  const [sessionId, setSessionId] = useState<null | string>(null)
  const [making, setMaking] = useState(false)
  return (
    <Dialog
      classNames={{
        content:
          'bg-[rgba(40,40,46,0.92)] backdrop-blur-2xl text-white border border-white/10 w-[92%] max-w-[640px] flex flex-col gap-y-1 rounded-xl p-6 z-[64] h-[min(760px,calc(100dvh-48px))]',
        description: 'text-secondary',
        header: 'mb-2',
        overlay: 'z-[63]',
      }}
      description={
        making
          ? 'Claude draws it, checks it with you, and saves it for every video.'
          : 'Claude draws it once, checks it with you, and saves it for every video.'
      }
      onOpenChange={(next) => !next && onClose()}
      open={open}
      title="Create an avatar"
    >
      {making && sessionId ? (
        <MakingAvatar onCreated={onCreated} sessionId={sessionId} />
      ) : (
        <AvatarForm
          onSession={setSessionId}
          onStarted={() => setMaking(true)}
          sessionId={sessionId}
          styles={styles}
        />
      )}
    </Dialog>
  )
}

/** How the user gives the avatar's look: a photo and/or a description, or Surprise me. */
type LookWay = 'describe' | 'surprise'

/** Ideas to start a description from, one per way an avatar can be drawn. */
const IDEAS = [
  {
    label: '2D cartoon chef',
    text: 'A 2D cartoon chef with a curly mustache, rosy cheeks and a tall white hat',
  },
  {
    label: '3D robot',
    text: 'A friendly 3D robot with a round head, big glowing blue eyes and a little antenna',
  },
  {
    label: 'Pixel-art knight',
    text: 'A pixel-art knight in shiny blue armour, with a red cape and a big grin',
  },
] as const

const GENDER_LABEL: Record<AvatarGender, string> = { female: 'Female', male: 'Male' }

function AvatarForm({
  onSession,
  onStarted,
  sessionId,
  styles,
}: {
  onSession: (id: string) => void
  onStarted: () => void
  sessionId: null | string
  styles: readonly AvatarStyle[]
}) {
  const apiOrigin = useAtomValue(apiOriginAtom)
  const { fetchApiDomain } = useApi()
  const [name, setName] = useState('')
  const [way, setWay] = useState<LookWay>('describe')
  const [photo, setPhoto] = useState<null | { name: string; preview: string }>(null)
  const [description, setDescription] = useState('')
  // Surprise me: 2D, 3D or Pixel art (the video's own first) and a gender.
  const [kind, setKind] = useState<AvatarStyle>(styles[0] ?? '2d')
  const [gender, setGender] = useState<AvatarGender | null>(null)
  const [detail, setDetail] = useState<VideoDetail>(VIDEO_DEFAULT_DETAIL)
  const [voice, setVoice] = useState<null | VoiceOption>(null)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const preview = photo?.preview
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const drawn = avatarStyleFromDescription(description)

  // The creator's own chat, made on the first photo or on Generate.
  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId
    const res = await fetchApiDomain<AgentSession>('/api/agent/sessions', {
      data: { harness: 'claude', mode: 'animation', title: `Avatar: ${name.trim() || 'new'}` },
      method: 'POST',
    })
    onSession(res.data.id)
    return res.data.id
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Pick a photo (JPG, PNG or WebP).')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const id = await ensureSession()
      const attachment = await uploadAttachment(apiOrigin, id, file, attachmentName(file))
      setPhoto({ name: attachment.name, preview: URL.createObjectURL(file) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const missing = !name.trim()
    ? 'Give it a name.'
    : way === 'surprise'
      ? gender
        ? null
        : 'Pick male or female.'
      : photo || description.trim()
        ? null
        : 'Add a photo, or describe how it looks.'
  const ready = !missing && !uploading
  const generate = async () => {
    if (!ready || pending) return
    setPending(true)
    setError(null)
    try {
      const id = await ensureSession()
      const avatar =
        way === 'surprise'
          ? { gender, name: name.trim(), style: kind }
          : {
              ...(description.trim() ? { description: description.trim() } : {}),
              name: name.trim(),
              ...(photo ? { photo: photo.name } : {}),
              style: drawn,
            }
      const res = await fetchApiDomain('/api/agent/sessions/{id}/animation', {
        data: {
          avatar,
          avatarOnly: true,
          ...(voice ? { avatarVoiceId: voice.value } : {}),
          detail,
          lengthSec: 15,
          lookId: 'avatar',
          music: { source: 'none' },
          subject: null,
        },
        method: 'POST',
        noThrowError: true,
        pathParams: { id },
      })
      if (!res.ok) throw new Error(res.error || "Couldn't start the avatar. Try again.")
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex flex-col gap-1.5">
        <label className={LABEL_CLASS} htmlFor="avatar-name">
          Name
        </label>
        <input
          className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
          id="avatar-name"
          maxLength={AVATAR_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sam"
          value={name}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className={LABEL_CLASS}>How it looks</span>
        <Choices
          label="How it looks"
          onPick={setWay}
          options={[
            { icon: <PenLine className="size-4" />, label: 'Describe it', value: 'describe' },
            { icon: <Sparkles className="size-4" />, label: 'Surprise me', value: 'surprise' },
          ]}
          selected={way}
        />
      </div>
      {way === 'describe' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-stretch gap-3">
            <button
              aria-label={photo ? 'Change the photo' : 'Add a photo'}
              className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-white/25 bg-white/[0.04] text-xs text-white/50 transition-colors hover:border-white/50"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the upload
                <img alt="" className="size-full object-cover" src={photo.preview} />
              ) : (
                <>
                  <ImagePlus className="size-6" />
                  {uploading ? 'Uploading…' : 'Photo'}
                </>
              )}
            </button>
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label="Photo for the avatar"
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files?.[0])
                e.target.value = ''
              }}
              ref={fileRef}
              type="file"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label className={LABEL_CLASS} htmlFor="avatar-description">
                {photo ? 'Describe it (optional)' : 'Describe how it looks'}
              </label>
              <textarea
                className="min-h-[72px] flex-1 resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
                id="avatar-description"
                maxLength={DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  photo
                    ? 'e.g. in a red hoodie, with round glasses'
                    : 'e.g. a cheerful woman in her 30s, curly red hair, round glasses, a green sweater'
                }
                value={description}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-tertiary">Ideas:</span>
            {IDEAS.map((idea) => (
              <button
                className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-secondary transition-colors hover:border-white/30 hover:text-primary"
                key={idea.label}
                onClick={() => setDescription(idea.text)}
                type="button"
              >
                {idea.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-tertiary">
            A photo of someone, a description, or both. Drawn in {AVATAR_STYLE_LABEL[drawn]}
            {drawn === '2d' ? ': say 3D or pixel art to draw it that way.' : '.'}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className={LABEL_CLASS}>Kind</span>
            <Choices
              label="Kind"
              onPick={setKind}
              options={AVATAR_STYLES.map((value) => ({
                label: AVATAR_STYLE_LABEL[value],
                recommended: value !== '3d',
                value,
              }))}
              selected={kind}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className={LABEL_CLASS}>Gender</span>
            <Choices
              label="Gender"
              onPick={setGender}
              options={AVATAR_GENDERS.map((value) => ({ label: GENDER_LABEL[value], value }))}
              selected={gender}
            />
          </div>
          <span className="text-xs text-tertiary">
            Claude makes up the rest: the face, hair, clothes and colours.
          </span>
        </div>
      )}
      <DetailPicker
        detail={detail}
        footnote="More detail takes longer to draw, and looks more like them."
        meanings={AVATAR_DETAIL}
        onPick={setDetail}
      />
      <VoicePick onPick={setVoice} voice={voice} />
      {error && <p className="text-xs text-amber-400">{error}</p>}
      <div className="mt-auto flex items-center justify-end gap-3 pt-2">
        {missing && !pending && <span className="mr-auto text-xs text-secondary">{missing}</span>}
        <Button disabled={!ready || pending} onClick={() => void generate()} size="sm">
          {pending ? 'Starting…' : 'Generate avatar'}
        </Button>
      </div>
    </div>
  )
}

/** One choice of a few, as large buttons (a radio group), "Recommended" on those it suits. */
function Choices<T extends string>({
  label,
  onPick,
  options,
  selected,
}: {
  label: string
  onPick: (value: T) => void
  options: readonly { icon?: ReactNode; label: string; recommended?: boolean; value: T }[]
  selected: null | T
}) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          aria-checked={o.value === selected}
          aria-label={o.label}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
            o.value === selected
              ? 'border-violet-300 bg-violet-400/15 text-primary shadow-[inset_0_0_0_1px_rgb(196_181_253)]'
              : 'border-white/10 text-secondary hover:border-white/30 hover:text-primary',
          )}
          key={o.value}
          onClick={() => onPick(o.value)}
          role="radio"
          type="button"
        >
          {o.icon}
          {o.label}
          {o.recommended && (
            <span className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
              Recommended
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** The new avatar's voice: one the user picks from the voice library, or Claude's pick. */
function VoicePick({
  onPick,
  voice,
}: {
  onPick: (voice: null | VoiceOption) => void
  voice: null | VoiceOption
}) {
  const [open, setOpen] = useState(false)
  const { options } = usePresetVoiceOptions()
  const { playingId, toggle } = useAudio()
  const preview =
    voice?.previewAudioUrl ?? options.find((o) => o.value === voice?.value)?.previewAudioUrl
  const playId = `creator-voice:${voice?.value ?? ''}`
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Voice</span>
      <div className="flex flex-wrap items-center gap-2">
        {voice && (
          <button
            aria-label={playingId === playId ? 'Pause the voice' : 'Play the voice'}
            className={cn(
              'flex size-7 items-center justify-center rounded-full border border-white/15 text-primary hover:border-white/40',
              !preview && 'cursor-not-allowed opacity-40',
            )}
            disabled={!preview}
            onClick={() => preview && toggle(playId, preview)}
            type="button"
          >
            {playingId === playId ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
        )}
        <span className="text-sm text-primary">
          {voice ? voice.name : 'Claude picks one that fits'}
        </span>
        <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
          {voice ? 'Change voice' : 'Pick a voice'}
        </Button>
      </div>
      <span className="text-xs text-tertiary">It speaks in this voice in every video.</span>
      {open && (
        <VoiceSelectionDialog
          onOpenChange={setOpen}
          onVoiceConfirm={(picked) => picked && onPick(picked)}
          onVoiceSelect={() => undefined}
          open={open}
          selectedVoice={voice?.value ?? null}
        />
      )}
    </div>
  )
}

/** Claude at work on the avatar, in its own chat; once it is saved, "Use this avatar". */
function MakingAvatar({
  onCreated,
  sessionId,
}: {
  onCreated: (avatar: AgentAvatar) => void
  sessionId: string
}) {
  const agent = useAgentSession(sessionId)
  const { fetchApiDomain } = useApi()
  const [error, setError] = useState<null | string>(null)
  // Saved: the chat's setup now names the avatar by its id.
  const saved = [...agent.transcript.entries]
    .reverse()
    .find((e) => e.kind === 'animation_setup' && e.setup?.avatar && 'id' in e.setup.avatar)
  const savedId =
    saved?.kind === 'animation_setup' && saved.setup?.avatar && 'id' in saved.setup.avatar
      ? saved.setup.avatar.id
      : null
  const use = async () => {
    const res = await fetchApiDomain<AgentAvatar[]>('/api/agent/avatars', {
      method: 'GET',
      noThrowError: true,
    })
    const avatar = res.data?.find((a) => a.id === savedId)
    if (avatar) onCreated(avatar)
    else setError("Couldn't find the saved avatar. Try again.")
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10">
        <AgentChat agent={agent} embedded sessionId={sessionId} />
      </div>
      {savedId && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-300/40 bg-violet-400/10 px-3 py-2">
          <Check className="size-4 text-violet-300" />
          <span className="text-sm text-primary">Your avatar is saved.</span>
          <Button className="ml-auto" onClick={() => void use()} size="sm">
            Use this avatar
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}
