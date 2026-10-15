// Vertex retired the -preview Gemini image ids (every request 404s and
// falls back). Map any legacy -preview id still arriving from a persisted row, an
// in-flight/retried workflow, or a not-yet-migrated model config to its GA id.
// Reuse this at EVERY model-id decision point (provider call, PT-routing probe,
// cost-index lookup, NBP classification, config equality checks) so legacy and GA
// ids behave identically until the deprecated aliases are removed post-backfill.
const LEGACY_IMAGE_MODEL_GA_MAP: Readonly<Record<string, string>> = {
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image',
}

export function normalizeImageModelId(model: string): string {
  return LEGACY_IMAGE_MODEL_GA_MAP[model] ?? model
}
