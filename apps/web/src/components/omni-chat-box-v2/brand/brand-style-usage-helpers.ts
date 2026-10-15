import type { BrandBriefStyleRef, BrandBriefSummary } from './brand-briefs-client'

// Identity for a style reference shared by a brief's styles[] and a picker card,
// so the picker can tell which library styles a brand brief points at.
export function styleRefUsageKey(ref: BrandBriefStyleRef): string {
  return ref.kind === 'preset' ? `preset:${ref.presetId}` : `custom:${ref.userSavedStyleId}`
}

// Usage-map key for a picker card, matching styleRefUsageKey: saved styles key
// by their custom id, everything else (presets) by preset id.
export function styleCardUsageKey(id: string, isUserStyle: boolean): string {
  return isUserStyle ? `custom:${id}` : `preset:${id}`
}

// Reverse index of the org's saved briefs: which brand names reference each
// style. Drives the picker's brand badge + "Name +N more" hover tooltip. A style
// referenced by several briefs lists each brand once, in brief order.
export function brandNamesByStyleKey(briefs: BrandBriefSummary[]): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  for (const brief of briefs) {
    for (const style of brief.styles ?? []) {
      if (!style.styleRef) {
        continue
      }
      const key = styleRefUsageKey(style.styleRef)
      const names = usage.get(key) ?? []
      if (!names.includes(brief.brandName)) {
        names.push(brief.brandName)
        usage.set(key, names)
      }
    }
  }
  return usage
}

// Usage lookup for a card whose ref kind is unknown (brand-tab options carry
// only the raw id, not whether the ref was a preset or a saved style); preset
// slugs and saved-style ids never collide, so probing both keys is safe.
export function brandNamesForStyleId(
  usage: Map<string, string[]> | undefined,
  id: string,
): string[] {
  return usage?.get(`custom:${id}`) ?? usage?.get(`preset:${id}`) ?? []
}

// Short label for a style's referencing brands: "Acme", "Acme +2 more".
export function brandUsageLabel(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? ''
  }
  return `${names[0]} +${names.length - 1} more`
}
