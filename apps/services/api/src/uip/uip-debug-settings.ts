import type { DebugSettings } from '@shared/types/project/debug-settings'

/**
 * Extract ONLY the `llm` model-switch map from an untrusted client
 * `debug_settings` payload. Returns a `DebugSettings` carrying just
 * `llm` when the value is a well-formed tool -> scene -> model string map,
 * otherwise undefined. Every other debug key is deliberately dropped so the
 * admin/dev model switch is the only thing a UIP client can seed here. The
 * switch still only reaches generation for code-registered models
 * (`getModelName` validates), matching the classic create flow's trust model.
 */
export function extractDebugModelSwitch(debugSettings: unknown): DebugSettings | undefined {
  if (!debugSettings || typeof debugSettings !== 'object' || Array.isArray(debugSettings)) {
    return undefined
  }
  const llm = (debugSettings as { llm?: unknown }).llm
  if (!llm || typeof llm !== 'object' || Array.isArray(llm)) {
    return undefined
  }
  const cleaned: Record<string, Record<string, string>> = {}
  for (const [tool, scenes] of Object.entries(llm)) {
    if (isUnsafeKey(tool) || !scenes || typeof scenes !== 'object' || Array.isArray(scenes)) {
      continue
    }
    const sceneMap: Record<string, string> = {}
    for (const [scene, model] of Object.entries(scenes)) {
      if (!isUnsafeKey(scene) && typeof model === 'string' && model) {
        sceneMap[scene] = model
      }
    }
    if (Object.keys(sceneMap).length > 0) {
      cleaned[tool] = sceneMap
    }
  }
  return Object.keys(cleaned).length > 0 ? { llm: cleaned } : undefined
}

// `JSON.parse` gives `__proto__` an OWN property, so it survives into
// Object.entries. Writing it back onto a plain object would hit the inherited
// setter and reassign the accumulator's prototype instead of adding a key.
// No real tool/scene is ever named this, so drop such keys explicitly rather
// than rely on that subtlety (and never persist them as data either).
export function getProjectKeyframeImageModel(debugSettings: unknown): string | undefined {
  if (!debugSettings || typeof debugSettings !== 'object' || Array.isArray(debugSettings)) {
    return undefined
  }
  const keyframeImageModel = (debugSettings as { keyframeImageModel?: unknown }).keyframeImageModel
  if (typeof keyframeImageModel !== 'string') {
    return undefined
  }
  const trimmed = keyframeImageModel.trim()
  return trimmed || undefined
}

function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

/**
 * Helpers for merging UIP session fields into project.debugSettings at confirm
 * time. Kept here to keep uip-confirm-orchestration.ts under the max-lines and
 * cognitive-complexity caps.
 */
export function buildUipDebugSettingsUpdate(
  existing: unknown,
  transitionVideoModel: null | string | undefined,
): Record<string, never> | { debugSettings: DebugSettings } {
  if (!transitionVideoModel) {
    return {}
  }
  const prev =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as DebugSettings)
      : {}
  return { debugSettings: { ...prev, transitionVideoModel } }
}
