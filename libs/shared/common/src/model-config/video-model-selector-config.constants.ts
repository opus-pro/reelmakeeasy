// Constants and types for the video model selector config.
// This file has NO server-side imports so it is safe to import from browser bundles.
// Server-side video model selection reads the model registry instead
// (reelmakeeasy.models.json via veo3/video-model-selection.ts). Still read by
// the tier helpers beside it.

import type { ModelCostIndicator, ModelQualityTier } from './model-selector-tier'

// Registered model used when the configured default cannot be selected.
export const SAFE_DEFAULT_VIDEO_MODEL_ID = 'veo-3.0-fast-generate-001'

export const NEW_MODEL_SELECTOR_TIERS = ['basic', 'standard', 'premium', 'ultra'] as const
export type NewModelSelectorTier = (typeof NEW_MODEL_SELECTOR_TIERS)[number]

export type NewModelSelectorTierConfig = {
  /** Tier-specific model catalogs shown in the inline Custom picker. */
  customImageModelIds: string[]
  customVideoModelIds: string[]
  /** Default pair applied when the user snaps the quality slider to this tier. */
  imageModelId: string
  videoModelId: string
}

export type VideoModelEntry = {
  badge?: null | string
  // Display-only cost mark for the selector v2 UI.
  costIndicator?: ModelCostIndicator
  description?: string
  // Optional new-user discovery banner content for a `promoted` model (e.g.
  // Gemini Omni). When the gate is on and a promoted model carries `discovery`,
  // the config-driven discovery banner near the model button renders entirely
  // from these fields and REPLACES the hardcoded Seedance 2.0 banner -- a new
  // promoted model gets its own banner (incl. a different video) via config
  // alone, no code. Every field is optional and individually safe-defaulted
  // (.catch(undefined)), so a missing/bad discovery never fails the entry; the
  // banner just renders without that bit (an absent videoUrl hides the video).
  discovery?: {
    badge?: string
    subtitle?: string
    title?: string
    videoUrl?: string
  }
  enabled: boolean
  // Code-registered model ids the orchestrator can route to after this model
  // fails. Filtered to registered ids at read time (see getVideoModelFallbackChain).
  fallbackChain?: string[]
  icon?: string
  id: string
  label: string
  order?: number
  // Premium-tier model (e.g. Gemini Omni). Only drives the selector tier
  // derivation (see resolveModelTier); every model is available to everyone.
  paidOnly?: boolean
  promoted?: boolean
  // The real provider-facing API model string, kept out of source and
  // resolved at call time.
  providerModelId?: string
  // Optional feature gate a model must pass before the client may show it and
  // the API may accept it. Currently supported for Seedance 2.5 only.
  requiredGate?: string
  // Quality tier for the selector v2 UI. Absent = derived: paidOnly
  // models read as premium, others basic (see resolveModelTier).
  tier?: ModelQualityTier
  // Optional upsell content for a `paidOnly` model (e.g. Gemini Omni). When
  // present, a locked-tier user who selects this model sees the config-driven
  // VideoModelUpsellPopup built entirely from these fields -- a new paid model
  // gets its own popup (incl. a different video) via config alone, no code.
  // Every field is optional and individually safe-defaulted (.catch(undefined)),
  // so a missing/bad upsell never fails the entry.
  upsell?: {
    badge?: string
    body?: string
    ctaLabel?: string
    dismissLabel?: string
    imageUrl?: string
    /**
     * Carousel slides for the selector v2 upsell dialog. When
     * present, the v2 dialog renders these instead of the single
     * videoUrl/imageUrl media block; v1's popup ignores them. Each slide is a
     * media (video preferred, image fallback) plus its caption row.
     */
    slides?: { caption?: string; imageUrl?: string; videoUrl?: string }[]
    /**
     * Plain centered title for the v2 upsell dialog. The v1 popup keeps using
     * titlePrefix/titleHighlight; absent falls back to those joined.
     */
    title?: string
    titleHighlight?: string
    titlePrefix?: string
    videoUrl?: string
  }
}

export type VideoModelSelectorConfig = {
  defaultModelId: string
  models: VideoModelEntry[]
  /**
   * Four-tier selector contract for `enable_new_model_selector_ui`. The client
   * requires all four tiers and validates every id against the enabled model
   * catalogs before rendering; absent or invalid data falls back to selector
   * v2, so turning on the UI gate cannot emit an unusable model id.
   */
  newUi?: {
    tiers: Record<NewModelSelectorTier, NewModelSelectorTierConfig>
  }
  /**
   * Model the v2 "Premium" quality tier resolves to. Absent -- or
   * naming a model that is missing/disabled/not premium -- falls back to the
   * first enabled premium-tier model by order (see resolveTierDefaultModelId).
   * Deliberately NOT hard-validated like `defaultModelId`: a typo here must
   * degrade the gated v2 UI only, never take the live config down to the safe
   * default.
   */
  premiumDefaultModelId?: string
  /**
   * Optional copy override for the v2 quality-tier rows. The "$"
   * marks in those rows come from the tier default model's `costIndicator`;
   * these strings are only the text after the separator. Absent fields fall
   * back to the hardcoded defaults in the v2 UI. Lives on the video config
   * because the tier copy describes the video-led model pair.
   */
  tierDescriptions?: { basic?: string; premium?: string }
}
