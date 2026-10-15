/**
 * The generation provider a workflow run started with. The engine captures it
 * when a run starts and restores it around the run's workflow code and every
 * activity, so switching fal and Gemini in Setup mid-video leaves that video on
 * the provider it started with; the next video uses the new choice.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { type GenerationProvider } from '@reelmakeeasy/llm/registry'

const storage = new AsyncLocalStorage<GenerationProvider>()

/** The provider the current run is pinned to, or undefined outside a run. */
export function pinnedGenerationProvider(): GenerationProvider | undefined {
  return storage.getStore()
}

/** Runs `fn` (a workflow, an activity) pinned to `provider`. */
export function runWithGenerationPin<T>(provider: GenerationProvider, fn: () => T): T {
  return storage.run(provider, fn)
}
