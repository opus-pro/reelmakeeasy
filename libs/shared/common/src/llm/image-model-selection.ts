import { fallbacksFor, type ImageRole, resolveModel, resolveRole } from '@reelmakeeasy/llm/registry'

export function getDefaultImageModelId(): string {
  return imageModelForRole('image.generate')
}

// Registry fallbacks for the roles this model serves, as registry keys. A
// legacy or unknown id resolves to its role default first.
export function getImageModelFallbackChain(modelId: null | string | undefined): string[] {
  if (!modelId) {
    return []
  }
  return fallbacksFor(validateImageModelId(modelId)).map((m) => m.key)
}

// Every image model is billed at 1.0x.
export function getImageModelMultiplier(_modelId: null | string | undefined): number {
  return 1
}

/**
 * The registry key serving an image role (`reelmakeeasy.models.json`). Throws
 * when the role is disabled (`null`), since every image call site needs one.
 */
export function imageModelForRole(role: ImageRole): string {
  const resolved = resolveRole(role)
  if (!resolved) {
    throw new Error(`No image model is configured for role ${role} (roles.${role} is null)`)
  }
  return resolved.key
}

// True when the actually-used model costs MORE than the selected one. The
// registry carries no cost data, so this is always undefined and callers omit
// the `absorbed` tag.
export function isImageModelFallbackAbsorbed(
  _selectedModel: null | string | undefined,
  _usedModel: null | string | undefined,
): boolean | undefined {
  return undefined
}

/**
 * Returns the registry key for `modelId`. Legacy ids (from persisted rows or
 * in-flight workflows) and unknown ids resolve to the `image.generate` default,
 * so the result is always a model the pipeline can route.
 */
export function validateImageModelId(modelId: null | string | undefined): string {
  return resolveModel('image', modelId ?? undefined).key
}
