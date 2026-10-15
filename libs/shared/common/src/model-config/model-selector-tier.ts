// Quality-tier semantics for the model selector v2 UI.

export const MODEL_QUALITY_TIERS = ['basic', 'premium'] as const
export type ModelQualityTier = (typeof MODEL_QUALITY_TIERS)[number]

// Display-only cost marks shown next to tiers and models in the v2 selector.
export const MODEL_COST_INDICATORS = ['$', '$$', '$$$'] as const
export type ModelCostIndicator = (typeof MODEL_COST_INDICATORS)[number]

type TierResolvableConfig = {
  defaultModelId: string
  models: TierResolvableEntry[]
  premiumDefaultModelId?: string
}

type TierResolvableEntry = {
  enabled: boolean
  id: string
  order?: number
  paidOnly?: boolean
  tier?: ModelQualityTier
}

// The zod schemas guard only the SERVER read path -- a browser-side config read
// may merely cast (`config.value as T`).
// These helpers therefore treat their inputs as untrusted and revalidate
// inline, so a raw `"Premium"` (or any junk) from an unparsed client config
// degrades exactly the way the schema comments promise: to absent.
export function sanitizeCostIndicator(value: unknown): ModelCostIndicator | undefined {
  return MODEL_COST_INDICATORS.includes(value as ModelCostIndicator)
    ? (value as ModelCostIndicator)
    : undefined
}

export function sanitizeModelQualityTier(value: unknown): ModelQualityTier | undefined {
  return MODEL_QUALITY_TIERS.includes(value as ModelQualityTier)
    ? (value as ModelQualityTier)
    : undefined
}

// Same untrusted-input contract as the sanitizers above, for the video
// config's `tierDescriptions` copy block: only plain strings survive, so a
// junk value (number, object, malformed block) falls back to the hardcoded
// copy instead of rendering garbage or crashing React.
export function sanitizeTierDescriptions(value: unknown): {
  basic?: string
  premium?: string
} {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const raw = value as Record<string, unknown>
  return {
    basic: typeof raw['basic'] === 'string' ? raw['basic'] : undefined,
    premium: typeof raw['premium'] === 'string' ? raw['premium'] : undefined,
  }
}

// An untagged model keeps working when tiers ship: paidOnly models read as
// premium (that is what the crown already means), everything else as basic.
// Tolerates unvalidated input (see the sanitizers' doc above): an unknown tier
// value falls through to the paidOnly derivation, and paidOnly is compared
// strictly so a junk truthy value cannot promote a model to premium.
export function resolveModelTier(
  entry: Pick<TierResolvableEntry, 'paidOnly' | 'tier'>,
): ModelQualityTier {
  return sanitizeModelQualityTier(entry.tier) ?? (entry.paidOnly === true ? 'premium' : 'basic')
}

// Resolve the concrete model a quality tier runs.
// - basic -> `defaultModelId`, unchanged: it stays the existing cost dial.
// - premium -> `premiumDefaultModelId` when it names an enabled premium-tier
//   model; otherwise the first enabled premium-tier model by `order`.
//   `undefined` when the config has no usable premium model -- callers hide or
//   disable the Premium row rather than guessing.
export function resolveTierDefaultModelId(
  tier: ModelQualityTier,
  config: TierResolvableConfig,
): string | undefined {
  if (tier === 'basic') {
    return config.defaultModelId
  }
  const premiumModels = config.models
    .filter((m) => m.enabled && resolveModelTier(m) === 'premium')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const configured = premiumModels.find((m) => m.id === config.premiumDefaultModelId)
  return (configured ?? premiumModels[0])?.id
}
