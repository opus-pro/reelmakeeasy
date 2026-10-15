import { fallbacksFor, resolveModel, resolveRole, type VideoRole } from '@reelmakeeasy/llm/registry'

/**
 * The registry key serving a video role (`reelmakeeasy.models.json`). Throws when
 * the role is disabled (`null`).
 */
export function videoModelForRole(role: VideoRole): string {
  const resolved = resolveRole(role)
  if (!resolved) {
    throw new Error(`No video model is configured for role ${role} (roles.${role} is null)`)
  }
  return resolved.key
}

/** The model Story Mode transitions generate on when none is picked: the `video.firstLast` role. */
export function getDefaultVideoModelId(): string {
  return videoModelForRole('video.firstLast')
}

// Registry fallbacks for the roles this model serves, as registry keys. A legacy
// or unknown id resolves to the `video.firstLast` default first.
export function getVideoModelFallbackChain(modelId: null | string | undefined): string[] {
  if (!modelId) {
    return []
  }
  const key = validateVideoModelId(modelId)
  return [...new Set(fallbacksFor(key).map((m) => m.key))].filter((k) => k !== key)
}

// The fal endpoint the model's first-last mode calls, or undefined when it has none.
export function getVideoProviderModelId(modelId: null | string | undefined): string | undefined {
  if (!modelId) {
    return undefined
  }
  return resolveModel('video', modelId, { mode: 'firstLast', role: 'video.firstLast' }).endpoint
}

/**
 * Returns the registry key for `modelId`. Legacy ids (from persisted rows or
 * in-flight workflows) and unknown ids resolve to the `video.firstLast` default,
 * so the result is always a model the pipeline can route.
 */
export function validateVideoModelId(modelId: null | string | undefined): string {
  return resolveModel('video', modelId ?? undefined, { role: 'video.firstLast' }).key
}
