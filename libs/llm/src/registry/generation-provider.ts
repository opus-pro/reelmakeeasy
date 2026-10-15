/**
 * Which generation provider makes pictures, clips, voices and music (fal or Google's Gemini
 * API), and whether it can. The API sets both from Setup (SetupSettingsService): the chosen
 * provider, and why it can't run when its key is missing. A chosen provider that can't run is
 * kept, never swapped: calls fail with the reason. Scripts and tests that set nothing run on
 * fal. A run started before a switch keeps the provider it started with: the workflow engine
 * registers that pin with `setGenerationProviderPin`. Browser-safe: no node imports.
 */
import type { GenerationProvider } from './schema'

/** The start of every "can't make it" message; the reason follows. */
export const GENERATION_NOT_SET_UP_MESSAGE =
  'No AI is set up to make pictures, clips and voices: open Setup'

/** No generation provider can run. Not worth retrying: only Setup or .env can fix it. */
export class GenerationNotSetUpError extends Error {
  override readonly name = 'GenerationNotSetUpError'
}

let chosen: GenerationProvider | null = null
let unavailableReason: null | string = null
let pinned: () => GenerationProvider | undefined = () => undefined

/** Throws GenerationNotSetUpError, with the reason, when the chosen provider can't run. */
export function assertGenerationReady(): void {
  if (unavailableReason !== null) throw new GenerationNotSetUpError(generationNotReadyMessage())
}

/** The provider this call runs on: its run's pinned provider, else the Setup choice, else fal. */
export function currentGenerationProvider(): GenerationProvider {
  return pinned() ?? chosen ?? 'fal'
}

/** What a refused start or call says: the Setup message and, when known, why. */
export function generationNotReadyMessage(): string {
  return unavailableReason
    ? `${GENERATION_NOT_SET_UP_MESSAGE}. ${unavailableReason}`
    : GENERATION_NOT_SET_UP_MESSAGE
}

/** False only after the API reported that the chosen provider (or every provider) can't run. */
export function generationProviderReady(): boolean {
  return unavailableReason === null
}

export function resetGenerationProviderForTesting(): void {
  chosen = null
  unavailableReason = null
  pinned = () => undefined
}

/** Set by the API: the chosen provider (stored or .env), else the first available; null for none. */
export function setGenerationProvider(provider: GenerationProvider | null): void {
  chosen = provider
}

/** Registered by the workflow engine: the provider the current run started with, if any. */
export function setGenerationProviderPin(source: () => GenerationProvider | undefined): void {
  pinned = source
}

/** Set by the API: why generation can't run (e.g. the chosen provider's key is missing), or null. */
export function setGenerationUnavailable(reason: null | string): void {
  unavailableReason = reason
}
