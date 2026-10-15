// The Gemini 3.1 Flash Lite preview id is retired.
// Normalize persisted, in-flight, and configured values at the completion
// boundary until those legacy values have drained.
const LEGACY_COMPLETION_MODEL_GA_MAP: Readonly<Record<string, string>> = {
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
}

export function normalizeCompletionModelId(model: string): string {
  return LEGACY_COMPLETION_MODEL_GA_MAP[model] ?? model
}
