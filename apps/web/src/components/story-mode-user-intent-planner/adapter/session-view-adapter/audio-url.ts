import { isStoreUri, storeUriToUrl } from '@reelmakeeasy/common/storage/address'

const UIP_STORAGE_ROOT = 'user-intent-planner'

/**
 * The stable identity of a media URL: everything before the query string.
 *
 * Two URLs for the same object can differ only in their query (a version
 * parameter, for example), and the planner polls the session every 2s while SSE
 * is disconnected. Anything keyed off the raw URL (a cache, a React key, an
 * effect dependency) would churn whenever the query changes. Key off this
 * instead; it changes only when the underlying object does.
 */
export function mediaIdentityOf(url: string | undefined): string {
  return url?.split('?')[0] ?? ''
}

export function resolveAudioUrlFromPath(
  audioPath: null | string,
  sessionId: string | undefined,
  cdnOrigin?: string,
): string {
  const normalizedPath = audioPath?.trim() ?? ''
  if (!normalizedPath) {
    return ''
  }
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath
  }
  if (isStoreUri(normalizedPath)) {
    return storeUriToUrl(normalizedPath)
  }
  if (!cdnOrigin?.trim()) {
    return ''
  }

  const origin = cdnOrigin.replace(/\/+$/, '')
  const path = normalizedPath.replace(/^\/+/, '')

  if (path.startsWith('projects/')) {
    return `${origin}/${path}`
  }
  if (path.startsWith('story_loader/')) {
    if (!sessionId?.trim()) {
      return ''
    }
    return `${origin}/projects/${sessionId}/${path}`
  }
  if (!sessionId?.trim()) {
    return ''
  }
  // Paths that already carry the planner root are session-relative as-is; prefixing again would
  // yield `user-intent-planner/user-intent-planner/...`, which 404s silently. `preview_voiceover`
  // audio paths are stored this way (`user-intent-planner/voice-preview/<file>`).
  if (path.startsWith(`${UIP_STORAGE_ROOT}/`)) {
    return `${origin}/projects/${sessionId}/${path}`
  }
  return `${origin}/projects/${sessionId}/${UIP_STORAGE_ROOT}/${path}`
}

/**
 * Resolve the session's uploaded voice-over into a fetchable URL.
 *
 * Prefer an `audio_url` companion beside `audio_path` when the payload carries
 * one; otherwise compose the URL from the path. Mirrors
 * `resolveStoredVoiceoverTake`'s precedence for `preview_voiceover`.
 */
export function resolveSessionAudioUrl(
  state: { audio_path?: null | string; audio_url?: null | string },
  sessionId: string | undefined,
  cdnOrigin?: string,
): string {
  return (
    state.audio_url?.trim() ||
    resolveAudioUrlFromPath(state.audio_path ?? null, sessionId, cdnOrigin)
  )
}
