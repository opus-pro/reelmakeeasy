import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { AVATAR_STYLES } from '@reelmakeeasy/common/animation/looks'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { filePath } from '@reelmakeeasy/common/storage/file-store'
import type { AgentAvatar, AvatarStyle } from '@shared/types/api/agent'

/**
 * Saved avatars: the digital avatars Claude drew from the user's photos, kept for every later
 * Avatar video. Each is a folder of stored files, `avatars/<id>/`:
 * - `avatar.json`: its name, style, voice (its fixed voice's id, and how it sounds) and dates;
 * - `avatar.ts`: the rig, Claude's code (the project's `src/avatar/avatar.ts`);
 * - `preview.png`: its picture for the card;
 * - `photo.<ext>`: the photo it was drawn from;
 * - `voice.wav` + `voice.txt`: the voice made from its description and what it says, for an
 *   avatar with no fixed voice (its lines are cloned from it).
 */

export const AVATAR_FOLDER = 'avatars'

const ID = /^av-[a-f0-9]{10}$/

/** What `avatar.json` holds. */
export type AvatarRecord = {
  createdAt: string
  id: string
  /** How the user described it in the avatar creator, when they did. */
  look?: string
  name: string
  style: AvatarStyle
  updatedAt: string
  /** The voice's description, as its sample was made from it. */
  voice: string
  /** Its fixed voice (a voice library id), when it has one: every line is spoken in it. */
  voiceId?: string
}

export const isAvatarId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

export const newAvatarId = (): string => `av-${randomBytes(5).toString('hex')}`

/** The avatar's folder on disk (stored files). */
export function avatarDir(id: string): string {
  if (!isAvatarId(id)) throw new Error(`Not an avatar id: ${id}`)
  return filePath(`${AVATAR_FOLDER}/${id}`)
}

/** A saved avatar's record, or null when there is none. */
export function readAvatar(id: string): AvatarRecord | null {
  if (!isAvatarId(id)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(avatarDir(id), 'avatar.json'), 'utf8')) as
      | Partial<AvatarRecord>
      | undefined
    if (
      !raw ||
      typeof raw.name !== 'string' ||
      !AVATAR_STYLES.includes(raw.style as AvatarStyle) ||
      !fs.existsSync(path.join(avatarDir(id), 'avatar.ts'))
    )
      return null
    return {
      createdAt: raw.createdAt ?? new Date(0).toISOString(),
      id,
      ...(typeof raw.look === 'string' && raw.look.trim() ? { look: raw.look.trim() } : {}),
      name: raw.name,
      style: raw.style as AvatarStyle,
      updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
      voice: typeof raw.voice === 'string' ? raw.voice : '',
      ...(typeof raw.voiceId === 'string' && raw.voiceId.trim()
        ? { voiceId: raw.voiceId.trim() }
        : {}),
    }
  } catch {
    return null
  }
}

/** Every saved avatar, newest first, as the card shows them. */
export function listAvatars(): AgentAvatar[] {
  let names: string[]
  try {
    names = fs.readdirSync(filePath(AVATAR_FOLDER))
  } catch {
    return []
  }
  return names
    .map(readAvatar)
    .filter((a): a is AvatarRecord => !!a)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({
      createdAt: a.createdAt,
      id: a.id,
      look: a.look ?? '',
      name: a.name,
      previewUrl: fs.existsSync(path.join(avatarDir(a.id), 'preview.png'))
        ? storeUri(`${AVATAR_FOLDER}/${a.id}/preview.png`)
        : null,
      style: a.style,
      updatedAt: a.updatedAt,
      voiceDescription: a.voice,
      voiceId: a.voiceId ?? null,
      voiceSampleUrl: avatarVoice(a.id)?.wav ?? null,
    }))
}

/** The photo a saved avatar was drawn from, when it has one (a file on disk). */
export function savedAvatarPhoto(id: string): null | string {
  const dir = avatarDir(id)
  try {
    const name = fs.readdirSync(dir).find((n) => n.startsWith('photo.'))
    return name ? path.join(dir, name) : null
  } catch {
    return null
  }
}

/** A saved avatar's voice sample, when it has one: the WAV's address and what it says. */
export function avatarVoice(id: string): null | { text: string; wav: string } {
  const dir = avatarDir(id)
  try {
    const text = fs.readFileSync(path.join(dir, 'voice.txt'), 'utf8').trim()
    if (!text || !fs.existsSync(path.join(dir, 'voice.wav'))) return null
    return { text, wav: storeUri(`${AVATAR_FOLDER}/${id}/voice.wav`) }
  } catch {
    return null
  }
}

/**
 * Saves an avatar (new, or over the one with this id): its rig and preview, and the photo and
 * voice sample when given (else the ones it has are kept).
 */
export function saveAvatar(o: {
  id: string
  /** How the user described it; unset keeps the one it has. */
  look?: string
  name: string
  photo?: string
  preview: string
  rig: string
  style: AvatarStyle
  voice: string
  /** Its fixed voice; unset keeps the one it has. */
  voiceId?: string
  voiceSample?: { text: string; wav: string }
}): AvatarRecord {
  const dir = avatarDir(o.id)
  fs.mkdirSync(dir, { recursive: true })
  const before = readAvatar(o.id)
  const now = new Date().toISOString()
  const record: AvatarRecord = {
    createdAt: before?.createdAt ?? now,
    id: o.id,
    ...((o.look ?? before?.look) ? { look: o.look ?? before?.look } : {}),
    name: o.name,
    style: o.style,
    updatedAt: now,
    voice: o.voice,
    ...((o.voiceId ?? before?.voiceId) ? { voiceId: o.voiceId ?? before?.voiceId } : {}),
  }
  fs.copyFileSync(o.rig, path.join(dir, 'avatar.ts'))
  fs.copyFileSync(o.preview, path.join(dir, 'preview.png'))
  if (o.photo) {
    for (const old of fs.readdirSync(dir).filter((n) => n.startsWith('photo.')))
      fs.rmSync(path.join(dir, old))
    fs.copyFileSync(o.photo, path.join(dir, `photo${path.extname(o.photo).toLowerCase()}`))
  }
  if (o.voiceSample) {
    fs.copyFileSync(o.voiceSample.wav, path.join(dir, 'voice.wav'))
    fs.writeFileSync(path.join(dir, 'voice.txt'), `${o.voiceSample.text}\n`)
    // A fal speaker embedding made from the old sample no longer matches it.
    fs.rmSync(path.join(dir, 'voice.safetensors'), { force: true })
  }
  fs.writeFileSync(path.join(dir, 'avatar.json'), `${JSON.stringify(record, null, 1)}\n`)
  return record
}

/** Gives a saved avatar its fixed voice (null: back to the voice made from its description);
 *  null when there is no such avatar. */
export function setAvatarVoice(id: string, voiceId: null | string): AvatarRecord | null {
  const before = readAvatar(id)
  if (!before) return null
  const record: AvatarRecord = {
    createdAt: before.createdAt,
    id: before.id,
    ...(before.look ? { look: before.look } : {}),
    name: before.name,
    style: before.style,
    updatedAt: new Date().toISOString(),
    voice: before.voice,
    ...(voiceId ? { voiceId } : {}),
  }
  fs.writeFileSync(path.join(avatarDir(id), 'avatar.json'), `${JSON.stringify(record, null, 1)}\n`)
  return record
}

/** Deletes a saved avatar; false when there is none. */
export function deleteAvatar(id: string): boolean {
  if (!readAvatar(id)) return false
  fs.rmSync(avatarDir(id), { force: true, recursive: true })
  return true
}
