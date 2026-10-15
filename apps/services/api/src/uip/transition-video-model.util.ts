import { resolveModel } from '@reelmakeeasy/llm/registry'

/**
 * Resolve the transition video model to persist: the registry key for
 * the requested id (legacy ids resolve to the video.firstLast role), or null
 * when nothing is requested, which means "the default" and must not be pinned.
 * Shared by UIP session create, the post-creation update path and the Story
 * Mode start/regen paths so they resolve the same way.
 */
export function resolveTransitionVideoModel(requested: null | string | undefined): null | string {
  const trimmed = requested?.trim()
  if (!trimmed) {
    return null
  }
  return resolveModel('video', trimmed, { role: 'video.firstLast' }).key
}
