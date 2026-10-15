import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { AgentAttachment, AgentAttachmentKind } from '@shared/types/api/agent'

/**
 * Files sent with an agent chat message (pasted or picked in the chat box). Each is saved in
 * `attachments/` inside the chat's working folder, so Codex or Claude Code opens it like any
 * file of its own. The message lists every file's path; pictures also go to the model as
 * pictures (Codex's `localImage`, an image block for Claude Code).
 */

/** The biggest file a chat takes: room for a short video. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** Files per message. */
export const MAX_ATTACHMENTS = 10

const KIND_BY_EXT: Record<string, AgentAttachmentKind> = {
  '.aac': 'audio',
  '.avi': 'video',
  '.flac': 'audio',
  '.gif': 'image',
  '.heic': 'image',
  '.jpeg': 'image',
  '.jpg': 'image',
  '.m4a': 'audio',
  '.m4v': 'video',
  '.mkv': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.mp4': 'video',
  '.ogg': 'audio',
  '.png': 'image',
  '.wav': 'audio',
  '.webm': 'video',
  '.webp': 'image',
}

/** Pictures the models take as pictures (others still go by path). */
const MODEL_IMAGE_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function attachmentKind(name: string): AgentAttachmentKind {
  return KIND_BY_EXT[path.extname(name).toLowerCase()] ?? 'file'
}

/** The folder a chat's attachments are saved in, inside its working folder. */
export function attachmentsDir(workingDir: string): string {
  return path.join(workingDir, 'attachments')
}

/** The media type a model takes a picture as, or null when it goes by path only. */
export function modelImageType(name: string): null | string {
  return MODEL_IMAGE_TYPES[path.extname(name).toLowerCase()] ?? null
}

/**
 * A safe, unique name to save an upload as: the original's base name with anything but
 * letters, digits, `.`, `-` and `_` made `-`, and a short random tag so two `image.png`
 * pastes don't collide (`image-3fa9c2.png`). A name with no extension stays without one.
 */
export function attachmentFileName(original: string, tag = randomBytes(3).toString('hex')): string {
  const base = path.basename(original.replaceAll('\\', '/')).normalize('NFKC')
  const ext = path
    .extname(base)
    .replace(/[^A-Za-z0-9.]/g, '')
    .slice(0, 10)
  const stem =
    base
      .slice(0, base.length - path.extname(base).length)
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[.-]+|-+$/g, '')
      .slice(0, 60) || 'file'
  return `${stem}-${tag}${ext.toLowerCase()}`
}

/**
 * The saved attachment `name` in `dir`, or null: a plain file name (no folders, no dot
 * files) of a regular file whose real path is inside `dir`'s real path.
 */
export function resolveAttachment(dir: string, name: unknown): AgentAttachment | null {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name.startsWith('.'))
    return null
  try {
    const root = fs.realpathSync(dir)
    const real = fs.realpathSync(path.join(dir, name))
    if (path.dirname(real) !== root) return null
    const info = fs.statSync(real)
    if (!info.isFile()) return null
    return { kind: attachmentKind(name), name, path: real, size: info.size }
  } catch {
    return null
  }
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The message as the agent gets it: what the user typed, then each attached file's path. */
export function messageWithAttachments(text: string, attachments: AgentAttachment[]): string {
  if (!attachments.length) return text
  const lines = attachments.map((a) => `- ${a.path} (${a.kind}, ${readableSize(a.size)})`)
  const files = `The user attached ${attachments.length === 1 ? 'this file' : 'these files'} (saved on this computer; open them from these paths):\n${lines.join('\n')}`
  return text ? `${text}\n\n${files}` : files
}

/** A turn's input items: the text, then each picture a model takes as a picture. */
export type AgentTurnInput = { path: string; type: 'localImage' } | { text: string; type: 'text' }

export function turnInput(text: string, attachments: AgentAttachment[] = []): AgentTurnInput[] {
  return [
    { text: messageWithAttachments(text, attachments), type: 'text' },
    ...attachments
      .filter((a) => a.kind === 'image' && modelImageType(a.name))
      .map((a) => ({ path: a.path, type: 'localImage' as const })),
  ]
}
