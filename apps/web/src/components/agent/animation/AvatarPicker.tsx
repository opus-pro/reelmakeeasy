'use client'

import type { AgentAnimationAvatar, AgentAvatar, AvatarStyle } from '@shared/types/api/agent'
import { Button, cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { ImagePlus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'

import { attachmentName, uploadAttachment } from '../attachments/attachments'
import { ChipRow, LABEL_CLASS } from '../motion/setup-parts'

import { AvatarVoice } from './AvatarVoice'

/** The avatar an Avatar video card is set to: a saved one, or a new one drawn from a photo. */
export type AvatarPick =
  | { id: string; kind: 'saved' }
  | {
      kind: 'new'
      name: string
      /** The photo once uploaded: its attachment name, and a local preview. */
      photo: null | { name: string; preview: string }
      style: AvatarStyle
    }

export const AVATAR_NAME_MAX = 40

const BOTH: readonly AvatarStyle[] = ['2d', '3d']

/** The first pick among the avatars drawn in `styles`: the newest, else a new one. */
export function firstAvatarPick(
  avatars: AgentAvatar[],
  styles: readonly AvatarStyle[] = BOTH,
): AvatarPick {
  const newest = avatars.find((a) => styles.includes(a.style))
  return newest
    ? { id: newest.id, kind: 'saved' }
    : { kind: 'new', name: '', photo: null, style: styles[0] ?? '2d' }
}

/** A pick that fits `styles` (the style picked on the card): the same one when it does, a new
 *  avatar redrawn in an allowed style (its photo and name kept), else the first fitting pick. */
export function fitAvatarPick(
  pick: AvatarPick,
  avatars: AgentAvatar[],
  styles: readonly AvatarStyle[],
): AvatarPick {
  if (pick.kind === 'new')
    return styles.includes(pick.style) ? pick : { ...pick, style: styles[0] ?? '2d' }
  const saved = avatars.find((a) => a.id === pick.id)
  return saved && styles.includes(saved.style) ? pick : firstAvatarPick(avatars, styles)
}

/** What the card sends for a pick, or null while a new one is missing its name or photo. */
export function avatarChoice(pick: AvatarPick): AgentAnimationAvatar | null {
  if (pick.kind === 'saved') return { id: pick.id }
  const name = pick.name.trim()
  if (!name || name.length > AVATAR_NAME_MAX || !pick.photo) return null
  return { name, photo: pick.photo.name, style: pick.style }
}

const TILE =
  'flex w-24 shrink-0 flex-col overflow-hidden rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50'

/**
 * The Avatar explainer's avatar: the user's saved avatars drawn in the picked style as picture
 * tiles (the picked one's voice under them, to listen to and change), and "New avatar" (a photo,
 * a name, and 2D or 3D where the style takes either), which Claude draws from the photo first.
 */
export function AvatarPicker({
  avatars,
  onPick,
  pick,
  sessionId,
  styles = BOTH,
}: {
  avatars: AgentAvatar[]
  onPick: (pick: AvatarPick) => void
  pick: AvatarPick
  sessionId: string
  /** The avatar styles the picked style takes: 2D takes 2D avatars, 3D 3D, Pixel art either. */
  styles?: readonly AvatarStyle[]
}) {
  const shown = avatars.filter((a) => styles.includes(a.style))
  const either = styles.length > 1
  const apiOrigin = useAtomValue(apiOriginAtom)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The last new avatar typed in, kept while a saved one is picked, so going back keeps it.
  const [draft, setDraft] = useState<Extract<AvatarPick, { kind: 'new' }>>(
    pick.kind === 'new' ? pick : { kind: 'new', name: '', photo: null, style: '2d' },
  )
  const preview = draft.photo?.preview
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  // Avatars whose voice was changed here, as saved.
  const [changed, setChanged] = useState<Record<string, AgentAvatar>>({})
  const picked =
    pick.kind === 'saved' ? (changed[pick.id] ?? avatars.find((a) => a.id === pick.id)) : undefined

  const setNew = (next: Extract<AvatarPick, { kind: 'new' }>) => {
    setDraft(next)
    onPick(next)
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
      const attachment = await uploadAttachment(apiOrigin, sessionId, file, attachmentName(file))
      setNew({ ...draft, photo: { name: attachment.name, preview: URL.createObjectURL(file) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Avatar</span>
      <div aria-label="Avatar" className="flex gap-2 overflow-x-auto pb-1" role="radiogroup">
        <button
          aria-checked={pick.kind === 'new'}
          className={cn(
            TILE,
            pick.kind === 'new'
              ? 'border-white/70 ring-1 ring-white/50'
              : 'border-white/10 hover:border-white/30',
          )}
          onClick={() => onPick(draft)}
          role="radio"
          type="button"
        >
          <span className="flex aspect-square w-full items-center justify-center bg-white/[0.04]">
            <Plus className="size-6 text-white/50" />
          </span>
          <span className="truncate px-2 py-1.5 text-xs font-medium text-primary">New avatar</span>
        </button>
        {shown.map((a) => (
          <button
            aria-checked={pick.kind === 'saved' && pick.id === a.id}
            aria-label={`${a.name} (${a.style.toUpperCase()})`}
            className={cn(
              TILE,
              pick.kind === 'saved' && pick.id === a.id
                ? 'border-white/70 ring-1 ring-white/50'
                : 'border-white/10 hover:border-white/30',
            )}
            key={a.id}
            onClick={() => onPick({ id: a.id, kind: 'saved' })}
            role="radio"
            type="button"
          >
            {a.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by the local API
              <img
                alt=""
                className="aspect-square w-full bg-white/5 object-cover"
                src={a.previewUrl}
              />
            ) : (
              <span className="flex aspect-square w-full items-center justify-center bg-white/[0.04] text-lg font-semibold text-white/40">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs font-medium text-primary">
              <span className="truncate">{a.name}</span>
              {either && (
                <span className="text-[10px] text-secondary">{a.style.toUpperCase()}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {picked && (
        <AvatarVoice
          avatar={picked}
          key={picked.id}
          onChange={(avatar) => setChanged((all) => ({ ...all, [avatar.id]: avatar }))}
        />
      )}
      {pick.kind === 'new' && (
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-xs text-secondary">
            Claude draws your avatar from a photo, checks it with you, and saves it with a voice
            that fits, the same in every video (you can change it after).
          </p>
          <div className="flex items-center gap-3">
            {pick.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the upload
              <img
                alt="The photo to draw the avatar from"
                className="size-16 rounded-lg object-cover"
                src={pick.photo.preview}
              />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-lg bg-white/[0.04]">
                <ImagePlus className="size-5 text-white/40" />
              </span>
            )}
            <div className="flex flex-col gap-1">
              <Button
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                size="sm"
                variant="secondary"
              >
                {uploading ? 'Uploading…' : pick.photo ? 'Change photo' : 'Add a photo'}
              </Button>
              <span className="text-xs text-tertiary">A clear photo, face to the camera.</span>
            </div>
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
          </div>
          {error && <p className="text-xs text-amber-400">{error}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>Name</span>
              <input
                className="w-40 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
                maxLength={AVATAR_NAME_MAX}
                onChange={(e) => setNew({ ...pick, name: e.target.value })}
                placeholder="e.g. Sam"
                value={pick.name}
              />
            </label>
            {either ? (
              <ChipRow
                label="Drawn in"
                onPick={(style) => setNew({ ...pick, style })}
                options={[
                  { label: '2D cartoon', value: '2d' as const },
                  { label: '3D figure', value: '3d' as const },
                ]}
                selected={pick.style}
              />
            ) : (
              <span className="pb-1 text-xs text-secondary">
                Drawn {pick.style === '3d' ? 'as a 3D figure' : 'as a 2D cartoon'}, like the style.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
