import { keyIsUnder, storeKeyOf, storeUri } from '../storage/stored-files'

/**
 * Where a user's own music lives: uploads and the AI-generated tracks saved from their
 * videos, one folder per user.
 */
export function musicTrackUri(userId: string, fileId: string): string {
  return storeUri(`music-tracks/${musicTrackOwner(userId)}/${fileId}.mp3`)
}

export function musicTrackOwner(userId: string): string {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** A file directly in this user's music folder, as the API and the workflows write them. */
export function isOwnMusicTrackUri(userId: string, uri: string): boolean {
  const key = storeKeyOf(uri)
  const folder = `music-tracks/${musicTrackOwner(userId)}`
  return !!key && keyIsUnder(key, folder) && /^[\w-]+\.mp3$/.test(key.slice(folder.length + 1))
}
