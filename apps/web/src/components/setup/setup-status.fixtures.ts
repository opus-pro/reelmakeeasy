import type { HarnessStatus } from '@shared/types/api/agent'
import type {
  GenerationProvider,
  LlmProvider,
  SetupOption,
  SetupStatus,
} from '@shared/types/api/setup'

/** A signed-in harness (test data for the Setup card; not used by the app). */
export const ready: HarnessStatus = {
  available: true,
  binary: '/bin/agent',
  loggedIn: true,
  version: '1.0.0',
}

/** A harness that isn't installed. */
export const missing: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}

/** What a test status has: keys, harnesses and the picks in force. */
export interface SetupFixture {
  claude?: HarnessStatus
  codex?: HarnessStatus
  elevenlabs?: boolean
  fal?: boolean
  gemini?: boolean
  /** The API's `generation.provider`: saved in Setup, or the .env default. */
  savedGeneration?: GenerationProvider
  /** The API's `llm.provider`: saved in Setup, or the .env default. */
  savedLlm?: LlmProvider
}

/** The API's rule for the choice in effect: the saved one when usable (else none), otherwise
 *  the first usable option in `order` (default: the options' own order, right for generation;
 *  the LLM call below passes codex-first, matching phase 1's `effectiveLlm` tie-break, since
 *  this fixture's harness default is always codex). */
function inEffect<T extends string>(
  options: SetupOption<T>[],
  saved: T | undefined,
  order: readonly T[] = options.map((o) => o.id),
): null | T {
  if (saved) return options.some((o) => o.id === saved && o.available) ? saved : null
  const ready = new Set(options.filter((o) => o.available).map((o) => o.id))
  return order.find((id) => ready.has(id)) ?? null
}

/** A status as `GET /api/setup/status` returns it. */
export function setupStatus(f: SetupFixture = {}): SetupStatus {
  const claude = f.claude ?? missing
  const codex = f.codex ?? missing
  const keys = {
    elevenlabs: Boolean(f.elevenlabs),
    endpoint: false,
    fal: Boolean(f.fal),
    gemini: Boolean(f.gemini),
  }
  const llmOptions: SetupOption<LlmProvider>[] = [
    { available: claude.available, id: 'claude', label: 'Claude Code' },
    { available: codex.available, id: 'codex', label: 'Codex' },
    { available: keys.gemini, id: 'gemini', label: 'Gemini' },
    {
      available: false,
      id: 'endpoint',
      label: 'Your own endpoint',
      reason: 'Set LLM_BASE_URL in .env, then restart',
    },
  ]
  const generationOptions: SetupOption<GenerationProvider>[] = [
    { available: keys.fal, id: 'fal', label: 'fal' },
    { available: keys.gemini, id: 'google', label: 'Gemini' },
  ]
  return {
    generation: {
      effective: inEffect(generationOptions, f.savedGeneration),
      options: generationOptions,
      provider: f.savedGeneration ?? null,
    },
    harnesses: { ...codex, claude, codex, defaultHarness: 'codex' },
    keys,
    llm: {
      effective: inEffect(llmOptions, f.savedLlm, ['codex', 'claude', 'gemini', 'endpoint']),
      options: llmOptions,
      provider: f.savedLlm ?? null,
    },
  }
}
