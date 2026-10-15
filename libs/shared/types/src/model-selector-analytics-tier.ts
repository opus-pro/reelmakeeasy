export const MODEL_SELECTOR_ANALYTICS_TIERS = [
  'standard',
  'standard_plus',
  'premium',
  'ultra',
] as const

export type ModelSelectorAnalyticsTier = (typeof MODEL_SELECTOR_ANALYTICS_TIERS)[number]
