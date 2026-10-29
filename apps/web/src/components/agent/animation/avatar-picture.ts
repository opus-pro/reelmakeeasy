import type { AgentAvatar } from '@shared/types/api/agent'

/** A saved avatar's picture, marked with when it was saved: a changed avatar's new picture is
 *  never the browser's cached old one. */
export function avatarPictureUrl(avatar: AgentAvatar): string | undefined {
  if (!avatar.previewUrl) return undefined
  const join = avatar.previewUrl.includes('?') ? '&' : '?'
  return `${avatar.previewUrl}${join}v=${encodeURIComponent(avatar.updatedAt)}`
}
