// Clones created before the MiniMax accent-prompt fix (merged 2026-05-12 UTC)
// produce degraded audio. Round up to UTC midnight for a clean boundary.
export const VOICE_CLONE_EXPIRATION_CUTOFF = new Date('2026-05-13T00:00:00Z')

// Fails closed on invalid input -- unparsable timestamps count as expired.
export function isVoiceCloneExpiredByDate(createdAt: Date | string): boolean {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt)
  const createdMs = created.getTime()
  if (Number.isNaN(createdMs)) {
    return true
  }
  return createdMs < VOICE_CLONE_EXPIRATION_CUTOFF.getTime()
}
