'use client'

import { AVATAR_STYLE_LABEL } from '@reelmakeeasy/common/animation/looks'
import type { AgentAvatar, AgentSession } from '@shared/types/api/agent'
import { Button, Dialog } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import { AgentChat } from '../AgentChat'
import { LABEL_CLASS } from '../motion/setup-parts'
import { useAgentSession } from '../useAgentSession'

import { avatarPictureUrl } from './avatar-picture'
import { AvatarVoice } from './AvatarVoice'

const CHANGE_MAX = 600

/**
 * The avatar editor, from a saved avatar's pencil: its voice to listen to and change, and "Change
 * how it looks". Update starts Claude on it in a chat of its own, shown here: Claude changes the
 * saved avatar, checks it, asks to keep it and saves it over the same avatar. The user can ask
 * for more changes in that chat, and edit it again any time. Closing hands back the avatar as
 * saved now.
 */
export function AvatarEditor({
  avatar: initial,
  onClose,
}: {
  avatar: AgentAvatar
  /** Closed: the avatar as saved now (its voice, or a new picture), or null when it is gone. */
  onClose: (avatar: AgentAvatar | null) => void
}) {
  const { fetchApiDomain } = useApi()
  const [avatar, setAvatar] = useState(initial)
  const [change, setChange] = useState('')
  const [sessionId, setSessionId] = useState<null | string>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<null | string>(null)

  // The avatar as saved now: undefined when that can't be read, null when it is gone.
  const fetchSaved = async (): Promise<AgentAvatar | null | undefined> => {
    const res = await fetchApiDomain<AgentAvatar[]>('/api/agent/avatars', {
      method: 'GET',
      noThrowError: true,
    })
    return res.ok && res.data ? (res.data.find((a) => a.id === avatar.id) ?? null) : undefined
  }
  const close = async () => {
    const saved = await fetchSaved()
    onClose(saved === undefined ? avatar : saved)
  }
  // Claude's turn ended: show the picture as saved now.
  const refresh = async () => {
    const saved = await fetchSaved()
    if (saved) setAvatar(saved)
  }

  const update = async () => {
    const asked = change.trim()
    if (!asked || pending) return
    setPending(true)
    setError(null)
    try {
      const made = await fetchApiDomain<AgentSession>('/api/agent/sessions', {
        data: { harness: 'claude', mode: 'animation', title: `Edit avatar: ${avatar.name}` },
        method: 'POST',
      })
      const res = await fetchApiDomain('/api/agent/sessions/{id}/animation', {
        data: {
          avatar: { id: avatar.id },
          avatarChange: asked,
          avatarOnly: true,
          lengthSec: 15,
          lookId: 'avatar',
          music: { source: 'none' },
          subject: null,
        },
        method: 'POST',
        noThrowError: true,
        pathParams: { id: made.data.id },
      })
      if (!res.ok) throw new Error(res.error || "Couldn't start the change. Try again.")
      setSessionId(made.data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      classNames={{
        content:
          'bg-[rgba(40,40,46,0.92)] backdrop-blur-2xl text-white border border-white/10 w-[92%] max-w-[640px] flex flex-col gap-y-1 rounded-xl p-6 z-[64] max-h-[min(760px,calc(100dvh-48px))]',
        description: 'text-secondary',
        header: 'mb-2',
        overlay: 'z-[63]',
      }}
      description="Change its voice, or ask Claude to change how it looks."
      onOpenChange={(next) => !next && void close()}
      open
      title={`Edit ${avatar.name}`}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-3">
          {avatar.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the local API
            <img
              alt=""
              className="size-16 shrink-0 rounded-lg bg-white/5 object-cover"
              src={avatarPictureUrl(avatar)}
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-lg font-semibold text-white/40">
              {avatar.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="flex flex-col">
            <span className="text-base font-medium text-primary">{avatar.name}</span>
            <span className="text-xs text-secondary">{AVATAR_STYLE_LABEL[avatar.style]}</span>
          </span>
        </div>
        <AvatarVoice avatar={avatar} onChange={setAvatar} />
        {sessionId ? (
          <EditChat onTurnEnd={() => void refresh()} sessionId={sessionId} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS} htmlFor="avatar-change">
              Change how it looks
            </label>
            <textarea
              className="min-h-[72px] resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-white/30 focus:outline-none"
              id="avatar-change"
              maxLength={CHANGE_MAX}
              onChange={(e) => setChange(e.target.value)}
              placeholder="e.g. shorter hair, a blue jacket, round glasses"
              value={change}
            />
            <span className="text-xs text-tertiary">
              Claude changes just that, checks it with you, and saves it over this avatar.
            </span>
          </div>
        )}
        {error && <p className="text-xs text-amber-400">{error}</p>}
        <div className="mt-auto flex items-center justify-end gap-3 pt-1">
          {sessionId ? (
            <Button onClick={() => void close()} size="sm">
              Done
            </Button>
          ) : (
            <Button disabled={!change.trim() || pending} onClick={() => void update()} size="sm">
              {pending ? 'Starting…' : 'Update avatar'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** Claude changing the avatar, in its own chat: ask for more changes there. */
function EditChat({ onTurnEnd, sessionId }: { onTurnEnd: () => void; sessionId: string }) {
  const agent = useAgentSession(sessionId)
  const status = agent.session?.status
  const was = useRef(status)
  useEffect(() => {
    if (was.current === 'running' && status !== 'running') onTurnEnd()
    was.current = status
  }, [onTurnEnd, status])
  return (
    <div className="h-[420px] min-h-0 overflow-hidden rounded-lg border border-white/10">
      <AgentChat agent={agent} embedded sessionId={sessionId} />
    </div>
  )
}
