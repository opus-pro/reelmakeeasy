// Re-exported from @reelmakeeasy/uip-planner-runtime (story-mode-handoff), the single
// implementation shared with the worker fast path.
export { buildLongTakeGlobalConstraintsJson } from '@reelmakeeasy/uip-planner-runtime'

/**
 * Serialize the original full style description for the keyframe-prompt
 * stylization filter, handed off via long_take/style_source.json and
 * read in story-mode. Returns null when no style is set.
 */
export function buildStyleSourceJson(spec: {
  global_constraints: { style: { style_text?: string } }
}): null | string {
  const styleText = spec.global_constraints.style.style_text?.trim()
  return styleText ? JSON.stringify({ style_text: styleText }) : null
}

/**
 * Keyframe stylization (baking the full style into keyframe prompts
 * via style_source.json) is scoped to every user-specified style EXCEPT presets.
 * Presets stay on the legacy per-shot suffix path -- presets already look the
 * way they were designed to, and style_source.json did not exist before the stylization
 * feature, so withholding it restores their original behavior. Custom saved
 * styles, uploaded style images, and prompt-described styles (selectedStyleRef
 * undefined) all still stylize. The keyframe bake step no-ops when
 * style_source.json is absent, so gating the handoff write here is sufficient.
 */
export function isStylizableStyleRef(selectedStyleRef: unknown): boolean {
  const ref = selectedStyleRef as null | { kind?: string }
  return ref?.kind !== 'preset'
}

/**
 * Build the style_source.json handoff only for stylizable (non-preset)
 * styles; returns null for presets so the keyframe bake step no-ops and presets
 * keep their legacy look. Wraps isStylizableStyleRef + buildStyleSourceJson so
 * the confirm orchestrations stay a single expression (keeps their cognitive
 * complexity down and avoids duplicating the scoping rule at each call site).
 */
export function buildScopedStyleSourceJson(
  selectedStyleRef: unknown,
  spec: { global_constraints: { style: { style_text?: string } } },
): null | string {
  return isStylizableStyleRef(selectedStyleRef) ? buildStyleSourceJson(spec) : null
}
