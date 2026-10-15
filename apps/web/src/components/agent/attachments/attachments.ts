import type { AgentAttachment } from '@shared/types/api/agent'

/** The API's limits (agent-attachments.ts): checked here first so a big file fails at once. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

/** A file in the chat box: uploading, ready to send, or failed (with why). */
export interface PendingAttachment {
  attachment?: AgentAttachment
  error?: string
  file: File
  id: string
  /** A local URL for the file, to open it before it's sent (revoked when removed or sent). */
  previewUrl?: string
  status: 'error' | 'ready' | 'uploading'
}

/** A pasted picture is named `image.png` by the browser: give it a name worth reading. */
export function attachmentName(file: File, now = new Date()): string {
  if (file.name && file.name !== 'image.png') return file.name
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const stamp = now.toISOString().slice(0, 19).replaceAll(':', '-').replace('T', ' ')
  return `Pasted image ${stamp}.${ext}`
}

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: File, alreadyAttached: number): null | string {
  if (alreadyAttached >= MAX_ATTACHMENTS) return `Attach up to ${MAX_ATTACHMENTS} files at a time.`
  if (file.size > MAX_ATTACHMENT_BYTES)
    return `Too big (${readableSize(file.size)}): attach files up to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`
  return null
}

/** The files a paste or drop carries (a copied picture arrives as a file too). */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  if (data.files.length) return [...data.files]
  return [...data.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/** `POST /api/agent/sessions/:id/attachments`: saves the file next to the chat's agent. */
export async function uploadAttachment(
  apiOrigin: string,
  sessionId: string,
  file: File,
  name: string,
): Promise<AgentAttachment> {
  const url = new URL(`/api/agent/sessions/${encodeURIComponent(sessionId)}/attachments`, apiOrigin)
  url.searchParams.set('name', name)
  const res = await fetch(url, {
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
    method: 'POST',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as null | { message?: unknown }
    throw new Error(typeof body?.message === 'string' ? body.message : "Couldn't attach that file")
  }
  return (await res.json()) as AgentAttachment
}
