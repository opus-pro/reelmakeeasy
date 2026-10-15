import {
  MODEL_SELECTOR_ANALYTICS_TIERS,
  type ModelSelectorAnalyticsTier,
} from '@shared/types/model-selector-analytics-tier'

import type { NewModelSelectorTier } from './video-model-selector-config.constants'

export { MODEL_SELECTOR_ANALYTICS_TIERS, type ModelSelectorAnalyticsTier }

/** Translate internal selector keys into the user-facing tier names used by analytics. */
export function toModelSelectorAnalyticsTier(
  tier: NewModelSelectorTier,
): ModelSelectorAnalyticsTier {
  switch (tier) {
    case 'basic': {
      return 'standard'
    }
    case 'premium': {
      return 'premium'
    }
    case 'standard': {
      return 'standard_plus'
    }
    case 'ultra': {
      return 'ultra'
    }
  }
}

/** Normalize a selector tier when the caller has not necessarily resolved one yet. */
export function toOptionalModelSelectorAnalyticsTier(
  tier: 'custom' | NewModelSelectorTier | undefined,
): ModelSelectorAnalyticsTier | undefined {
  return tier === undefined || tier === 'custom' ? undefined : toModelSelectorAnalyticsTier(tier)
}

/** Accept only an already-normalized analytics tier at untrusted boundaries. */
export function parseModelSelectorAnalyticsTier(
  value: unknown,
): ModelSelectorAnalyticsTier | undefined {
  return typeof value === 'string' &&
    MODEL_SELECTOR_ANALYTICS_TIERS.includes(value as ModelSelectorAnalyticsTier)
    ? (value as ModelSelectorAnalyticsTier)
    : undefined
}
