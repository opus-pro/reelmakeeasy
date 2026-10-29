'use client'

import { AVATAR_STYLE_LABEL } from '@reelmakeeasy/common/animation/looks'
import type { AgentAnimationAvatar, AgentAvatar, AvatarStyle } from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import { LABEL_CLASS } from '../motion/setup-parts'

import { avatarPictureUrl } from './avatar-picture'
import { AvatarCreator } from './AvatarCreator'
import { AvatarEditor } from './AvatarEditor'
import { SelectedRing } from './SelectedRing'

/** The avatar an Avatar explainer card is set to: a saved one, or none yet (make one first). */
export type AvatarPick = { id: string; kind: 'saved' } | { kind: 'none' }

const ALL: readonly AvatarStyle[] = ['2d', '3d', 'pixel']

/** The first pick among the avatars drawn in `styles`: the newest, else none. */
export function firstAvatarPick(
  avatars: AgentAvatar[],
  styles: readonly AvatarStyle[] = ALL,
): AvatarPick {
  const newest = avatars.find((a) => styles.includes(a.style))
  return newest ? { id: newest.id, kind: 'saved' } : { kind: 'none' }
}

/** A pick that fits `styles` (the style picked on the card): the same one when it does, else the
 *  first fitting one. */
export function fitAvatarPick(
  pick: AvatarPick,
  avatars: AgentAvatar[],
  styles: readonly AvatarStyle[],
): AvatarPick {
  const saved = pick.kind === 'saved' ? avatars.find((a) => a.id === pick.id) : undefined
  return saved && styles.includes(saved.style) ? pick : firstAvatarPick(avatars, styles)
}

/** What the card sends for a pick, or null while there is none. */
export function avatarChoice(pick: AvatarPick): AgentAnimationAvatar | null {
  return pick.kind === 'saved' ? { id: pick.id } : null
}

const TILE =
  'flex w-24 shrink-0 flex-col overflow-hidden rounded-lg border text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-violet-300'
/** A tile's name strip: the same height on every tile, the name centred in it. */
const NAME =
  'flex h-8 min-w-0 items-center justify-center px-2 text-center text-xs font-medium text-primary'

/**
 * The Avatar explainer's avatar: the user's saved avatars as picture tiles, and "New avatar",
 * which opens the avatar creator (the avatar it makes is added here and picked). A tile's pencil
 * (on hover, and on the picked one) opens the avatar editor: its voice, and changes to its look.
 */
export function AvatarPicker({
  avatars,
  onCreated,
  onPick,
  onUpdated,
  pick,
  styles = ALL,
}: {
  avatars: AgentAvatar[]
  /** An avatar the creator just made: add it and pick it. */
  onCreated: (avatar: AgentAvatar) => void
  onPick: (pick: AvatarPick) => void
  /** An avatar the editor changed, as saved now. */
  onUpdated: (avatar: AgentAvatar) => void
  pick: AvatarPick
  /** The avatar styles the picked style takes. */
  styles?: readonly AvatarStyle[]
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AgentAvatar | null>(null)
  const shown = avatars.filter((a) => styles.includes(a.style))
  const either = styles.length > 1

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>Avatar</span>
      <div aria-label="Avatar" className="flex gap-2 overflow-x-auto pb-1" role="radiogroup">
        <button
          className={cn(TILE, 'border-dashed border-white/20 hover:border-white/40')}
          onClick={() => setCreating(true)}
          type="button"
        >
          <span className="flex aspect-[1/1] w-full shrink-0 items-center justify-center bg-white/[0.04]">
            <Plus className="size-6 text-white/50" />
          </span>
          <span className={NAME}>New avatar</span>
        </button>
        {shown.map((a) => {
          const picked = pick.kind === 'saved' && pick.id === a.id
          return (
            <div className="group relative w-24 shrink-0" key={a.id}>
              <button
                aria-checked={picked}
                aria-label={`${a.name} (${AVATAR_STYLE_LABEL[a.style]})`}
                className={cn(TILE, 'w-full border-white/10', !picked && 'hover:border-white/30')}
                onClick={() => onPick({ id: a.id, kind: 'saved' })}
                role="radio"
                type="button"
              >
                {a.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the local API
                  <img
                    alt=""
                    className="aspect-[1/1] w-full shrink-0 bg-white/5 object-cover"
                    src={avatarPictureUrl(a)}
                  />
                ) : (
                  <span className="flex aspect-[1/1] w-full shrink-0 items-center justify-center bg-white/[0.04] text-lg font-semibold text-white/40">
                    {a.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className={cn(NAME, 'gap-1')}>
                  <span className="truncate">{a.name}</span>
                  {either && (
                    <span className="text-[10px] text-secondary">
                      {AVATAR_STYLE_LABEL[a.style]}
                    </span>
                  )}
                </span>
              </button>
              {picked && <SelectedRing />}
              <button
                aria-label={`Edit ${a.name}`}
                className={cn(
                  'absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur-sm transition-opacity hover:bg-black/85 focus-visible:opacity-100',
                  picked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                onClick={() => setEditing(a)}
                title={`Edit ${a.name}`}
                type="button"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
      {!shown.length && (
        <p className="text-xs text-secondary">No avatar yet: make one with New avatar.</p>
      )}
      {editing && (
        <AvatarEditor
          avatar={editing}
          onClose={(saved) => {
            setEditing(null)
            if (saved) onUpdated(saved)
          }}
        />
      )}
      {creating && (
        <AvatarCreator
          onClose={() => setCreating(false)}
          onCreated={(avatar) => {
            setCreating(false)
            onCreated(avatar)
          }}
          open
          styles={styles}
        />
      )}
    </div>
  )
}
