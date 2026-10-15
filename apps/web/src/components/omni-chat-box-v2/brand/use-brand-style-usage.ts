'use client'

export {
  brandNamesByStyleKey,
  brandUsageLabel,
  styleCardUsageKey,
  styleRefUsageKey,
} from './brand-style-usage-helpers'

const EMPTY_BRAND_USAGE: Map<string, string[]> = new Map()

// Brand-usage map for the style picker. The saved-brand feature is off, so no
// briefs are loaded and the map is always empty (the badge never shows).
export function useBrandStyleUsage(): Map<string, string[]> {
  return EMPTY_BRAND_USAGE
}
